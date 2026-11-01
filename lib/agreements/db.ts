// Agreement operations that touch the database. Used by the office actions under row level security and by the seed
// as superuser, so the client is typed structurally and nothing here imports server-only modules.
import type postgres from "postgres";
import { type BillingEvent, type Settlement, billedThrough, billingSchedule, settlementPreview } from "@/lib/agreements/billing";
import type { BillingMode, Cadence, CadenceRule, PlanInput } from "@/lib/agreements/cadence";
import { type IncreaseRule, increasedPrice } from "@/lib/agreements/increase";
import { type ExistingVisit, type PlannedVisit, planVisits, regenerationPlan } from "@/lib/agreements/visits";
import { addDays } from "@/lib/dates";

type Sql = postgres.Sql | postgres.TransactionSql;

export type AgreementRow = PlanInput & {
  id: string;
  tenant_id: string;
  number: number;
  account_id: string;
  property_id: string;
  service_type_id: string;
  branch_id: string | null;
  status: "draft" | "active" | "on_hold" | "cancelled" | "ended";
  billing_mode: BillingMode;
  ends_on: string;
  renewals: number;
  auto_renew: boolean;
  cancel_fee_cents: number;
};

type RawAgreement = Omit<AgreementRow, "initial_price_cents" | "recurring_price_cents" | "cancel_fee_cents" | "cadence_rule" | "cadence"> & {
  initial_price_cents: string | number;
  recurring_price_cents: string | number;
  cancel_fee_cents: string | number;
  cadence_rule: CadenceRule | null;
  cadence: Cadence;
};

export async function loadAgreement(tx: Sql, tenantId: string, agreementId: string): Promise<AgreementRow | null> {
  const [row] = await tx<RawAgreement[]>`
    select id, tenant_id, number, account_id, property_id, service_type_id, branch_id, status, cadence, cadence_rule, starts_on, ends_on, term_months, renewals,
           first_visit_on, season_start, season_end, skip_months, interior_only_months, window_days, initial_price_cents, recurring_price_cents,
           billing_mode, auto_renew, cancel_fee_cents
    from public.agreements where id = ${agreementId} and tenant_id = ${tenantId}`;
  if (!row) return null;
  return {
    ...row,
    cadence_rule: row.cadence_rule ?? null,
    initial_price_cents: Number(row.initial_price_cents),
    recurring_price_cents: Number(row.recurring_price_cents),
    cancel_fee_cents: Number(row.cancel_fee_cents),
    skip_months: row.skip_months ?? [],
    interior_only_months: row.interior_only_months ?? [],
  };
}

async function existingVisits(tx: Sql, tenantId: string, agreementId: string): Promise<ExistingVisit[]> {
  return tx<ExistingVisit[]>`
    select id, kind, sequence, due_start, due_end, status, price_cents, imported from public.visits
    where agreement_id = ${agreementId} and tenant_id = ${tenantId} order by sequence`;
}

async function insertPlanned(tx: Sql, agreement: AgreementRow, visits: readonly PlannedVisit[]): Promise<void> {
  for (const v of visits) {
    await tx`
      insert into public.visits (tenant_id, agreement_id, account_id, property_id, service_type_id, branch_id, kind, sequence, due_start, due_end, price_cents, interior_only)
      values (${agreement.tenant_id}, ${agreement.id}, ${agreement.account_id}, ${agreement.property_id}, ${agreement.service_type_id}, ${agreement.branch_id},
              ${v.kind}, ${v.sequence}, ${v.due_start}, ${v.due_end}, ${v.price_cents}, ${v.interior_only})`;
  }
}

/**
 * Brings the agreement's visits in line with its plan: generates them the first time, and on later calls replaces
 * only planned visits (rule 6). Returns how many visits were inserted.
 */
export async function syncVisits(tx: Sql, tenantId: string, agreementId: string): Promise<number> {
  const agreement = await loadAgreement(tx, tenantId, agreementId);
  if (!agreement) throw new Error("agreement not found");
  const plan = regenerationPlan(await existingVisits(tx, tenantId, agreementId), planVisits(agreement));
  if (plan.remove.length) await tx`delete from public.visits where tenant_id = ${tenantId} and id in ${tx(plan.remove)}`;
  await insertPlanned(tx, agreement, plan.insert);
  return plan.insert.length;
}

