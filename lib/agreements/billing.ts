// What an agreement bills and when, per billing mode. Pure functions shared with billing (08) and the ledger (09);
// the ledger fixtures in fixtures/accounting/agreement-ledger.json are the source of truth for these numbers.
import type { BillingMode } from "@/lib/agreements/cadence";
import type { PlannedVisit } from "@/lib/agreements/visits";
import { addMonths } from "@/lib/dates";

/** Splits a total into `count` installments: each rounded down to the cent, the remainder on the final one. */
export function installments(totalCents: number, count: number): number[] {
  if (!Number.isInteger(totalCents) || totalCents < 0) throw new Error("installments need a non-negative integer number of cents");
  if (!Number.isInteger(count) || count < 1) throw new Error("installments need a positive count");
  const base = Math.floor(totalCents / count);
  const result = new Array<number>(count).fill(base);
  result[count - 1] = totalCents - base * (count - 1);
  return result;
}

export type BillingEvent = {
  /** The day the amount is billed. For per-visit billing, the start of the visit's window: it is billed when the visit completes. */
  date: string;
  amount_cents: number;
  /** Set for per-visit billing. */
  visit_sequence?: number;
};

export type BillingAgreement = { billing_mode: BillingMode; starts_on: string; term_months: number; renewals?: number };

/** The billing schedule for the plan: one event per visit, equal installments, or one prepayment. */
export function billingSchedule(agreement: BillingAgreement, planned: readonly PlannedVisit[]): BillingEvent[] {
  const total = planned.reduce((sum, v) => sum + v.price_cents, 0);
  switch (agreement.billing_mode) {
    case "per_visit":
      return planned.map((v) => ({ date: v.due_start, amount_cents: v.price_cents, visit_sequence: v.sequence }));
    case "flat_monthly": {
      const count = agreement.term_months * (1 + (agreement.renewals ?? 0));
      return installments(total, count).map((amount_cents, i) => ({ date: addMonths(agreement.starts_on, i), amount_cents }));
    }
    case "annual_prepay":
      return [{ date: agreement.starts_on, amount_cents: total }];
  }
}

/** Cents billed by the schedule on or before `date`. */
export function billedThrough(schedule: readonly BillingEvent[], date: string): number {
  return schedule.filter((e) => e.date <= date).reduce((sum, e) => sum + e.amount_cents, 0);
}

export type Settlement = {
  /** Delivered but not yet billed service, invoiced at cancellation when the terms allow. */
  finalInvoiceCents: number;
  /** Prepaid but undelivered service, refunded per the terms. */
  refundCents: number;
  /** The cancellation fee, always its own line. */
  feeCents: number;
  /** The contract position once the settlement posts: always zero. */
  positionAfterCents: 0;
};

/** Settles the contract position at cancellation. Recognized is the sum of completed visit prices; billed is per the schedule to date. */
export function settlementPreview({ billedCents, recognizedCents, cancelFeeCents = 0 }: { billedCents: number; recognizedCents: number; cancelFeeCents?: number }): Settlement {
  const position = billedCents - recognizedCents;
  return {
    finalInvoiceCents: position < 0 ? -position : 0,
    refundCents: position > 0 ? position : 0,
    feeCents: Math.max(0, cancelFeeCents),
    positionAfterCents: 0,
  };
}
