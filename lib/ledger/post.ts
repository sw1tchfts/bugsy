// The posting engine (spec 09 rules 2 to 8 and 13): each business event becomes balanced lines on the template's
// accounts. Pure and fixture tested against fixtures/accounting/posting-rules.json; lib/ledger/db.ts maps the keys
// to the company's accounts and writes the entry.
import { convertUnit } from "@/lib/catalog/label-rates";
import type { AccountKey } from "./chart";
import { revenueAccountFor } from "./chart";

export type PostingLine = {
  account: AccountKey;
  debit_cents: number;
  credit_cents: number;
  agreement_id?: string | null;
  jurisdiction?: string | null;
  memo?: string | null;
};

type Signed = { account: AccountKey; cents: number; agreement_id?: string | null; jurisdiction?: string | null; memo?: string | null };

/** Merges signed amounts per account, agreement and jurisdiction; positive is a credit, negative a debit. */
function settle(entries: readonly Signed[]): PostingLine[] {
  const merged = new Map<string, Signed>();
  for (const e of entries) {
    if (e.cents === 0) continue;
    const key = `${e.account}|${e.agreement_id ?? ""}|${e.jurisdiction ?? ""}`;
    const had = merged.get(key);
    if (had) had.cents += e.cents;
    else merged.set(key, { ...e });
  }
  const out: PostingLine[] = [];
  for (const e of merged.values()) {
    if (e.cents === 0) continue;
    out.push({
      account: e.account,
      debit_cents: e.cents < 0 ? -e.cents : 0,
      credit_cents: e.cents > 0 ? e.cents : 0,
      agreement_id: e.agreement_id ?? null,
      jurisdiction: e.jurisdiction ?? null,
      memo: e.memo ?? null,
    });
  }
  // Debits first, the way a bookkeeper reads an entry.
  return out.sort((a, b) => (a.debit_cents > 0 ? 0 : 1) - (b.debit_cents > 0 ? 0 : 1));
}

export function isBalanced(lines: readonly PostingLine[]): boolean {
  return lines.reduce((sum, l) => sum + l.debit_cents - l.credit_cents, 0) === 0;
}

export function mirror(lines: readonly PostingLine[]): PostingLine[] {
  return lines.map((l) => ({ ...l, debit_cents: l.credit_cents, credit_cents: l.debit_cents }));
}

// ---------------------------------------------------------------------------
// Invoices and credit memos (rule 2 and the credit memo and void half of rule 5)
// ---------------------------------------------------------------------------

export type InvoiceLineEvent = {
  amount_cents: number;
  tax_cents: number;
  tax_breakdown: readonly { kind: string; name: string; cents: number }[];
  service_line: string | null;
  agreement_id: string | null;
  kind: "service" | "fee" | "late_fee" | "opening";
};

export type InvoiceEvent = { kind: "invoice" | "credit_memo"; source: string; lines: readonly InvoiceLineEvent[] };

/** Where an invoice line's service amount goes: the contract balance when it is on an agreement, else straight to income. */
export function invoiceLineAccount(line: Pick<InvoiceLineEvent, "kind" | "agreement_id" | "service_line">, source: string): AccountKey {
  // What a customer owed at go-live was earned in the old books (spec 10 rule 11).
  if (line.kind === "opening" || source === "opening") return "opening_balance_equity";
  if (line.kind === "late_fee" || source === "late_fee") return "late_fee_income";
  if (line.kind === "fee") return "cancellation_fee_income";
  if (line.agreement_id) return "contract_liability";
  return revenueAccountFor(line.service_line);
}

/** Receivables for the total; each line to its account; the tax to sales tax payable per jurisdiction. A credit memo
 *  carries negative amounts and so posts the mirror image. */
export function invoiceLines(event: InvoiceEvent): PostingLine[] {
  const signed: Signed[] = [];
  let total = 0;
  for (const line of event.lines) {
    total += line.amount_cents + line.tax_cents;
    const account = invoiceLineAccount(line, event.source);
    signed.push({ account, cents: line.amount_cents, agreement_id: account === "contract_liability" ? line.agreement_id : null });
    let spread = 0;
    for (const b of line.tax_breakdown) {
      signed.push({ account: "sales_tax_payable", cents: b.cents, jurisdiction: `${b.kind}:${b.name}` });
      spread += b.cents;
    }
    if (spread !== line.tax_cents) signed.push({ account: "sales_tax_payable", cents: line.tax_cents - spread, jurisdiction: null });
  }
  signed.push({ account: "accounts_receivable", cents: -total });
  return settle(signed);
}

// ---------------------------------------------------------------------------
// Visits and product use (rules 3 and 4)
// ---------------------------------------------------------------------------

export type VisitEvent = { price_cents: number; service_line: string | null; agreement_id: string | null };

/** Revenue is earned at completion out of the contract balance. A $0 visit (a re-service) earns nothing; a visit with
 *  no agreement was billed straight to income by its invoice and has nothing left to recognize. */
export function visitLines(event: VisitEvent): PostingLine[] {
  if (!event.agreement_id || event.price_cents <= 0) return [];
  return settle([
    { account: "contract_liability", cents: -event.price_cents, agreement_id: event.agreement_id },
    { account: revenueAccountFor(event.service_line), cents: event.price_cents },
  ]);
}

/** Straight-line recognition (spec 15 rule 2): earned revenue out of the contract balance, or back in when negative. */
export function recognitionLines(event: { cents: number; service_line: string; agreement_id: string }): PostingLine[] {
  if (event.cents === 0) return [];
  return settle([
    { account: "contract_liability", cents: -event.cents, agreement_id: event.agreement_id },
    { account: revenueAccountFor(event.service_line), cents: event.cents },
  ]);
}

