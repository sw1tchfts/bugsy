import { describe, expect, it } from "vitest";
import { formatBusinessDate, formatInstant, fromTenantLocal } from "@/lib/dates";

describe("business dates stay in the tenant's zone", () => {
  it("formats a yyyy-mm-dd string without touching a time zone", () => {
    expect(formatBusinessDate("2026-11-30")).toBe("11/30/2026");
    expect(formatBusinessDate("2026-03-05")).toBe("3/5/2026");
    expect(formatBusinessDate("not a date")).toBe("not a date");
  });

  it("turns a wall-clock time typed in the tenant's zone into the right instant", () => {
    expect(fromTenantLocal("2027-04-15T09:00", "America/New_York")?.toISOString()).toBe("2027-04-15T13:00:00.000Z");
    expect(fromTenantLocal("2027-04-15T09:00", "America/Chicago")?.toISOString()).toBe("2027-04-15T14:00:00.000Z");
    expect(fromTenantLocal("2027-01-15T09:00", "America/New_York")?.toISOString()).toBe("2027-01-15T14:00:00.000Z");
    expect(fromTenantLocal("2027-07-04T12:30", "America/Phoenix")?.toISOString()).toBe("2027-07-04T19:30:00.000Z");
  });

  it("treats a bare date as midnight in the tenant's zone", () => {
    expect(fromTenantLocal("2026-10-31", "America/Los_Angeles")?.toISOString()).toBe("2026-10-31T07:00:00.000Z");
  });

  it("handles the spring-forward gap by settling on a real instant", () => {
    // 2027-03-14 02:30 does not exist in New York; the result lands on the same day in that zone.
    const instant = fromTenantLocal("2027-03-14T02:30", "America/New_York");
    expect(instant).not.toBeNull();
    expect(formatInstant(instant as Date, "America/New_York")).toContain("Mar 14, 2027");
  });

  it("rejects input that is not a date", () => {
    expect(fromTenantLocal("", "America/New_York")).toBeNull();
    expect(fromTenantLocal("tomorrow", "America/New_York")).toBeNull();
  });

  it("formats instants in the tenant's zone", () => {
    expect(formatInstant("2027-04-15T13:00:00.000Z", "America/New_York")).toBe("Apr 15, 2027, 9:00 AM");
  });
});
