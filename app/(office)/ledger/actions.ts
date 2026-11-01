"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { loadSettings } from "@/lib/billing/db";
import { opt, str } from "@/lib/customers/forms";
import { isIsoDate, todayInZone } from "@/lib/dates";
import { errorCode } from "@/lib/db";
import { type EntryLine, closePeriod, ensureChart, postEntry, postOpening, reopenPeriod, reverseEntry, runLedger } from "@/lib/ledger/db";
import { parseDollarsToCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

const HOME = "/ledger";

function go(path: string, params: Record<string, string | null | undefined>): never {
  revalidatePath(HOME);
  revalidatePath(path.split("?")[0]);
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) query.set(k, v);
  const q = query.toString();
  redirect(`${path}${q ? `?${q}` : ""}`);
}

/** Runs the ledger's share of the job now: the sweep, local payouts and the period-end reclasses. */
export async function runLedgerNow(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "gl.write");
  const { active } = await requireActiveTenant();
  let note: string | null = null;
  let error: string | null = null;
  try {
    const c = await dbAs(session, async (tx) => {
      const settings = await loadSettings(tx, tenantId);
      return runLedger(tx, tenantId, active.tenantTimezone, todayInZone(active.tenantTimezone), settings.gateway, { reclass: true, payouts: can(active.permissions, "billing.write") });
    });
    const posted = c.invoices + c.voids + c.visits + c.product_uses + c.payments + c.refunds + c.payouts + c.local_payouts + c.reclasses;
    note = `${posted} journal entr${posted === 1 ? "y" : "ies"} posted; ${c.unpriced} product use(s) still unpriced.`;
  } catch (err) {
    error = errorCode(err);
  }
  go(HOME, { note, error });
}

/** A manual entry: lines by account, each on one side, balanced, in an open period (rules 1, 9, 11). */
export async function postManualEntry(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const postedOn = str(formData, "posted_on");
  const memo = str(formData, "memo").trim();
  const { session } = await requirePermission(tenantId, "gl.write");
  const accountsIn = formData.getAll("line_account").map(String);
  const debitsIn = formData.getAll("line_debit").map(String);
  const creditsIn = formData.getAll("line_credit").map(String);
  const agreementsIn = formData.getAll("line_agreement").map(String);
  const memosIn = formData.getAll("line_memo").map(String);
  let error: string | null = null;
  let entryId: string | null = null;
  if (!isIsoDate(postedOn)) error = "The date is a date.";
  else if (!memo) error = "Say what the entry is for.";
  else {
    try {
      entryId = await dbAs(session, async (tx) => {
        await ensureChart(tx, tenantId);
        const lines: EntryLine[] = [];
        for (const [i, accountId] of accountsIn.entries()) {
          const debit = debitsIn[i]?.trim() ? parseDollarsToCents(debitsIn[i]) : 0;
          const credit = creditsIn[i]?.trim() ? parseDollarsToCents(creditsIn[i]) : 0;
          if (!accountId || (debit === 0 && credit === 0)) continue;
          if (debit === null || credit === null || debit < 0 || credit < 0) throw Object.assign(new Error(`line ${i + 1}: amounts are dollars and cents`), { code: "23514" });
          if (debit > 0 && credit > 0) throw Object.assign(new Error(`line ${i + 1}: a line is a debit or a credit, not both`), { code: "23514" });
          let agreementId: string | null = null;
          const number = agreementsIn[i]?.trim();
          if (number) {
            const [g] = await tx<{ id: string }[]>`select id from public.agreements where tenant_id = ${tenantId} and number = ${Number(number)}`;
            if (!g) throw Object.assign(new Error(`line ${i + 1}: no agreement #${number}`), { code: "23514" });
            agreementId = g.id;
          }
          lines.push({ gl_account_id: accountId, debit_cents: debit, credit_cents: credit, agreement_id: agreementId, memo: memosIn[i]?.trim() || null });
        }
        if (lines.length < 2) throw Object.assign(new Error("an entry needs at least two lines"), { code: "23514" });
        const debits = lines.reduce((s, l) => s + l.debit_cents, 0);
        const credits = lines.reduce((s, l) => s + l.credit_cents, 0);
        if (debits !== credits) throw Object.assign(new Error(`the entry does not balance: debits ${(debits / 100).toFixed(2)}, credits ${(credits / 100).toFixed(2)}`), { code: "23514" });
        return postEntry(tx, tenantId, { source_type: "manual", source_key: `manual:${crypto.randomUUID()}`, posted_on: postedOn, memo, lines });
      });
    } catch (err) {
      error = errorCode(err);
    }
  }
  go(entryId ? `${HOME}/journal/${entryId}` : `${HOME}/journal/new`, { error });
}

