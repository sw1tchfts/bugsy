import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { periodEnd } from "@/lib/ledger/periods";
import type { ContractLine } from "@/lib/ledger/post";
import { contractPositions, openingLines, reclassLines } from "@/lib/ledger/post";
import { rollForward } from "@/lib/ledger/reports";

type MonthEnd = { month: string; billed_cents: number; recognized_cents: number; position_cents: number; deferred_revenue_cents: number; contract_asset_cents: number };
type Scenario = {
  id: string;
  billing: { date: string; amount_cents: number }[];
  visits: { date: string; kind: string; price_cents: number }[];
  expected_month_end?: MonthEnd[];
  cancelled_on?: string;
  expected_at_cancellation?: { billed_cents: number; recognized_cents: number; contract_asset_cents: number };
  expected_settlement?: { final_invoice_cents: number; position_after_cents: number };
};
const ledger = JSON.parse(readFileSync("fixtures/accounting/agreement-ledger.json", "utf8")) as { scenarios: Scenario[] };

/** The contract liability lines the scenario's events would post: each billing an installment or prepay invoice, each visit a completion. */
function linesFor(s: Scenario, through?: string): ContractLine[] {
  const out: ContractLine[] = [];
  for (const b of s.billing) if (!through || b.date <= through) out.push({ agreement_id: s.id, kind: "billing", debit_cents: 0, credit_cents: b.amount_cents, posted_on: b.date });
  for (const v of s.visits) if (!through || v.date <= through) out.push({ agreement_id: s.id, kind: "recognition", debit_cents: v.price_cents, credit_cents: 0, posted_on: v.date });
  return out;
}

describe("contract balances per agreement (spec 09 rules 7 and 8)", () => {
  for (const s of ledger.scenarios.filter((x) => x.expected_month_end)) {
    it(`scenario ${s.id} carries the fixture's month-end position all year`, () => {
      const lines = linesFor(s);
      for (const m of s.expected_month_end!) {
        const [p] = contractPositions(lines, periodEnd(m.month));
        expect({ billed: p.billed_cents, recognized: p.recognized_cents, position: p.position_cents, deferred: p.deferred_cents, asset: p.asset_cents }, m.month).toEqual({
          billed: m.billed_cents,
          recognized: m.recognized_cents,
          position: m.position_cents,
          deferred: m.deferred_revenue_cents,
          asset: m.contract_asset_cents,
        });
        // The period-end reclass presents a debit balance as a contract asset, and nothing else.
        const reclass = reclassLines([p]);
        expect(reclass.find((l) => l.account === "contract_asset")?.debit_cents ?? 0).toBe(m.contract_asset_cents);
      }
    });
  }

  it("scenario E: the cancellation leaves delivered but unbilled service, and the final invoice settles it to zero", () => {
    const e = ledger.scenarios.find((s) => s.id === "E")!;
    const at = contractPositions(linesFor(e, e.cancelled_on))[0];
    expect({ billed: at.billed_cents, recognized: at.recognized_cents, asset: at.asset_cents }).toEqual({
      billed: e.expected_at_cancellation!.billed_cents,
      recognized: e.expected_at_cancellation!.recognized_cents,
      asset: e.expected_at_cancellation!.contract_asset_cents,
    });
    const settled = [...linesFor(e, e.cancelled_on), { agreement_id: "E", kind: "billing" as const, debit_cents: 0, credit_cents: e.expected_settlement!.final_invoice_cents, posted_on: e.cancelled_on! }];
    expect(contractPositions(settled)[0].position_cents).toBe(e.expected_settlement!.position_after_cents);
  });

  it("rolls the balance forward through a month: scenario B in March", () => {
    const b = ledger.scenarios.find((s) => s.id === "B")!;
    const march = rollForward(linesFor(b), { from: "2027-03-01", to: "2027-03-31" });
    expect(march.rows).toEqual([{ agreement_id: "B", opening_cents: 9000, billed_cents: 4500, recognized_cents: 18000, closing_cents: -4500, deferred_cents: 0, asset_cents: 4500 }]);
    expect(march.closing_cents).toBe(-4500);
  });

  it("ignores presentation lines and posts an opening position as its net", () => {
    const lines: ContractLine[] = [
      { agreement_id: "x", kind: "billing", debit_cents: 0, credit_cents: 4500, posted_on: "2027-01-01" },
      { agreement_id: "x", kind: "recognition", debit_cents: 18000, credit_cents: 0, posted_on: "2027-01-15" },
      { agreement_id: "x", kind: "presentation", debit_cents: 0, credit_cents: 13500, posted_on: "2027-01-31" },
      { agreement_id: "x", kind: "presentation", debit_cents: 13500, credit_cents: 0, posted_on: "2027-02-01" },
    ];
    expect(contractPositions(lines)[0].position_cents).toBe(-13500);
    expect(openingLines({ agreement_id: "y", billed_cents: 27000, recognized_cents: 30000 }).map((l) => [l.account, l.debit_cents, l.credit_cents])).toEqual([
      ["contract_liability", 3000, 0],
      ["opening_balance_equity", 0, 3000],
    ]);
    expect(openingLines({ agreement_id: "y", billed_cents: 100, recognized_cents: 100 })).toEqual([]);
  });
});
