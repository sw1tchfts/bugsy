import { dateInZone } from "@/lib/dates";

// The account statement (spec 08 rule 14): issued invoices and credit memos minus succeeded payments plus refunds,
// as dated lines with a running balance, plus what is open and what credit is unallocated. Pure and tested.

export type StatementInvoice = {
  id: string;
  number: number | null;
  kind: "invoice" | "credit_memo";
  status: string;
  issued_on: string | null;
  due_on: string | null;
  total_cents: number;
  paid_cents: number;
  source: string;
  memo: string | null;
};

export type StatementPayment = {
  id: string;
  kind: "payment" | "refund";
  method: string;
  status: string;
  amount_cents: number;
  /** The instant the money arrived; its statement date is the business date in the company's time zone. */
  received_at: string | Date;
  reference: string | null;
  refund_of: string | null;
};

export type StatementAllocation = { payment_id: string; invoice_id: string; amount_cents: number };

export type StatementLine = {
  date: string;
  type: "invoice" | "credit_memo" | "payment" | "refund";
  ref: string;
  description: string;
  amount_cents: number;
  balance_cents: number;
};

export type Statement = {
  lines: StatementLine[];
  balance_cents: number;
  open_invoices_cents: number;
  unallocated_cents: number;
  past_due_cents: number;
};

/** The business date of an instant: in the company's zone when given, else the UTC calendar date. */
const dateOf = (value: string | Date, timeZone?: string) => (timeZone ? dateInZone(value, timeZone) : (typeof value === "string" ? value : value.toISOString()).slice(0, 10));

/** The statement over everything issued and every money movement, oldest first. */
export function statement(invoices: readonly StatementInvoice[], payments: readonly StatementPayment[], allocations: readonly StatementAllocation[], today?: string, timeZone?: string): Statement {
  const issued = invoices.filter((i) => i.status !== "draft" && i.status !== "void");
  const money = payments.filter((p) => p.status === "succeeded" || p.status === "refunded");
  const events: Omit<StatementLine, "balance_cents">[] = [
    ...issued.map((i) => ({
      date: i.issued_on ?? "",
      type: i.kind,
      ref: i.number !== null ? `#${i.number}` : "",
      description: i.kind === "credit_memo" ? `Credit memo${i.memo ? `: ${i.memo}` : ""}` : `Invoice (${i.source.replace("_", " ")})${i.memo ? `: ${i.memo}` : ""}`,
      amount_cents: i.total_cents,
    })),
    ...money.map((p) => ({
      date: dateOf(p.received_at, timeZone),
      type: p.kind,
      ref: p.reference ?? "",
      description: p.kind === "refund" ? `Refund (${p.method.replace("_", " ")})` : `Payment (${p.method.replace("_", " ")})`,
      amount_cents: p.kind === "refund" ? p.amount_cents : -p.amount_cents,
    })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.type === "payment" ? 1 : -1));
  let balance = 0;
  const lines = events.map((e) => {
    balance += e.amount_cents;
    return { ...e, balance_cents: balance };
  });
  const open_invoices_cents = issued.filter((i) => i.kind === "invoice").reduce((sum, i) => sum + Math.max(0, i.total_cents - i.paid_cents), 0);
  const allocatedByPayment = new Map<string, number>();
  for (const a of allocations) allocatedByPayment.set(a.payment_id, (allocatedByPayment.get(a.payment_id) ?? 0) + a.amount_cents);
  const refundedByPayment = new Map<string, number>();
  for (const r of money.filter((p) => p.kind === "refund" && p.refund_of)) refundedByPayment.set(r.refund_of as string, (refundedByPayment.get(r.refund_of as string) ?? 0) + r.amount_cents);
  const unallocated_cents = money
    .filter((p) => p.kind === "payment")
    .reduce((sum, p) => sum + Math.max(0, p.amount_cents - (allocatedByPayment.get(p.id) ?? 0) - (refundedByPayment.get(p.id) ?? 0)), 0);
  const past_due_cents = today ? issued.filter((i) => i.kind === "invoice" && i.status === "past_due").reduce((sum, i) => sum + i.total_cents - i.paid_cents, 0) : 0;
  return { lines, balance_cents: balance, open_invoices_cents, unallocated_cents, past_due_cents };
}
