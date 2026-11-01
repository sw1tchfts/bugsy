import { endOfMonth, isIsoDate, startOfMonth } from "@/lib/dates";
import { formatCents } from "@/lib/money";

/** A from/to range from the query string, defaulting to the month of `today`. */
export function rangeFromParams(params: { from?: string; to?: string }, today: string): { from: string; to: string } {
  const to = params.to && isIsoDate(params.to) ? params.to : endOfMonth(today);
  const from = params.from && isIsoDate(params.from) ? params.from : startOfMonth(to);
  return { from: from <= to ? from : startOfMonth(to), to };
}

/** Money with its sign, for balances that can run either way. */
export function signed(cents: number): string {
  return cents < 0 ? `(${formatCents(-cents)})` : formatCents(cents);
}

export const SOURCE_LABELS: Record<string, string> = {
  invoice: "Invoice",
  credit_memo: "Credit memo",
  void: "Void",
  visit: "Visit",
  product_use: "Product use",
  payment: "Payment",
  refund: "Refund",
  payout: "Payout",
  reclass: "Period-end reclass",
  reclass_reversal: "Reclass reversal",
  opening: "Opening position",
  manual: "Manual",
  reversal: "Reversal",
  recognition: "Warranty recognition",
  commission: "Commission",
  commission_payout: "Commission payout",
  stock_receipt: "Stock receipt",
  stock_adjustment: "Stock count",
  payroll: "Payroll",
};