/** Books a free re-service on an active agreement, due within the given window (default the next 7 days). */
export async function bookReservice(tx: Sql, tenantId: string, agreementId: string, reason: string, dueStart: string, dueEnd: string = addDays(dueStart, 6)): Promise<string> {
  const agreement = await loadAgreement(tx, tenantId, agreementId);
  if (!agreement) throw new Error("agreement not found");
  if (agreement.status !== "active") throw Object.assign(new Error("re-services need an active agreement"), { code: "23514" });
  const [{ next }] = await tx<{ next: number }[]>`select coalesce(max(sequence), 0) + 1 as next from public.visits where agreement_id = ${agreementId}`;
  const [row] = await tx<{ id: string }[]>`
    insert into public.visits (tenant_id, agreement_id, account_id, property_id, service_type_id, branch_id, kind, sequence, due_start, due_end, price_cents, reservice_reason)
    values (${tenantId}, ${agreementId}, ${agreement.account_id}, ${agreement.property_id}, ${agreement.service_type_id}, ${agreement.branch_id},
            'reservice', ${next}, ${dueStart}, ${dueEnd}, 0, ${reason}) returning id`;
  return row.id;
}

/** Reprices recurring visits still ahead of the effective date (rule 8). */
export async function repriceFutureVisits(tx: Sql, tenantId: string, agreementId: string, effectiveOn: string, newPriceCents: number): Promise<number> {
  const result = await tx`
    update public.visits set price_cents = ${newPriceCents}
    where tenant_id = ${tenantId} and agreement_id = ${agreementId} and kind = 'recurring' and status in ('planned', 'scheduled') and due_start >= ${effectiveOn}`;
  return result.count;
}

/** Changes one agreement's recurring price from a date, with its change row. */
export async function changeRecurringPrice(
  tx: Sql,
  tenantId: string,
  agreementId: string,
  newPriceCents: number,
  effectiveOn: string,
  reason: "bulk_increase" | "manual" | "renewal",
  priceIncreaseId: string | null = null,
): Promise<boolean> {
  const agreement = await loadAgreement(tx, tenantId, agreementId);
  if (!agreement) throw new Error("agreement not found");
  if (newPriceCents === agreement.recurring_price_cents) return false;
  await tx`
    insert into public.agreement_price_changes (tenant_id, agreement_id, price_increase_id, old_recurring_price_cents, new_recurring_price_cents, effective_on, reason)
    values (${tenantId}, ${agreementId}, ${priceIncreaseId}, ${agreement.recurring_price_cents}, ${newPriceCents}, ${effectiveOn}, ${reason})`;
  await tx`update public.agreements set recurring_price_cents = ${newPriceCents} where id = ${agreementId} and tenant_id = ${tenantId}`;
  await repriceFutureVisits(tx, tenantId, agreementId, effectiveOn, newPriceCents);
  return true;
}

export type IncreaseRow = IncreaseRule & { id: string; effective_on: string; service_type_id: string | null; branch_id: string | null; billing_mode: string | null; applied_at: string | null };

/** Agreements a price increase would touch. */
export async function increaseTargets(tx: Sql, tenantId: string, increase: Pick<IncreaseRow, "service_type_id" | "branch_id" | "billing_mode">): Promise<{ id: string; number: number; recurring_price_cents: string | number }[]> {
  return tx<{ id: string; number: number; recurring_price_cents: string | number }[]>`
    select id, number, recurring_price_cents from public.agreements
    where tenant_id = ${tenantId} and status = 'active'
      and (${increase.service_type_id}::uuid is null or service_type_id = ${increase.service_type_id})
      and (${increase.branch_id}::uuid is null or branch_id = ${increase.branch_id})
      and (${increase.billing_mode}::text is null or billing_mode = ${increase.billing_mode})
    order by number`;
}

