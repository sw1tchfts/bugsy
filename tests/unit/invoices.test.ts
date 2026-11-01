import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { billingSchedule } from "@/lib/agreements/billing";
import type { PlannedVisit } from "@/lib/agreements/visits";
import { dueOn, installmentKey, installmentsDue, invoiceStatus, invoiceTotals, lateFee } from "@/lib/billing/invoices";

type Scenario = {
  id: string;
  agreement: { cadence: string; term_months: number; starts_on: string; initial_price_cents: number; recurring_price_cents: number; visits_in_term: number; contract_total_cents: number; billing_mode: "per_visit" | "flat_monthly" | "annual_prepay" };
  billing: { date: string; amount_cents: number }[];
  visits: { date: string; kind: "initial" | "recurring"; price_cents: number }[];
  /** A cancelled scenario lists only the installments billed before the cancellation. */
  cancelled_on?: string;
};

const ledger = JSON.parse(readFileSync("fixtures/accounting/agreement-ledger.json", "utf8")) as { scenarios: Scenario[] };

/** The term's planned visits. A cancelled scenario lists only the visits done, so the rest of the term is filled in from the agreement. */
function planned(s: Scenario): PlannedVisit[] {
  const listed = s.visits.map((v, i): PlannedVisit => ({ kind: v.kind, sequence: i + 1, due_start: v.date, due_end: v.date, price_cents: v.price_cents, interior_only: false }));
  while (listed.length < s.agreement.visits_in_term) {
    const n = listed.length + 1;
    listed.push({ kind: "recurring", sequence: n, due_start: `2099-01-${String(n).padStart(2, "0")}`, due_end: `2099-01-${String(n).padStart(2, "0")}`, price_cents: s.agreement.recurring_price_cents, interior_only: false });
  }
  expect(listed.reduce((sum, v) => sum + v.price_cents, 0)).toBe(s.agreement.contract_total_cents);
  return listed;
}

describe("invoices from the billing schedule (rules 2 to 4)", () => {
  for (const s of ledger.scenarios) {
    it(`issues scenario ${s.id} (${s.agreement.billing_mode}) exactly as the ledger fixture bills it`, () => {
      const schedule = billingSchedule({ billing_mode: s.agreement.billing_mode, starts_on: s.agreement.starts_on, term_months: s.agreement.term_months }, planned(s));
      // Up to the cancellation, when there is one: a cancelled agreement issues no further installments (rule 3).
      const cutoff = s.cancelled_on ?? "2099-12-31";
      expect(schedule.filter((e) => e.date <= cutoff).map((e) => ({ date: e.date, amount_cents: e.amount_cents }))).toEqual(s.billing);
      if (s.agreement.billing_mode === "flat_monthly") {
        const all = installmentsDue("a1", schedule, cutoff);
        expect(all.map((d) => d.amount_cents)).toEqual(s.billing.map((b) => b.amount_cents));
        expect(all.map((d) => d.source_key)).toEqual(s.billing.map((_, i) => installmentKey("a1", i)));
        const firstTwo = installmentsDue("a1", schedule, s.billing[1].date);
        expect(firstTwo).toHaveLength(2);
      }
    });
  }

  it("skips installments whose date has not come, and zero installments", () => {
    const schedule = [
      { date: "2027-01-01", amount_cents: 100 },
      { date: "2027-02-01", amount_cents: 0 },
      { date: "2027-03-01", amount_cents: 100 },
    ];
    expect(installmentsDue("a", schedule, "2027-02-15").map((d) => d.index)).toEqual([0]);
  });
});

describe("totals, terms and status (rules 6 and 9)", () => {
  it("sums lines and their tax", () => {
    expect(invoiceTotals([{ amount_cents: 6000, tax_cents: 330 }, { amount_cents: 4500, tax_cents: 0 }])).toEqual({ subtotal_cents: 10500, tax_cents: 330, total_cents: 10830 });
  });

  it("computes the due date from net terms, with zero meaning due on issue", () => {
    expect(dueOn("2026-11-01", 0)).toBe("2026-11-01");
    expect(dueOn("2026-11-01", 30)).toBe("2026-12-01");
    expect(dueOn("2026-11-01", -5)).toBe("2026-11-01");
  });

  it("follows the status machine", () => {
    const base = { kind: "invoice" as const, status: "issued" as const, total_cents: 1000, paid_cents: 0, due_on: "2026-11-01", grace_days: 0 };
    expect(invoiceStatus({ ...base, today: "2026-11-01" })).toBe("issued");
    expect(invoiceStatus({ ...base, today: "2026-11-02" })).toBe("past_due");
    expect(invoiceStatus({ ...base, today: "2026-11-05", grace_days: 5 })).toBe("issued");
    expect(invoiceStatus({ ...base, today: "2026-11-07", grace_days: 5 })).toBe("past_due");
    expect(invoiceStatus({ ...base, today: "2026-11-02", paid_cents: 400 })).toBe("past_due");
    expect(invoiceStatus({ ...base, today: "2026-11-01", paid_cents: 400 })).toBe("partially_paid");
    expect(invoiceStatus({ ...base, today: "2026-12-01", paid_cents: 1000 })).toBe("paid");
    expect(invoiceStatus({ ...base, status: "draft", today: "2026-12-01" })).toBe("draft");
    expect(invoiceStatus({ ...base, status: "void", today: "2026-12-01" })).toBe("void");
    expect(invoiceStatus({ ...base, kind: "credit_memo", total_cents: -500, today: "2026-12-01" })).toBe("issued");
  });

  it("computes the late fee as fixed cents plus a percent of the open balance, half up", () => {
    expect(lateFee(10000, { late_fee_cents: 1500, late_fee_percent: "0" })).toBe(1500);
    expect(lateFee(10000, { late_fee_cents: 0, late_fee_percent: "1.5" })).toBe(150);
    expect(lateFee(3333, { late_fee_cents: 500, late_fee_percent: "1.5" })).toBe(550);
    expect(lateFee(0, { late_fee_cents: 500, late_fee_percent: "1.5" })).toBe(0);
  });
});
