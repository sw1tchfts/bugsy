"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { intOrNull, opt, str } from "@/lib/customers/forms";
import { errorCode } from "@/lib/db";
import { isIsoDate } from "@/lib/dates";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import { payCommissions } from "@/lib/sales/db";

function back(path: string, params: Record<string, string>): never {
  revalidatePath(path);
  redirect(`${path}?${new URLSearchParams(params).toString()}`);
}

const list = (v: string) => v.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

/** Rule 2: a territory by ZIP codes and streets, with its reps. Managers (customers.write and users.read) only. */
export async function saveTerritory(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "users.read");
  const id = opt(formData, "territory_id");
  const name = str(formData, "name").trim();
  const zips = list(str(formData, "zip_codes"));
  const streets = list(str(formData, "streets"));
  const reps = formData.getAll("rep_ids").map(String).filter((v) => /^[0-9a-f-]{36}$/i.test(v));
  if (!name) back("/sales/territories", { error: "Name the territory." });
  if (zips.some((z) => !/^\d{5}$/.test(z))) back("/sales/territories", { error: "ZIP codes are five digits." });
  let error: string | null = null;
  try {
    await dbAs(session, (tx) =>
      id
        ? tx`update public.territories set name = ${name}, zip_codes = ${zips}, streets = ${streets}, rep_ids = ${reps}, active = ${formData.get("active") !== "false"} where id = ${id} and tenant_id = ${tenantId}`
        : tx`insert into public.territories (tenant_id, name, zip_codes, streets, rep_ids) values (${tenantId}, ${name}, ${zips}, ${streets}, ${reps})`,
    );
  } catch (err) {
    error = errorCode(err);
  }
  back("/sales/territories", error ? { error } : { note: "Territory saved." });
}

/** Rule 1: the office clears a do-not-knock once the household says knocking is fine again. */
export async function clearDoNotKnock(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "users.read");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`update public.knocks set cleared_at = now() where id = ${str(formData, "knock_id")} and tenant_id = ${tenantId} and outcome = 'do_not_knock'`);
  } catch (err) {
    error = errorCode(err);
  }
  back("/sales/territories", error ? { error } : { note: "Cleared." });
}

/** Rules 4 to 6: a commission plan. */
export async function saveCommissionPlan(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "billing.write");
  const basis = str(formData, "basis");
  const percent = opt(formData, "percent");
  const flat = opt(formData, "flat");
  const flatCents = flat ? parseDollarsToCents(flat) : null;
  const roles = formData.getAll("role_keys").map(String).filter(Boolean);
  const users = formData.getAll("user_ids").map(String).filter((v) => /^[0-9a-f-]{36}$/i.test(v));
  if (!["initial", "first_year", "flat"].includes(basis)) back("/sales/commissions", { error: "Pick what the commission is based on." });
  if (basis === "flat" ? !flatCents : !(percent && Number(percent) > 0 && Number(percent) <= 100)) back("/sales/commissions", { error: "A percent from 0 to 100, or a flat amount." });
  if (roles.length + users.length === 0) back("/sales/commissions", { error: "Pick the roles or people it covers." });
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`
      insert into public.commission_plans (tenant_id, name, role_keys, user_ids, basis, percent, flat_cents, hold_days, hold_paid_invoices, chargeback_days)
      values (${tenantId}, ${str(formData, "name").trim() || "Commission"}, ${roles}, ${users}, ${basis}, ${basis === "flat" ? null : percent}, ${basis === "flat" ? flatCents : null},
              ${intOrNull(formData, "hold_days") ?? 30}, ${intOrNull(formData, "hold_paid_invoices") ?? 1}, ${intOrNull(formData, "chargeback_days") ?? 90})`);
  } catch (err) {
    error = errorCode(err);
  }
  back("/sales/commissions", error ? { error } : { note: "Plan saved. It applies to sales signed from now on." });
}

export async function togglePlan(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "billing.write");
  await dbAs(session, (tx) => tx`update public.commission_plans set active = not active where id = ${str(formData, "plan_id")} and tenant_id = ${tenantId}`);
  back("/sales/commissions", { note: "Saved." });
}

/** Rule 7: pays a seller's payable commissions in one payout. */
export async function payRep(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "billing.write");
  const paidOn = str(formData, "paid_on");
  if (!isIsoDate(paidOn)) back("/sales/commissions", { error: "Pick the payment date." });
  let error: string | null = null;
  let amount = 0;
  try {
    await dbAs(session, async (tx) => {
      const r = await payCommissions(tx, tenantId, str(formData, "user_id"), { paid_on: paidOn, method: str(formData, "method") || "payroll", reference: opt(formData, "reference") });
      amount = r.amount_cents;
      if (!r.payout_id) throw Object.assign(new Error("Nothing is payable to this person."), { code: "23514" });
    });
  } catch (err) {
    error = errorCode(err);
  }
  back("/sales/commissions", error ? { error } : { note: `Paid ${formatCents(amount)}.` });
}
