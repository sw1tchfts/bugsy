import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type PlanInput } from "@/lib/agreements/cadence";
import { type ExistingVisit, contractTotalCents, planVisits, regenerationPlan } from "@/lib/agreements/visits";
import { startOfMonth } from "@/lib/dates";

type Scenario = {
  id: string;
  agreement: { cadence: string; term_months: number; starts_on: string; initial_price_cents: number; recurring_price_cents: number; visits_in_term: number; contract_total_cents: number };
  visits: { date: string; kind: string; price_cents: number }[];
};

const fixture = JSON.parse(readFileSync("fixtures/accounting/agreement-ledger.json", "utf8")) as { scenarios: Scenario[] };

/** The fixture gives visit dates; the plan is anchored on the month of the first one, as the office would set it. */
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

describe("visit plans reproduce the ledger fixture scenarios (rules 4 and 5)", () => {
  for (const s of fixture.scenarios) {
    it(`scenario ${s.id}: ${s.agreement.visits_in_term} visits, prices and windows`, () => {
      const plan = planVisits(inputFor(s));
      expect(plan).toHaveLength(s.agreement.visits_in_term);
      expect(contractTotalCents(plan)).toBe(s.agreement.contract_total_cents);
      expect(plan[0].kind).toBe("initial");
      expect(plan.slice(1).every((v) => v.kind === "recurring")).toBe(true);
      s.visits.forEach((fixtureVisit, i) => {
        expect(plan[i].kind).toBe(fixtureVisit.kind);
        expect(plan[i].price_cents).toBe(fixtureVisit.price_cents);
        expect(fixtureVisit.date >= plan[i].due_start && fixtureVisit.date <= plan[i].due_end, `visit ${i + 1} on ${fixtureVisit.date} inside ${plan[i].due_start} to ${plan[i].due_end}`).toBe(true);
      });
    });
  }
});

describe("regeneration never moves scheduled or completed work (rule 6)", () => {
  const existing: ExistingVisit[] = [
    { id: "v1", kind: "initial", sequence: 1, due_start: "2027-01-01", due_end: "2027-01-31", status: "completed", price_cents: 18000 },
    { id: "v2", kind: "recurring", sequence: 2, due_start: "2027-04-01", due_end: "2027-04-30", status: "scheduled", price_cents: 12000 },
    { id: "v3", kind: "recurring", sequence: 3, due_start: "2027-07-01", due_end: "2027-07-31", status: "planned", price_cents: 12000 },
    { id: "v4", kind: "recurring", sequence: 4, due_start: "2027-10-01", due_end: "2027-10-31", status: "planned", price_cents: 12000 },
    { id: "r1", kind: "reservice", sequence: 5, due_start: "2027-02-10", due_end: "2027-02-17", status: "planned", price_cents: 0 },
  ];
  const base: PlanInput = {
    cadence: "bimonthly",
    cadence_rule: null,
    starts_on: "2027-01-01",
    term_months: 12,
    first_visit_on: null,
    season_start: null,
    season_end: null,
    skip_months: [],
    interior_only_months: [],
    window_days: 30,
    initial_price_cents: 18000,
    recurring_price_cents: 9900,
  };

  it("replaces only planned visits, keeps re-services, adds no second initial, and avoids kept windows", () => {
    const plan = regenerationPlan(existing, planVisits(base));
    expect(plan.remove).toEqual(["v3", "v4"]);
    expect(plan.keep.map((v) => v.id)).toEqual(["v1", "v2", "r1"]);
    // Bimonthly from January: Jan (initial, dropped: one exists), Mar, May, Jul, Sep, Nov. April is kept, so nothing lands there.
    expect(plan.insert.map((v) => v.due_start)).toEqual(["2027-03-01", "2027-05-01", "2027-07-01", "2027-09-01", "2027-11-01"]);
    expect(plan.insert.every((v) => v.kind === "recurring" && v.price_cents === 9900)).toBe(true);
    expect(plan.insert.map((v) => v.sequence)).toEqual([6, 7, 8, 9, 10]);
  });

  it("keeps a cancelled visit's row but lets a new window take its place", () => {
    const withCancelled = existing.map((v) => (v.id === "v2" ? { ...v, status: "cancelled" } : v));
    const plan = regenerationPlan(withCancelled, planVisits({ ...base, cadence: "quarterly" }));
    expect(plan.keep.map((v) => v.id)).toEqual(["v1", "v2", "r1"]);
    expect(plan.insert.map((v) => v.due_start)).toEqual(["2027-04-01", "2027-07-01", "2027-10-01"]);
  });

  it("generates everything when nothing exists yet", () => {
    const plan = regenerationPlan([], planVisits(base));
    expect(plan.remove).toEqual([]);
    expect(plan.insert).toHaveLength(6);
    expect(plan.insert[0]).toMatchObject({ kind: "initial", sequence: 1, price_cents: 18000 });
  });
});