/** Applies a bulk increase once: a change row per agreement, new recurring prices, future visits repriced (rule 8). */
export async function applyPriceIncrease(tx: Sql, tenantId: string, increaseId: string): Promise<number> {
  const [increase] = await tx<IncreaseRow[]>`
    select id, kind, percent, amount_cents, rounding, effective_on, service_type_id, branch_id, billing_mode, applied_at
    from public.price_increases where id = ${increaseId} and tenant_id = ${tenantId} for update`;
  if (!increase) throw new Error("price increase not found");
  if (increase.applied_at) throw Object.assign(new Error("this price increase was already applied"), { code: "23514" });
  let changed = 0;
  for (const target of await increaseTargets(tx, tenantId, increase)) {
    const newPrice = increasedPrice(Number(target.recurring_price_cents), increase);
    if (await changeRecurringPrice(tx, tenantId, target.id, newPrice, increase.effective_on, "bulk_increase", increase.id)) changed += 1;
  }
  await tx`update public.price_increases set applied_at = now(), agreements_changed = ${changed} where id = ${increaseId} and tenant_id = ${tenantId}`;
  return changed;
}

/**
 * Extends the term by one more term and plans only the new term's visits (rule 9). The current term's visits,
 * planned or not, are left exactly as they are, including any price that is not due to change until later.
 */
export async function renewAgreement(tx: Sql, tenantId: string, agreementId: string): Promise<number> {
  const agreement = await loadAgreement(tx, tenantId, agreementId);
  if (!agreement) throw new Error("agreement not found");
  if (agreement.status !== "active") throw Object.assign(new Error("only an active agreement renews"), { code: "23514" });
  const previousEnd = agreement.ends_on;
  const [last] = await tx<{ price_cents: string | number; due_start: string }[]>`
    select price_cents, due_start from public.visits where agreement_id = ${agreementId} and kind = 'recurring' and status <> 'cancelled' order by due_start desc limit 1`;
  await tx`update public.agreements set renewals = renewals + 1 where id = ${agreementId} and tenant_id = ${tenantId}`;
  const renewed = await loadAgreement(tx, tenantId, agreementId);
  if (!renewed) throw new Error("agreement not found");
  const existing = await existingVisits(tx, tenantId, agreementId);
  let sequence = existing.reduce((max, v) => Math.max(max, v.sequence), 0);
  const nextTerm = planVisits(renewed)
    .filter((v) => v.due_start > previousEnd)
    .map((v) => ({ ...v, kind: "recurring" as const, price_cents: renewed.recurring_price_cents, sequence: ++sequence }));
  await insertPlanned(tx, renewed, nextTerm);
  if (last && Number(last.price_cents) !== agreement.recurring_price_cents) {
    // A change already dated after the last visit (a bulk increase effective next term) is the reason the prices differ; no second notice.
    const [announced] = await tx<{ id: string }[]>`
      select id from public.agreement_price_changes
      where agreement_id = ${agreementId} and new_recurring_price_cents = ${agreement.recurring_price_cents} and effective_on > ${last.due_start} limit 1`;
    if (!announced) {
      await tx`
        insert into public.agreement_price_changes (tenant_id, agreement_id, old_recurring_price_cents, new_recurring_price_cents, effective_on, reason)
        values (${tenantId}, ${agreementId}, ${Number(last.price_cents)}, ${agreement.recurring_price_cents}, ${addDays(previousEnd, 1)}, 'renewal')`;
    }
  }
  return nextTerm.length;
}

/** Renews every auto-renewing agreement that ends within 30 days of `today` (rule 9). Returns the agreement ids renewed. */
export async function runAutoRenewals(tx: Sql, tenantId: string, today: string): Promise<string[]> {
  const due = await tx<{ id: string }[]>`
    select id from public.agreements
    where tenant_id = ${tenantId} and status = 'active' and auto_renew and ends_on >= ${today} and ends_on <= ${addDays(today, 30)} order by ends_on`;
  for (const a of due) await renewAgreement(tx, tenantId, a.id);
  return due.map((a) => a.id);
}

