import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { centsAtRate, scaledRate } from "@/lib/billing/tax";
import type { PostingLine } from "@/lib/ledger/post";
import { invoiceLines, isBalanced, payoutLines, paymentLines, productUseLines, reclassLines, visitLines } from "@/lib/ledger/post";

type Expected = { account: string; debit_cents?: number; credit_cents?: number; subledger?: string };
type Case = { event: string; input: Record<string, unknown>; expected_lines: Expected[]; note?: string };
const rules = JSON.parse(readFileSync("fixtures/accounting/posting-rules.json", "utf8")) as { test_tax_rate: { rate: string }; cases: Case[] };

/** The lines the engine posts for a fixture case. Agreement ids are the fixture's business, not its concern: every invoice and visit here is on one. */
function post(c: Case): PostingLine[] | null {
  const input = c.input as Record<string, string | number | { service_type: string; tax_class: string; amount_cents: number; tax_rate?: string }[] | number[]>;
  switch (c.event) {
    case "invoice_issued": {
      const lines = (input.lines as { service_type: string; tax_class: string; amount_cents: number; tax_rate?: string }[]).map((l) => {
        const tax_cents = l.tax_class === "taxable" && l.tax_rate ? centsAtRate(l.amount_cents, scaledRate(l.tax_rate)) : 0;
        return { amount_cents: l.amount_cents, tax_cents, tax_breakdown: tax_cents ? [{ kind: "state", name: "Test", cents: tax_cents }] : [], service_line: l.service_type, agreement_id: "a1", kind: "service" as const };
      });
      return invoiceLines({ kind: "invoice", source: "installment", lines });
    }
    case "visit_completed":
      return visitLines({ price_cents: input.price_cents as number, service_line: input.service_line as string, agreement_id: "a1" });
    case "product_used":
      return productUseLines({ quantity: input.quantity as string, usage_unit: "fl_oz", unit_cost_cents: input.unit_cost_cents as number, cost_unit: "fl_oz" });
    case "payment_received":
      return paymentLines({ amount_cents: input.amount_cents as number, method: input.method as string });
    case "stripe_payout":
      return payoutLines({ gross_cents: input.gross_cents as number, fee_cents: input.fee_cents as number });
    case "period_end_reclass":
      return reclassLines((input.agreement_positions_cents as number[]).map((p, i) => ({ agreement_id: `a${i + 1}`, position_cents: p })));
    default:
      return null;
  }
}

const shape = (l: { account: string; debit_cents?: number; credit_cents?: number }) => `${l.account}:${l.debit_cents || 0}:${l.credit_cents || 0}`;

describe("posting rules (spec 09 rules 1 to 6 and 8)", () => {
  for (const c of rules.cases) {
    it(`${c.event}${c.note ? ` (${c.note.slice(0, 40)})` : ""} posts the fixture's lines and balances`, () => {
      const lines = post(c);
      expect(lines, `no engine for ${c.event}`).not.toBeNull();
      expect(lines!.map(shape).sort()).toEqual(c.expected_lines.map(shape).sort());
      expect(isBalanced(lines!)).toBe(true);
      for (const e of c.expected_lines.filter((x) => x.subledger === "jurisdiction")) {
        expect(lines!.find((l) => l.account === e.account)?.jurisdiction).toBe("state:Test");
      }
    });
  }

  it("keeps a late fee and a cancellation fee out of the contract balance, and a one-off charge goes straight to income", () => {
    const fee = invoiceLines({ kind: "invoice", source: "settlement", lines: [
      { amount_cents: 7500, tax_cents: 0, tax_breakdown: [], service_line: "general_pest", agreement_id: "a1", kind: "service" },
      { amount_cents: 5000, tax_cents: 0, tax_breakdown: [], service_line: null, agreement_id: "a1", kind: "fee" },
    ] });
    expect(fee.map(shape).sort()).toEqual(["accounts_receivable:12500:0", "cancellation_fee_income:0:5000", "contract_liability:0:7500"]);
    expect(fee.find((l) => l.account === "contract_liability")?.agreement_id).toBe("a1");
    const late = invoiceLines({ kind: "invoice", source: "late_fee", lines: [{ amount_cents: 1500, tax_cents: 0, tax_breakdown: [], service_line: null, agreement_id: "a1", kind: "late_fee" }] });
    expect(late.map(shape).sort()).toEqual(["accounts_receivable:1500:0", "late_fee_income:0:1500"]);
    const oneOff = invoiceLines({ kind: "invoice", source: "manual", lines: [{ amount_cents: 8500, tax_cents: 0, tax_breakdown: [], service_line: "bed_bug", agreement_id: null, kind: "service" }] });
    expect(oneOff.map(shape).sort()).toEqual(["accounts_receivable:8500:0", "revenue_bed_bug:0:8500"]);
    const unknownLine = invoiceLines({ kind: "invoice", source: "manual", lines: [{ amount_cents: 100, tax_cents: 0, tax_breakdown: [], service_line: null, agreement_id: null, kind: "service" }] });
    expect(unknownLine.map((l) => l.account).sort()).toEqual(["accounts_receivable", "revenue_other"]);
  });

  it("posts a credit memo as the mirror of an invoice, tax by jurisdiction included", () => {
    const memo = invoiceLines({ kind: "credit_memo", source: "settlement", lines: [
      { amount_cents: -36000, tax_cents: -1980, tax_breakdown: [{ kind: "state", name: "OH", cents: -1500 }, { kind: "county", name: "Franklin", cents: -480 }], service_line: "general_pest", agreement_id: "a1", kind: "service" },
    ] });
    expect(memo.map(shape).sort()).toEqual(["accounts_receivable:0:37980", "contract_liability:36000:0", "sales_tax_payable:1500:0", "sales_tax_payable:480:0"].sort());
    expect(memo.filter((l) => l.account === "sales_tax_payable").map((l) => l.jurisdiction).sort()).toEqual(["county:Franklin", "state:OH"]);
  });

  it("recognizes nothing for a visit with no agreement or no price, and prices product use in the cost unit", () => {
    expect(visitLines({ price_cents: 12000, service_line: "rodent", agreement_id: null })).toEqual([]);
    expect(visitLines({ price_cents: 0, service_line: "rodent", agreement_id: "a1" })).toEqual([]);
    expect(productUseLines({ quantity: "8", usage_unit: "fl_oz", unit_cost_cents: 6400, cost_unit: "gal" })!.map(shape)).toEqual(["chemical_cost:400:0", "chemical_inventory:0:400"]);
    expect(productUseLines({ quantity: "2", usage_unit: "each", unit_cost_cents: 100, cost_unit: "fl_oz" })).toBeNull();
    expect(productUseLines({ quantity: "2", usage_unit: "fl_oz", unit_cost_cents: 0, cost_unit: "fl_oz" })).toEqual([]);
  });

  it("sends cash and checks to the bank and cards to clearing", () => {
    expect(paymentLines({ amount_cents: 2500, method: "cash" }).map(shape).sort()).toEqual(["accounts_receivable:0:2500", "operating_bank:2500:0"]);
    expect(paymentLines({ amount_cents: 2500, method: "us_bank_account" })[0].account).toBe("stripe_clearing");
  });
});
