import { describe, expect, it } from "vitest";
import { formatCents, lineAmountCents, parseDollarsToCents } from "@/lib/money";

describe("lineAmountCents", () => {
  it("multiplies and rounds half up to the cent", () => {
    expect(lineAmountCents(1, 15000)).toBe(15000);
    expect(lineAmountCents(3, 4999)).toBe(14997);
    expect(lineAmountCents(1.5, 101)).toBe(152); // 151.5 rounds up
    expect(lineAmountCents(0.5, 101)).toBe(51); // 50.5 rounds up
    expect(lineAmountCents(2.25, 1000)).toBe(2250);
  });

  it("does not drift on decimal quantities", () => {
    expect(lineAmountCents(0.1 + 0.2, 1000)).toBe(300);
  });
});

describe("dollars", () => {
  it("parses common inputs into cents", () => {
    expect(parseDollarsToCents("150")).toBe(15000);
    expect(parseDollarsToCents("$1,250.5")).toBe(125050);
    expect(parseDollarsToCents("19.99")).toBe(1999);
    expect(parseDollarsToCents("abc")).toBeNull();
    expect(parseDollarsToCents("1.234")).toBeNull();
  });

  it("formats cents as US dollars", () => {
    expect(formatCents(125050)).toBe("$1,250.50");
    expect(formatCents("0")).toBe("$0.00");
  });
});