/** Spec 17 rule 5: a released commission is an expense owed to the seller; negative cents reverse it (a chargeback). */
export function commissionLines(cents: number): PostingLine[] {
  return settle([
    { account: "commissions_expense", cents: -cents },
    { account: "commissions_payable", cents },
  ]);
}

/** Spec 17 rule 7: paying a seller settles what the books owed them. */
export function commissionPayoutLines(cents: number): PostingLine[] {
  return settle([
    { account: "commissions_payable", cents: -cents },
    { account: "operating_bank", cents },
  ]);
}

export type ProductUseEvent = { quantity: string | number; usage_unit: string; unit_cost_cents: number; cost_unit: string };

/** Quantity in the cost unit times the unit cost, half up to the cent; null when the units do not convert. */
export function productCostCents(event: ProductUseEvent): number | null {
  const quantity = Number(event.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0 || event.unit_cost_cents <= 0) return 0;
  const inCostUnit = convertUnit(quantity, event.usage_unit, event.cost_unit);
  if (inCostUnit === null) return null;
  return Math.round(inCostUnit * event.unit_cost_cents + 1e-6);
}

export function productUseLines(event: ProductUseEvent): PostingLine[] | null {
  const cents = productCostCents(event);
  if (cents === null) return null;
  if (cents === 0) return [];
  return settle([
    { account: "chemical_cost", cents: -cents },
    { account: "chemical_inventory", cents },
  ]);
}

// ---------------------------------------------------------------------------
// Money (rules 5 and 6)
// ---------------------------------------------------------------------------

export type PaymentEvent = { method: string; amount_cents: number };

/** Card and bank money waits in the gateway's clearing account; cash and checks go to the bank. */
export function moneyAccountFor(method: string): AccountKey {
  return method === "card" || method === "us_bank_account" ? "stripe_clearing" : "operating_bank";
}

export function paymentLines(event: PaymentEvent): PostingLine[] {
  if (event.amount_cents <= 0) return [];
  return settle([
    { account: moneyAccountFor(event.method), cents: -event.amount_cents },
    { account: "accounts_receivable", cents: event.amount_cents },
  ]);
}

export function refundLines(event: PaymentEvent): PostingLine[] {
  return mirror(paymentLines(event));
}

export type PayoutEvent = { gross_cents: number; fee_cents: number };

export function payoutLines(event: PayoutEvent): PostingLine[] {
  if (event.gross_cents <= 0) return [];
  return settle([
    { account: "operating_bank", cents: -(event.gross_cents - event.fee_cents) },
    { account: "processing_fees", cents: -event.fee_cents },
    { account: "stripe_clearing", cents: event.gross_cents },
  ]);
}

// ---------------------------------------------------------------------------
// Contract balances (rules 7, 8 and 13)
// ---------------------------------------------------------------------------

/** What a contract liability line is for: billing moves the balance up, recognition down, presentation is the
 *  period-end reclass that moves a debit balance to the contract asset account and back. */
export type ContractLineKind = "billing" | "recognition" | "presentation";

export type ContractLine = { agreement_id: string; kind: ContractLineKind; debit_cents: number; credit_cents: number; posted_on: string };

export type ContractPosition = { agreement_id: string; billed_cents: number; recognized_cents: number; position_cents: number; deferred_cents: number; asset_cents: number };

/** Per agreement: cumulative billed, recognized and the position (billed minus recognized) through `through`. */
export function contractPositions(lines: readonly ContractLine[], through?: string): ContractPosition[] {
  const by = new Map<string, ContractPosition>();
  for (const l of lines) {
    if (l.kind === "presentation") continue;
    if (through && l.posted_on > through) continue;
    const row = by.get(l.agreement_id) ?? { agreement_id: l.agreement_id, billed_cents: 0, recognized_cents: 0, position_cents: 0, deferred_cents: 0, asset_cents: 0 };
    if (l.kind === "billing") row.billed_cents += l.credit_cents - l.debit_cents;
    else row.recognized_cents += l.debit_cents - l.credit_cents;
    by.set(l.agreement_id, row);
  }
  for (const row of by.values()) {
    row.position_cents = row.billed_cents - row.recognized_cents;
    row.deferred_cents = Math.max(0, row.position_cents);
    row.asset_cents = Math.max(0, -row.position_cents);
  }
  return [...by.values()].sort((a, b) => a.agreement_id.localeCompare(b.agreement_id));
}

/** Period end: agreements with a debit (negative) balance are presented as a contract asset (rule 8). */
export function reclassLines(positions: readonly { agreement_id: string; position_cents: number }[]): PostingLine[] {
  const signed: Signed[] = [];
  for (const p of positions) {
    if (p.position_cents >= 0) continue;
    signed.push({ account: "contract_asset", cents: p.position_cents, agreement_id: p.agreement_id });
    signed.push({ account: "contract_liability", cents: -p.position_cents, agreement_id: p.agreement_id });
  }
  return settle(signed);
}

export type OpeningEvent = { agreement_id: string; billed_cents: number; recognized_cents: number };

/** A mid-term agreement at go-live: its net position against opening balance equity (rule 13). */
export function openingLines(event: OpeningEvent): PostingLine[] {
  const position = event.billed_cents - event.recognized_cents;
  if (position === 0) return [];
  return settle([
    { account: "contract_liability", cents: position, agreement_id: event.agreement_id },
    { account: "opening_balance_equity", cents: -position },
  ]);
}
