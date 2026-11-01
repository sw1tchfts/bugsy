import { describe, expect, it } from "vitest";
import { firstOpenDay, isPeriod, lastEndedPeriod, nextPeriod, periodEnd, periodOf, periodsBetween, prevPeriod } from "@/lib/ledger/periods";

describe("accounting periods (spec 09 rule 9)", () => {
  it("is the calendar month of a business date", () => {
    expect(periodOf("2027-02-14")).toBe("2027-02");
    expect(periodEnd("2027-02")).toBe("2027-02-28");
    expect(periodEnd("2028-02")).toBe("2028-02-29");
    expect(nextPeriod("2027-12")).toBe("2028-01");
    expect(prevPeriod("2027-01")).toBe("2026-12");
    expect(lastEndedPeriod("2027-03-01")).toBe("2027-02");
    expect(periodsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(isPeriod("2027-13")).toBe(false);
    expect(isPeriod("2027-07")).toBe(true);
  });

  it("moves an event in a closed month to the first open day", () => {
    const closed = new Set(["2027-01", "2027-02"]);
    expect(firstOpenDay("2027-01-15", closed)).toBe("2027-03-01");
    expect(firstOpenDay("2027-03-15", closed)).toBe("2027-03-15");
    expect(firstOpenDay("2026-12-31", closed)).toBe("2026-12-31");
  });
});
