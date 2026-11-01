"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { opt, str } from "@/lib/customers/forms";
import { isIsoDate } from "@/lib/dates";
import { errorCode } from "@/lib/db";
import { parseDollarsToCents } from "@/lib/money";
import { exportPeriod, postPayroll } from "@/lib/payroll/db";
import { PAY_KINDS, PERIOD_KINDS, type PayKind, type PeriodKind } from "@/lib/payroll/periods";

function back(params: Record<string, string | null>): never {
  revalidatePath("/payroll");
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  redirect(`/payroll${q ? `?${q}` : ""}`);
}

const cents = (formData: FormData, key: string): number | null => {
  const v = opt(formData, key);
  return v === null ? null : parseDollarsToCents(v);
};

/** Rule 9: the pay period the company runs. */
export async function saveSettings(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "payroll.write");
  const period = str(formData, "period") as PeriodKind;
  const anchor = str(formData, "anchor_on");
  if (!(PERIOD_KINDS as readonly string[]).includes(period) || !isIsoDate(anchor)) back({ error: "Pick a period and a first day." });
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`insert into public.pay_settings (tenant_id, period, anchor_on) values (${tenantId}, ${period}, ${anchor})
                                   on conflict (tenant_id) do update set period = excluded.period, anchor_on = excluded.anchor_on`);
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Pay period saved." });
}

/** A person's pay from a day on (rule 11 uses the rate in effect on a period's last day). */
export async function saveRate(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "payroll.write");
  const kind = str(formData, "kind") as PayKind;
  const from = str(formData, "effective_from");
  if (!(PAY_KINDS as readonly string[]).includes(kind) || !isIsoDate(from)) back({ error: "Pick the kind of pay and the day it starts." });
  const percent = opt(formData, "production_percent");
  if (percent !== null && !/^\d{1,3}(\.\d{1,3})?$/.test(percent)) back({ error: "The percent has at most three decimals." });
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const userId = str(formData, "user_id");
      await tx`
        insert into public.pay_rates (tenant_id, user_id, kind, hourly_rate_cents, production_percent, draw_cents, salary_cents, labor_cost_cents_per_hour, effective_from)
        values (${tenantId}, ${userId}, ${kind}, ${kind === "hourly" ? cents(formData, "hourly_rate") : null}, ${kind === "production" ? percent : null},
                ${kind === "production" ? cents(formData, "draw") : null}, ${kind === "salary" ? cents(formData, "salary") : null}, ${cents(formData, "labor_cost")}, ${from})
        on conflict (tenant_id, user_id, effective_from) do update set kind = excluded.kind, hourly_rate_cents = excluded.hourly_rate_cents,
          production_percent = excluded.production_percent, draw_cents = excluded.draw_cents, salary_cents = excluded.salary_cents,
          labor_cost_cents_per_hour = excluded.labor_cost_cents_per_hour`;
      const pid = opt(formData, "payroll_id");
      if (pid !== null) await tx`select app.set_payroll_id(${tenantId}, ${userId}, ${pid})`;
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Pay saved." });
}

/** Rule 12: the closed period goes to the payroll provider, once. */
export async function exportAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session, membership } = await requirePermission(tenantId, "payroll.write");
  const starts = str(formData, "starts_on");
  const ends = str(formData, "ends_on");
  if (!isIsoDate(starts) || !isIsoDate(ends)) back({ error: "Pick a period." });
  let error: string | null = null;
  let id: string | null = null;
  try {
    id = await dbAs(session, (tx) => exportPeriod(tx, tenantId, { starts_on: starts, ends_on: ends }, membership.tenantTimezone));
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Exported. Download the file for the payroll provider.", period: id });
}

/** Rule 13: the register's totals, posted once. */
export async function postAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session, membership } = await requirePermission(tenantId, "payroll.write");
  const read = (k: string) => {
    const v = cents(formData, k);
    if (v === null) back({ error: "Enter every total from the payroll register, in dollars and cents." });
    return v as number;
  };
  const register = {
    gross_wages_cents: read("gross_wages"),
    employer_taxes_cents: read("employer_taxes"),
    withholdings_cents: read("withholdings"),
    net_pay_cents: read("net_pay"),
    commissions_cents: read("commissions"),
  };
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => postPayroll(tx, tenantId, str(formData, "period_id"), register, membership.tenantTimezone));
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Payroll posted to the ledger." });
}
