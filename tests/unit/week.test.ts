import { describe, expect, it } from "vitest";
import { dayLabel, isWeekend, weekDays, weekOf } from "@/lib/dispatch/week";

describe("dispatch weeks run Monday to Sunday", () => {
  it("finds the Monday on or before a date", () => {
    expect(weekOf("2026-10-31")).toBe("2026-10-26"); // a Saturday
    expect(weekOf("2026-10-26")).toBe("2026-10-26"); // a Monday
    expect(weekOf("2026-11-01")).toBe("2026-10-26"); // a Sunday belongs to the week before
    expect(weekOf("2027-01-01")).toBe("2026-12-28");
  });

  it("lists the seven days and labels them", () => {
    const days = weekDays("2026-10-26");
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-10-26");
    expect(days[6]).toBe("2026-11-01");
    expect(dayLabel("2026-10-26")).toBe("Mon 10/26");
    expect(isWeekend("2026-10-31")).toBe(true);
    expect(isWeekend("2026-10-28")).toBe(false);
  });
});
