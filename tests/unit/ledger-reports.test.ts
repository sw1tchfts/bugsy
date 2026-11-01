import { describe, expect, it } from "vitest";
import { cashBasisIncome, splitProportionally } from "@/lib/ledger/cash-basis";
import { CHART_TEMPLATE } from "@/lib/ledger/chart";
import type { PostingLine } from "@/lib/ledger/post";
import { invoiceLines, payoutLines, paymentLines, productUseLines, visitLines } from "@/lib/ledger/post";
import type { ReportAccount, ReportLine } from "@/lib/ledger/reports";
import { balanceSheet, incomeStatement, trialBalance } from "@/lib/ledger/reports";

const accounts: ReportAccount[] = CHART_TEMPLATE.map((a) => ({ id: a.key, key: a.key, number: a.number, name: a.name, type: a.type, subtype: a.subtype, active: true }));
const dated = (lines: PostingLine[] | null, posted_on: string): ReportLine[] => (lines ?? []).map((l) => ({ account_id: l.account, posted_on, debit_cents: l.debit_cents, credit_cents: l.credit_cents }));

// One January: a $100 installment invoiced and paid by card, the visit done, 8 fl oz of a $64/gal product used, the payout.
const lines: ReportLine[] = [
  ...dated(invoiceLines({ kind: "invoice", source: "installment", lines: [{ amount_cents: 10000, tax_cents: 0, tax_breakdown: [], service_line: "general_pest", agreement_id: "a1", kind: "service" }] }), "2027-01-05"),
  ...dated(visitLines({ price_cents: 10000, service_line: "general_pest", agreement_id: "a1" }), "2027-01-20"),
  ...dated(productUseLines({ quantity: "8", usage_unit: "fl_oz", unit_cost_cents: 6400, cost_unit: "gal" }), "2027-01-20"),
  ...dated(paymentLines({ amount_cents: 10000, method: "card" }), "2027-01-25"),
  ...dated(payoutLines({ gross_cents: 10000, fee_cents: 320 }), "2027-01-27"),
];

describe("statements from the journal (spec 09 rule 16)", () => {
  it("trial balance: debits equal credits, balances carry across the range", () => {
    const tb = trialBalance(accounts, lines, { from: "2027-01-01", to: "2027-01-31" });
    expect(tb.balanced).toBe(true);
    const closing = Object.fromEntries(tb.rows.map((r) => [r.account.key, r.closing_cents]));
    expect(closing.operating_bank).toBe(9680);
    expect(closing.processing_fees).toBe(320);
    expect(closing.chemical_cost).toBe(400);
    expect(closing.chemical_inventory).toBe(-400);
    expect(closing.revenue_general_pest).toBe(-10000);
    expect(closing.accounts_receivable).toBe(0);
    expect(closing.contract_liability).toBe(0);
    const feb = trialBalance(accounts, lines, { from: "2027-02-01", to: "2027-02-28" });
    expect(feb.rows.find((r) => r.account.key === "operating_bank")).toMatchObject({ opening_cents: 9680, debit_cents: 0, credit_cents: 0, closing_cents: 9680 });
  });

  it("income statement and balance sheet agree, with income to date as equity", () => {
    const pl = incomeStatement(accounts, lines, { from: "2027-01-01", to: "2027-01-31" });
    expect(pl.revenue_cents).toBe(10000);
    expect(pl.expenses_cents).toBe(720);
    expect(pl.net_income_cents).toBe(9280);
    const bs = balanceSheet(accounts, lines, "2027-01-31");
    expect(bs.assets_cents).toBe(9280);
    expect(bs.liabilities_cents).toBe(0);
    expect(bs.net_income_cents).toBe(9280);
    expect(bs.balanced).toBe(true);
    expect(balanceSheet(accounts, lines, "2027-01-10").assets_cents).toBe(10000);
    expect(balanceSheet(accounts, lines, "2027-01-10").liabilities_cents).toBe(10000);
  });
});

describe("the cash-basis view (spec 09 rule 15)", () => {
  it("splits cents without losing one", () => {
    expect(splitProportionally(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitProportionally(6330, [6000 + 330])).toEqual([6330]);
    expect(splitProportionally(10, [0, 0])).toEqual([0, 0]);
  });

  it("counts revenue when money lands on an invoice, pro rata across lines, tax apart, refunds and fees against it", () => {
    const view = cashBasisIncome(
      {
        receipts: [
          { payment_id: "p1", received_on: "2027-01-25", amount_cents: 6330, kind: "payment" },
          { payment_id: "p2", received_on: "2027-01-28", amount_cents: 5000, kind: "payment" },
          { payment_id: "r1", received_on: "2027-01-30", amount_cents: 1000, kind: "refund" },
          { payment_id: "p3", received_on: "2027-02-02", amount_cents: 999, kind: "payment" },
        ],
        allocations: [
          { payment_id: "p1", invoice_id: "i1", amount_cents: 6330 },
          { payment_id: "p2", invoice_id: "i2", amount_cents: 3000 },
        ],
        lines: [
          { invoice_id: "i1", amount_cents: 6000, tax_cents: 330, account: "revenue_mosquito" },
          { invoice_id: "i2", amount_cents: 4000, tax_cents: 0, account: "revenue_rodent" },
          { invoice_id: "i2", amount_cents: 2000, tax_cents: 0, account: "revenue_other" },
        ],
        fees: [{ paid_on: "2027-01-27", fee_cents: 214 }, { paid_on: "2027-02-27", fee_cents: 99 }],
      },
      { from: "2027-01-01", to: "2027-01-31" },
    );
    expect(view.revenue).toEqual([
      { account: "revenue_mosquito", amount_cents: 6000 },
      { account: "revenue_other", amount_cents: 1000 },
      { account: "revenue_rodent", amount_cents: 2000 },
    ]);
    expect(view.tax_collected_cents).toBe(330);
    expect(view.unapplied_cents).toBe(2000);
    expect(view.refunds_cents).toBe(1000);
    expect(view.fees_cents).toBe(214);
    expect(view.net_cents).toBe(9000 - 1000 - 214);
  });
});

describe("the cash-basis view across a partial refund (spec 09 rule 15, review fix)", () => {
  it("counts the receipt on its day as first allocated and the refund on its own day", () => {
    const input = {
      receipts: [
        { payment_id: "p1", received_on: "2027-01-10", amount_cents: 10000, kind: "payment" as const },
        // The refund released 4000 of p1's allocation to i1, which now shows 6000.
        { payment_id: "r1", received_on: "2027-02-05", amount_cents: 4000, kind: "refund" as const, refund_of: "p1", released: [{ invoice_id: "i1", cents: 4000 }] },
      ],
      allocations: [{ payment_id: "p1", invoice_id: "i1", amount_cents: 6000 }],
      lines: [{ invoice_id: "i1", amount_cents: 10000, tax_cents: 0, account: "revenue_rodent" as const }],
      fees: [],
    };
    const january = cashBasisIncome(input, { from: "2027-01-01", to: "2027-01-31" });
    expect(january.revenue_cents).toBe(10000);
    expect(january.unapplied_cents).toBe(0);
    expect(january.refunds_cents).toBe(0);
    const february = cashBasisIncome(input, { from: "2027-02-01", to: "2027-02-28" });
    expect(february.revenue_cents).toBe(0);
    expect(february.refunds_cents).toBe(4000);
    const both = cashBasisIncome(input, { from: "2027-01-01", to: "2027-02-28" });
    expect(both.net_cents).toBe(6000);
  });
});
