import { describe, expect, it } from "vitest";
import { type PlanInput, cadenceSteps, endsOn, planIssues } from "@/lib/agreements/cadence";
import { planVisits } from "@/lib/agreements/visits";
import { addDays, addMonths, daysBetween, endOfMonth } from "@/lib/dates";

const base: PlanInput = {
  cadence: "quarterly",
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
  recurring_price_cents: 12000,
};

describe("civil dates", () => {
  it("adds months with end-of-month clamping and days across years", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2027-11-15", 3)).toBe("2028-02-15");
    expect(addDays("2027-12-31", 1)).toBe("2028-01-01");
    expect(endOfMonth("2027-02-10")).toBe("2027-02-28");
    expect(daysBetween("2027-05-01", "2027-10-31")).toBe(183);
  });

  it("computes the last day of the term, with renewals", () => {
    expect(endsOn(base)).toBe("2027-12-31");
    expect(endsOn({ starts_on: "2027-03-15", term_months: 12 })).toBe("2028-03-14");
    expect(endsOn({ ...base, renewals: 1 })).toBe("2028-12-31");
  });
});

describe("cadence steps and windows (rule 4)", () => {
  it("builds calendar-month windows for monthly, bimonthly and quarterly plans", () => {
    expect(cadenceSteps({ ...base, cadence: "monthly" })).toHaveLength(12);
    expect(cadenceSteps({ ...base, cadence: "bimonthly" })).toHaveLength(6);
    const quarterly = cadenceSteps(base);
    expect(quarterly.map((w) => [w.due_start, w.due_end])).toEqual([
      ["2027-01-01", "2027-01-31"],
      ["2027-04-01", "2027-04-30"],
      ["2027-07-01", "2027-07-31"],
      ["2027-10-01", "2027-10-31"],
    ]);
  });

  it("starts the plan from the first visit date and clips to the term", () => {
    const windows = cadenceSteps({ ...base, first_visit_on: "2027-03-20" });
    expect(windows.map((w) => [w.due_start, w.due_end])).toEqual([
      ["2027-03-20", "2027-03-31"],
      ["2027-06-01", "2027-06-30"],
      ["2027-09-01", "2027-09-30"],
      ["2027-12-01", "2027-12-31"],
    ]);
    const midMonthStart = cadenceSteps({ ...base, starts_on: "2027-01-15", first_visit_on: "2027-01-20" });
    expect(midMonthStart[0]).toMatchObject({ due_start: "2027-01-20", due_end: "2027-01-31" });
    expect(midMonthStart.at(-1)).toMatchObject({ due_start: "2027-10-01", due_end: "2027-10-31" });
  });

  it("handles custom intervals in weeks and months", () => {
    const sixWeeks = cadenceSteps({ ...base, cadence: "custom", cadence_rule: { every: 6, unit: "weeks" }, window_days: 7 });
    expect(sixWeeks).toHaveLength(9);
    expect(sixWeeks[1]).toMatchObject({ due_start: "2027-02-12", due_end: "2027-02-18" });
    expect(sixWeeks[sixWeeks.length - 1].due_end <= "2027-12-31").toBe(true);
    const fourMonths = cadenceSteps({ ...base, cadence: "custom", cadence_rule: { every: 4, unit: "months" } });
    expect(fourMonths.map((w) => w.step)).toEqual(["2027-01-01", "2027-05-01", "2027-09-01"]);
  });

  it("splits a season into equal rounds", () => {
    const season = cadenceSteps({ ...base, cadence: "seasonal_rounds", cadence_rule: { rounds: 6 }, season_start: "2027-05-01", season_end: "2027-10-31" });
    expect(season).toHaveLength(6);
    // 184 days over 6 rounds: spans of 30 or 31 days that tile the season exactly.
    expect(season[0]).toMatchObject({ due_start: "2027-05-01", due_end: "2027-05-30" });
    expect(season[5]).toMatchObject({ due_end: "2027-10-31" });
    for (let i = 1; i < season.length; i++) expect(season[i].due_start).toBe(addDays(season[i - 1].due_end, 1));
    for (const round of season) expect([30, 31]).toContain(daysBetween(round.due_start, round.due_end) + 1);
  });

  it("repeats the season a year later after a renewal", () => {
    const twoSeasons = cadenceSteps({ ...base, cadence: "seasonal_rounds", cadence_rule: { rounds: 3 }, season_start: "2027-05-01", season_end: "2027-10-31", renewals: 1 });
    expect(twoSeasons).toHaveLength(6);
    expect(twoSeasons[3].due_start).toBe("2028-05-01");
  });

  it("skips months and flags interior-only months", () => {
    const monthly = planVisits({ ...base, cadence: "monthly", first_visit_on: "2027-03-01", skip_months: [1, 2], interior_only_months: [12] });
    expect(monthly).toHaveLength(10);
    expect(monthly[0]).toMatchObject({ kind: "initial", due_start: "2027-03-01", price_cents: 18000 });
    expect(monthly.at(-1)).toMatchObject({ due_start: "2027-12-01", interior_only: true, price_cents: 12000 });
    expect(monthly.map((v) => v.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const steps = cadenceSteps({ ...base, cadence: "monthly", skip_months: [1, 2] });
    expect(steps.filter((s) => s.skipped)).toHaveLength(2);
  });

  it("refuses a first visit in a skipped month or outside the term, and incomplete custom or seasonal rules", () => {
    expect(planIssues({ ...base, skip_months: [1] })).toEqual(["The first visit falls in a skipped month; pick another first visit date."]);
    expect(planIssues({ ...base, first_visit_on: "2026-12-31" })).toContain("The first visit cannot be before the agreement starts.");
    expect(planIssues({ ...base, first_visit_on: "2028-01-01" })).toContain("The first visit falls after the term ends.");
    expect(planIssues({ ...base, cadence: "custom", cadence_rule: { every: 0, unit: "weeks" } })).toContain("A custom cadence needs an interval in weeks or months.");
    expect(planIssues({ ...base, cadence: "seasonal_rounds", cadence_rule: { rounds: 6 } })).toContain("A seasonal program needs a season start and end.");
    expect(() => planVisits({ ...base, skip_months: [1] })).toThrow(/skipped month/);
  });
});
