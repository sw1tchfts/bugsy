import { describe, expect, it } from "vitest";
import { type AgreementFacts, activeOn, attrition, cohorts, lastActiveDay, monthsBetween, percent, retention } from "@/lib/reports/metrics";

const a = (id: string, signed_on: string | null, ends_on: string, extra: Partial<AgreementFacts> = {}): AgreementFacts => ({ id, signed_on, status: "active", cancelled_on: null, ends_on, ...extra });
const today = "2027-06-15";

describe("active on a day (spec 12 rule 1)", () => {
  it("needs a signature by then, no cancellation by then, and a term still running", () => {
    const x = a("x", "2027-01-10", "2027-12-31");
    expect(activeOn(x, "2027-01-09")).toBe(false);
    expect(activeOn(x, "2027-01-10")).toBe(true);
    expect(activeOn(x, "2027-12-31")).toBe(true);
    expect(activeOn(x, "2028-01-01")).toBe(false);
    expect(activeOn({ ...x, cancelled_on: "2027-03-01", status: "cancelled" }, "2027-02-28")).toBe(true);
    expect(activeOn({ ...x, cancelled_on: "2027-03-01", status: "cancelled" }, "2027-03-01")).toBe(false);
    expect(activeOn({ ...x, status: "draft" }, "2027-05-01")).toBe(false);
    expect(activeOn(a("u", null, "2027-12-31"), "2027-05-01")).toBe(false);
  });

  it("knows the last day an agreement was active once it has stopped", () => {
    expect(lastActiveDay(a("c", "2027-01-01", "2027-12-31", { cancelled_on: "2027-04-02", status: "cancelled" }), today)).toBe("2027-04-01");
    expect(lastActiveDay(a("e", "2026-01-01", "2026-12-31", { status: "ended" }), today)).toBe("2026-12-31");
    expect(lastActiveDay(a("r", "2026-01-01", "2027-12-31"), today)).toBeNull();
    expect(lastActiveDay(a("s", "2027-01-01", "2027-12-31", { signed_on: "2027-03-10", cancelled_on: "2027-03-10", status: "cancelled" }), today)).toBe("2027-03-10");
  });
});

describe("attrition, retention and cohorts (spec 12 rules 2 and 3)", () => {
  const book: AgreementFacts[] = [
    a("1", "2026-11-05", "2027-11-04"),
    a("2", "2026-12-01", "2027-11-30", { status: "cancelled", cancelled_on: "2027-03-10" }),
    a("3", "2026-12-20", "2027-12-19"),
    a("4", "2027-03-05", "2028-03-04", { status: "cancelled", cancelled_on: "2027-03-20" }),
    a("5", "2026-03-01", "2027-02-28", { status: "ended" }),
    a("6", "2026-01-01", "2028-12-31"),
  ];

  it("divides the month's losses by those active on its first day, leaving out a signing cancelled in its own month", () => {
    // March: 1, 2, 3 and 6 were active on the 1st; 2 was cancelled; 4 signed and cancelled in March counts nowhere.
    expect(attrition(book, "2027-03", today)).toEqual({ month: "2027-03", active_at_start: 4, lost: 1, rate: 0.25 });
    // February: 5's term ended on the 28th, its last active day, so it is February's loss.
    expect(attrition(book, "2027-02", today)).toEqual({ month: "2027-02", active_at_start: 5, lost: 1, rate: 0.2 });
    expect(attrition(book, "2027-05", today)).toEqual({ month: "2027-05", active_at_start: 3, lost: 0, rate: 0 });
    expect(attrition([], "2027-05", today).rate).toBeNull();
  });

  it("counts a cancellation effective on the first of a month as the month before's loss", () => {
    const first = [a("f", "2027-01-05", "2027-12-31", { status: "cancelled", cancelled_on: "2027-04-01" })];
    expect(attrition(first, "2027-03", today).lost).toBe(1);
    expect(attrition(first, "2027-04", today).active_at_start).toBe(0);
  });

  it("counts a renewed agreement as kept and an ended one as lost", () => {
    expect(retention(book, "2027-01-01", "2027-06-01")).toEqual({ base: 5, kept: 3, rate: 0.6 });
  });

  it("follows each signing month's agreements month by month, with no data for months to come", () => {
    const rows = cohorts(book, "2026-12", "2027-03", 3, today);
    expect(rows[0]).toEqual({ month: "2026-12", signed: 2, retained: [1, 1, 1, 0.5] });
    expect(rows.find((r) => r.month === "2027-03")).toEqual({ month: "2027-03", signed: 1, retained: [0, 0, 0, null] });
    expect(rows.find((r) => r.month === "2027-01")?.retained).toEqual([null, null, null, null]);
  });

  it("formats rates and walks months", () => {
    expect(percent(0.0234)).toBe("2.3%");
    expect(percent(null)).toBe("no data");
    expect(monthsBetween("2026-11-15", "2027-02-01")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});
