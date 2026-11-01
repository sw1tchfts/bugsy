import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { settlementPreview } from "@/lib/agreements/billing";
import { settlementDocuments } from "@/lib/billing/settlement";

type Scenario = {
  id: string;
  cancelled_on?: string;
  expected_at_cancellation?: { billed_cents: number; recognized_cents: number; contract_asset_cents: number };
  expected_settlement?: { final_invoice_cents: number; position_after_cents: number };
};
const ledger = JSON.parse(readFileSync("fixtures/accounting/agreement-ledger.json", "utf8")) as { scenarios: Scenario[] };
const agreement = { number: 17, service_type_name: "General pest plan" };

describe("cancellation settlement documents (rule 12)", () => {
  it("bills delivered but unbilled service as a final invoice, with the fee as its own line (fixture E)", () => {
    const e = ledger.scenarios.find((s) => s.id === "E");
    if (!e?.expected_at_cancellation || !e.expected_settlement) throw new Error("fixture E lacks its cancellation values");
    const preview = settlementPreview({ billedCents: e.expected_at_cancellation.billed_cents, recognizedCents: e.expected_at_cancellation.recognized_cents, cancelFeeCents: 5000 });
    const docs = settlementDocuments(preview, agreement);
    expect(docs).toHaveLength(1);
    expect(docs[0].kind).toBe("invoice");
    expect(docs[0].lines.map((l) => [l.amount_cents, l.taxable])).toEqual([
      [e.expected_settlement.final_invoice_cents, true],
      [5000, false],
    ]);
    expect(preview.positionAfterCents).toBe(e.expected_settlement.position_after_cents);
    expect(docs[0].lines[1].description).toContain("Early cancellation fee");
  });

  it("credits prepaid but undelivered service and bills the fee separately so the credit stays whole", () => {
    const preview = settlementPreview({ billedCents: 54000, recognizedCents: 18000, cancelFeeCents: 5000 });
    const docs = settlementDocuments(preview, agreement);
    expect(docs.map((d) => d.kind)).toEqual(["credit_memo", "invoice"]);
    expect(docs[0].lines[0].amount_cents).toBe(-36000);
    expect(docs[1].lines[0].amount_cents).toBe(5000);
  });

  it("produces nothing when the position is zero and there is no fee", () => {
    expect(settlementDocuments(settlementPreview({ billedCents: 12000, recognizedCents: 12000 }), agreement)).toEqual([]);
  });

  it("bills just the fee when the position is zero", () => {
    const docs = settlementDocuments(settlementPreview({ billedCents: 12000, recognizedCents: 12000, cancelFeeCents: 2500 }), agreement);
    expect(docs).toHaveLength(1);
    expect(docs[0].lines).toEqual([{ description: "Early cancellation fee: General pest plan (agreement #17)", amount_cents: 2500, taxable: false }]);
  });
});
