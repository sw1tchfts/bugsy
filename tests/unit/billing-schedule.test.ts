import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { billedThrough, billingSchedule, installments, settlementPreview } from "@/lib/agreements/billing";
import type { BillingMode, PlanInput } from "@/lib/agreements/cadence";
import { planVisits } from "@/lib/agreements/visits";
import { startOfMonth } from "@/lib/dates";

type Scenario = {
  id: string;
  agreement: {
    cadence: string;
    term_months: number;
    starts_on: string;
    initial_price_cents: number;
    recurring_price_cents: number;
    contract_total_cents: number;
    billing_mode: BillingMode;
    cancel_fee_cents?: number;
  };
  billing: { date: string; amount_cents: number }[];
  visits: { date: string; kind: string; price_cents: number }[];
  cancelled_on?: string;
  expected_at_cancellation?: { billed_cents: number; recognized_cents: number; contract_asset_cents: number };
  expected_settlement?: { final_invoice_cents: number; position_after_cents: number };
};

const fixture = JSON.parse(readFileSync("fixtures/accounting/agreement-ledger.json", "utf8")) as {
  installment_rounding_cases: { total_cents: number; count: number; expected: number[] }[];
  scenarios: Scenario[];
};

function inputFor(s: Scenario): PlanInput {
  return {
    cadence: s.agreement.cadence as PlanInput["cadence"],
    cadence_rule: null,
    starts_on: s.agreement.starts_on,
    term_months: s.agreement.term_months,
    first_visit_on: startOfMonth(s.visits[0].date),
    season_start: null,
    season_end: null,
    skip_months: [],
    interior_only_months: [],
    window_days: 30,
    initial_price_cents: s.agreement.initial_price_cents,
    recurring_price_cents: s.agreement.recurring_price_cents,
  };
}

describe("installments follow the fixture's rounding rule", () => {
  for (const c of fixture.installment_rounding_cases) {
    it(`${c.total_cents} cents over ${c.count}`, () => {
      const result = installments(c.total_cents, c.count);
      expect(result).toEqual(c.expected);
      expect(result.reduce((a, b) => a + b, 0)).toBe(c.total_cents);
    });
  }
  it("rejects fractional cents and empty counts", () => {
    expect(() => installments(100.5, 2)).toThrow();
    expect(() => installments(100, 0)).toThrow();
  });
});

describe("billing schedules reproduce the fixture scenarios (rule 5)", () => {
  for (const s of fixture.scenarios) {
    it(`scenario ${s.id}: ${s.agreement.billing_mode}`, () => {
      const plan = planVisits(inputFor(s));
      const schedule = billingSchedule(s.agreement, plan);
      if (s.agreement.billing_mode === "per_visit") {
        expect(schedule.map((e) => e.amount_cents)).toEqual(s.billing.map((b) => b.amount_cents));
        s.billing.forEach((b, i) => {
          expect(b.date >= plan[i].due_start && b.date <= plan[i].due_end, `billing ${i + 1} on completion inside the visit window`).toBe(true);
        });
      } else if (s.cancelled_on) {
        // A cancelled flat-monthly agreement bills the same installments until it stops.
        expect(schedule.slice(0, s.billing.length)).toEqual(s.billing);
      } else {
        expect(schedule).toEqual(s.billing);
      }
      expect(schedule.reduce((sum, e) => sum + e.amount_cents, 0)).toBe(s.agreement.contract_total_cents);
    });
  }
});

describe("cancellation settlement (rule 10, fixture scenario E)", () => {
  const e = fixture.scenarios.find((s) => s.id === "E");
  if (!e?.cancelled_on || !e.expected_at_cancellation || !e.expected_settlement) throw new Error("fixture scenario E is incomplete");
  const cancelledOn = e.cancelled_on;
  const atCancellation = e.expected_at_cancellation;
  const expectedSettlement = e.expected_settlement;

  it("bills delivered but unbilled service and settles the position to zero", () => {
    const plan = planVisits(inputFor(e));
    const schedule = billingSchedule(e.agreement, plan);
    const billed = billedThrough(schedule, cancelledOn);
    const recognized = e.visits.reduce((sum, v) => sum + v.price_cents, 0);
    expect(billed).toBe(atCancellation.billed_cents);
    expect(recognized).toBe(atCancellation.recognized_cents);
    expect(recognized - billed).toBe(atCancellation.contract_asset_cents);
    const settlement = settlementPreview({ billedCents: billed, recognizedCents: recognized, cancelFeeCents: e.agreement.cancel_fee_cents });
    expect(settlement.finalInvoiceCents).toBe(expectedSettlement.final_invoice_cents);
    expect(settlement.refundCents).toBe(0);
    expect(settlement.positionAfterCents).toBe(expectedSettlement.position_after_cents);
  });

  it("refunds prepaid but undelivered service and keeps the fee separate", () => {
    const settlement = settlementPreview({ billedCents: 54000, recognizedCents: 18000, cancelFeeCents: 5000 });
    expect(settlement).toEqual({ finalInvoiceCents: 0, refundCents: 36000, feeCents: 5000, positionAfterCents: 0 });
  });
});
