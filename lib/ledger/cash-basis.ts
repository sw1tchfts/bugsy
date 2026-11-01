// The cash-basis view of the income statement (spec 09 rule 15): money counts when it is allocated to an invoice, pro
// rata across the invoice's lines, refunds against it, gateway fees when they are paid out. A report, not a second set
// of books. Pure and tested.
import type { AccountKey } from "./chart";

/** A receipt or refund. A refund names the payment it returns and the allocations it released from it. */
export type CashReceipt = { payment_id: string; received_on: string; amount_cents: number; kind: "payment" | "refund"; refund_of?: string | null; released?: readonly { invoice_id: string; cents: number }[] };
export type CashAllocation = { payment_id: string; invoice_id: string; amount_cents: number };
export type CashInvoiceLine = { invoice_id: string; amount_cents: number; tax_cents: number; account: AccountKey };
export type CashFee = { paid_on: string; fee_cents: number };
export type CashBasisIncome = {
  revenue: { account: AccountKey; amount_cents: number }[];
  revenue_cents: number;
  tax_collected_cents: number;
  unapplied_cents: number;
  refunds_cents: number;
  fees_cents: number;
  net_cents: number;
};

/** Splits `amount` across `weights` proportionally, in integer cents, remainder to the heaviest line. */
export function splitProportionally(amount: number, weights: readonly number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0 || weights.length === 0) return weights.map(() => 0);
  const shares = weights.map((w) => Math.floor((amount * w) / total));
  let left = amount - shares.reduce((s, x) => s + x, 0);
  const order = weights.map((w, i) => i).sort((a, b) => weights[b] - weights[a]);
  for (const i of order) {
    if (left <= 0) break;
    shares[i] += 1;
    left -= 1;
  }
  return shares;
}

export function cashBasisIncome(
  input: { receipts: readonly CashReceipt[]; allocations: readonly CashAllocation[]; lines: readonly CashInvoiceLine[]; fees: readonly CashFee[] },
  range: { from: string; to: string },
): CashBasisIncome {
  const inRange = (d: string) => d >= range.from && d <= range.to;
  const linesByInvoice = new Map<string, CashInvoiceLine[]>();
  for (const l of input.lines) linesByInvoice.set(l.invoice_id, [...(linesByInvoice.get(l.invoice_id) ?? []), l]);
  // A refund that released allocations shrank them after the fact: the receipt counts what it was first allocated,
  // on its own day, and the refund counts on its day.
  const allocationsByPayment = new Map<string, CashAllocation[]>();
  for (const a of input.allocations) allocationsByPayment.set(a.payment_id, [...(allocationsByPayment.get(a.payment_id) ?? []), a]);
  for (const r of input.receipts) {
    if (r.kind !== "refund" || !r.refund_of) continue;
    for (const rel of r.released ?? []) {
      if (rel.cents > 0) allocationsByPayment.set(r.refund_of, [...(allocationsByPayment.get(r.refund_of) ?? []), { payment_id: r.refund_of, invoice_id: rel.invoice_id, amount_cents: rel.cents }]);
    }
  }
  const revenue = new Map<AccountKey, number>();
  let tax = 0;
  let unapplied = 0;
  let refunds = 0;
  for (const r of input.receipts) {
    if (!inRange(r.received_on)) continue;
    if (r.kind === "refund") {
      refunds += r.amount_cents;
      continue;
    }
    let applied = 0;
    for (const a of allocationsByPayment.get(r.payment_id) ?? []) {
      applied += a.amount_cents;
      const lines = linesByInvoice.get(a.invoice_id) ?? [];
      const shares = splitProportionally(a.amount_cents, lines.map((l) => Math.max(0, l.amount_cents + l.tax_cents)));
      lines.forEach((l, i) => {
        const gross = l.amount_cents + l.tax_cents;
        const service = gross > 0 ? Math.round((shares[i] * l.amount_cents) / gross) : 0;
        revenue.set(l.account, (revenue.get(l.account) ?? 0) + service);
        tax += shares[i] - service;
      });
    }
    unapplied += Math.max(0, r.amount_cents - applied);
  }
  const fees = input.fees.filter((f) => inRange(f.paid_on)).reduce((s, f) => s + f.fee_cents, 0);
  const rows = [...revenue.entries()].map(([account, amount_cents]) => ({ account, amount_cents })).sort((a, b) => a.account.localeCompare(b.account));
  const revenue_cents = rows.reduce((s, r) => s + r.amount_cents, 0);
  return { revenue: rows, revenue_cents, tax_collected_cents: tax, unapplied_cents: unapplied, refunds_cents: refunds, fees_cents: fees, net_cents: revenue_cents - refunds - fees };
}
