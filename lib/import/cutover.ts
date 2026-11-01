// Mid-term agreements at go-live (spec 10 rules 7 to 10): which planned visits the old system already did, what it
// billed before the cutover by the agreement's own schedule, and the opening contract position. Pure and checked
// against fixtures/import/expected.json.
import { billingSchedule } from "@/lib/agreements/billing";
import type { BillingMode } from "@/lib/agreements/cadence";
import type { PlannedVisit } from "@/lib/agreements/visits";

/** Planned visits due on or before the last service date were done before Bugsy; none when there is no such date. */
export function doneBeforeCutover(planned: readonly PlannedVisit[], lastServiceOn: string | null): PlannedVisit[] {
  if (!lastServiceOn) return [];
  return planned.filter((v) => v.due_start <= lastServiceOn);
}

/** Planned visits due before the cutover that were not done: they stay planned and show as overdue. */
export function overdueAtCutover(planned: readonly PlannedVisit[], lastServiceOn: string | null, cutoverOn: string): PlannedVisit[] {
  const done = new Set(doneBeforeCutover(planned, lastServiceOn).map((v) => v.sequence));
  return planned.filter((v) => !done.has(v.sequence) && v.due_start < cutoverOn);
}

export function deliveredCents(done: readonly PlannedVisit[]): number {
  return done.reduce((sum, v) => sum + v.price_cents, 0);
}

/** What the agreement's own schedule billed before the cutover; for per-visit plans, what was delivered (rule 9). */
export function defaultBilledToDate(agreement: { billing_mode: BillingMode; starts_on: string; term_months: number }, planned: readonly PlannedVisit[], done: readonly PlannedVisit[], cutoverOn: string): number {
  if (agreement.billing_mode === "per_visit") return deliveredCents(done);
  return billingSchedule(agreement, planned)
    .filter((e) => e.date < cutoverOn)
    .reduce((sum, e) => sum + e.amount_cents, 0);
}

/** Billed minus delivered: positive is deferred revenue, negative an unbilled receivable (rule 10). */
export function openingPosition(billedCents: number, done: readonly PlannedVisit[]): number {
  return billedCents - deliveredCents(done);
}