/** The housekeeping a renewals view or a scheduled job runs: end what expired, renew what asked to be renewed. */
export async function maintainTerms(tx: Sql, tenantId: string, today: string): Promise<{ ended: number; renewed: string[] }> {
  const renewed = await runAutoRenewals(tx, tenantId, today);
  const ended = await endExpiredAgreements(tx, tenantId, today);
  return { ended, renewed };
}

/** Marks active agreements whose term has passed, and did not renew, as ended. */
export async function endExpiredAgreements(tx: Sql, tenantId: string, today: string): Promise<number> {
  const result = await tx`update public.agreements set status = 'ended' where tenant_id = ${tenantId} and status = 'active' and ends_on < ${today}`;
  return result.count;
}

export type SettlementData = Settlement & { billedCents: number; recognizedCents: number; schedule: BillingEvent[] };

/** What cancelling on `effectiveOn` settles (rule 10): recognized from completed visits, billed per the schedule to that date. */
export async function settlementFor(tx: Sql, tenantId: string, agreementId: string, effectiveOn: string): Promise<SettlementData> {
  const agreement = await loadAgreement(tx, tenantId, agreementId);
  if (!agreement) throw new Error("agreement not found");
  const visits = await existingVisits(tx, tenantId, agreementId);
  const plan: PlannedVisit[] = visits
    .filter((v) => (v.kind === "initial" || v.kind === "recurring") && v.status !== "cancelled" && v.status !== "skipped")
    .map((v) => ({ kind: v.kind as "initial" | "recurring", sequence: v.sequence, due_start: v.due_start, due_end: v.due_end, price_cents: Number(v.price_cents), interior_only: false }));
  const recognizedCents = visits.filter((v) => v.status === "completed").reduce((sum, v) => sum + Number(v.price_cents), 0);
  const schedule = billingSchedule(agreement, plan);
  // An imported agreement: the old system billed imported_billed_cents before the cutover; Bugsy billed its own schedule
  // from the cutover on, or for per-visit plans the visits completed in Bugsy (spec 10 rules 8 and 10).
  const [imported] = await tx<{ cutover_on: string | null; imported_billed_cents: string | number | null }[]>`
    select cutover_on, imported_billed_cents from public.agreements where id = ${agreementId} and tenant_id = ${tenantId}`;
  let billedCents: number;
  if (imported?.cutover_on) {
    const cutover = imported.cutover_on;
    const before = Number(imported.imported_billed_cents ?? 0);
    billedCents =
      agreement.billing_mode === "per_visit"
        ? before + visits.filter((v) => v.status === "completed" && !v.imported).reduce((sum, v) => sum + Number(v.price_cents), 0)
        : before + billedThrough(schedule.filter((e) => e.date >= cutover), effectiveOn);
  } else {
    billedCents = agreement.billing_mode === "per_visit" ? recognizedCents : billedThrough(schedule, effectiveOn);
  }
  return { ...settlementPreview({ billedCents, recognizedCents, cancelFeeCents: agreement.cancel_fee_cents }), billedCents, recognizedCents, schedule };
}

export type CancelInput = { effectiveOn: string; reasonId: string | null; note: string | null; saveOfferMade: boolean; saveOutcome: "saved" | "lost" | null };

/** Cancels the agreement and the visits still ahead of the effective date (rule 10). */
export async function cancelAgreement(tx: Sql, tenantId: string, agreementId: string, input: CancelInput): Promise<void> {
  await tx`
    update public.agreements
    set status = 'cancelled', cancelled_on = ${input.effectiveOn}, cancel_reason_id = ${input.reasonId}, cancel_note = ${input.note},
        save_offer_made = ${input.saveOfferMade}, save_outcome = ${input.saveOutcome}
    where id = ${agreementId} and tenant_id = ${tenantId}`;
  await tx`
    update public.visits set status = 'cancelled'
    where tenant_id = ${tenantId} and agreement_id = ${agreementId} and status in ('planned', 'scheduled') and due_end >= ${input.effectiveOn}`;
}
