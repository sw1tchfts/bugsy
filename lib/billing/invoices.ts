// Invoice arithmetic and the status machine (spec 08 rules 1, 3, 6, 9 and 11), pure and fixture tested.
import type { BillingEvent } from "@/lib/agreements/billing";
import { centsAtRate, scaledRate } from "@/lib/billing/tax";
import { addDays } from "@/lib/dates";

export type InvoiceKind = "invoice" | "credit_memo";
export type InvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "past_due" | "void";

export function invoiceTotals(lines: readonly { amount_cents: number; tax_cents: number }[]): { subtotal_cents: number; tax_cents: number; total_cents: number } {
  const subtotal_cents = lines.reduce((sum, l) => sum + l.amount_cents, 0);
  const tax_cents = lines.reduce((sum, l) => sum + l.tax_cents, 0);
  return { subtotal_cents, tax_cents, total_cents: subtotal_cents + tax_cents };
}

/** Net terms: 0 days means due on issue. */
export function dueOn(issuedOn: string, termsDays: number): string {
  return addDays(issuedOn, Math.max(0, termsDays));
}

export type StatusInput = {
  kind: InvoiceKind;
  status: InvoiceStatus;
  total_cents: number;
  paid_cents: number;
  due_on: string | null;
  today: string;
  grace_days: number;
};

/** The status an issued invoice should carry today. Drafts and voids stay; credit memos never go past due. */
export function invoiceStatus(input: StatusInput): InvoiceStatus {
  if (input.status === "draft" || input.status === "void") return input.status;
  if (input.kind === "credit_memo") return "issued";
  if (input.paid_cents >= input.total_cents) return "paid";
  if (input.due_on && addDays(input.due_on, Math.max(0, input.grace_days)) < input.today) return "past_due";
  return input.paid_cents > 0 ? "partially_paid" : "issued";
}

export function installmentKey(agreementId: string, index: number): string {
  return `installment:${agreementId}:${index + 1}`;
}

/** The installments of a flat monthly schedule that are due on or before today, with their idempotency keys. */
export function installmentsDue(agreementId: string, schedule: readonly BillingEvent[], today: string): { index: number; date: string; amount_cents: number; source_key: string }[] {
  return schedule
    .map((e, index) => ({ index, date: e.date, amount_cents: e.amount_cents, source_key: installmentKey(agreementId, index) }))
    .filter((e) => e.date <= today && e.amount_cents > 0);
}

/** A late fee: the fixed amount plus a percent of the open balance, half up to the cent; zero when neither is set. */
export function lateFee(balanceCents: number, settings: { late_fee_cents: number; late_fee_percent: string | number }): number {
  if (balanceCents <= 0) return 0;
  // The percent is a rate like any other: scaled integer arithmetic, half up (rule 14).
  const scaled = scaledRate(String(settings.late_fee_percent)) / BigInt(100);
  const fromPercent = scaled > BigInt(0) ? centsAtRate(balanceCents, scaled) : 0;
  return Math.max(0, settings.late_fee_cents) + fromPercent;
}