/** Reverses an entry today, or on a later open day (rule 11). */
export async function reverseEntryAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const entryId = str(formData, "entry_id");
  const { session } = await requirePermission(tenantId, "gl.write");
  const { active } = await requireActiveTenant();
  const postedOn = opt(formData, "posted_on") ?? todayInZone(active.tenantTimezone);
  let error: string | null = null;
  let reversalId: string | null = null;
  if (!isIsoDate(postedOn)) error = "The date is a date.";
  else if (postedOn < todayInZone(active.tenantTimezone)) error = "A reversal is dated today or later; the original stays where it was posted.";
  else {
    try {
      reversalId = await dbAs(session, (tx) =>
        reverseEntry(tx, tenantId, entryId, { source_type: "reversal", source_key: `reversal:${entryId}`, posted_on: postedOn, memo: opt(formData, "memo") ?? "Reversal" }),
      );
    } catch (err) {
      error = errorCode(err);
    }
  }
  go(`${HOME}/journal/${reversalId ?? entryId}`, { error });
}

export async function closePeriodAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const period = str(formData, "period");
  const { session } = await requirePermission(tenantId, "gl.write");
  const { active } = await requireActiveTenant();
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => closePeriod(tx, tenantId, period, todayInZone(active.tenantTimezone)));
  } catch (err) {
    error = errorCode(err);
  }
  go(`${HOME}/periods`, { error, note: error ? null : `${period} closed.` });
}

/** The database refuses anyone but an owner (rule 10). */
export async function reopenPeriodAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const period = str(formData, "period");
  const reason = str(formData, "reason").trim();
  const { session } = await requirePermission(tenantId, "gl.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => reopenPeriod(tx, tenantId, period, reason));
  } catch (err) {
    error = errorCode(err);
  }
  go(`${HOME}/periods`, { error, note: error ? null : `${period} reopened.` });
}

/** Billed-to-date and delivered-to-date for an agreement that was mid-term at go-live (rule 13). */
export async function recordOpeningPosition(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const agreementId = str(formData, "agreement_id");
  const billed = parseDollarsToCents(str(formData, "billed"));
  const recognized = parseDollarsToCents(str(formData, "recognized"));
  const asOf = str(formData, "as_of");
  const { session } = await requirePermission(tenantId, "gl.write");
  let error: string | null = null;
  if (billed === null || recognized === null || billed < 0 || recognized < 0) error = "Billed and delivered are dollars and cents.";
  else if (!isIsoDate(asOf)) error = "The as-of date is a date.";
  else {
    try {
      await dbAs(session, (tx) => postOpening(tx, tenantId, { agreement_id: agreementId, billed_cents: billed, recognized_cents: recognized, as_of: asOf }));
    } catch (err) {
      error = errorCode(err);
    }
  }
  go(`${HOME}/reports/contracts`, { error, note: error ? null : "Opening position posted." });
}

/** A custom account, or a template account's number and name. */
export async function saveAccount(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const accountId = opt(formData, "account_id");
  const number = str(formData, "number").trim();
  const name = str(formData, "name").trim();
  const type = str(formData, "type");
  const subtype = str(formData, "subtype");
  const active = formData.getAll("active").map(String).includes("false") ? false : true;
  const { session } = await requirePermission(tenantId, "gl.write");
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      if (accountId) await tx`update public.gl_accounts set number = ${number}, name = ${name}, active = ${active} where id = ${accountId} and tenant_id = ${tenantId}`;
      else await tx`insert into public.gl_accounts (tenant_id, number, name, type, subtype) values (${tenantId}, ${number}, ${name}, ${type}, ${subtype})`;
    });
  } catch (err) {
    error = errorCode(err);
  }
  go(accountId ? `${HOME}/accounts/${accountId}` : `${HOME}/accounts`, { error });
}
