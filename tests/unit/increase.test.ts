import { describe, expect, it } from "vitest";
import { increasedPrice } from "@/lib/agreements/increase";

describe("price increases (rule 8)", () => {
  it("applies a percent and rounds half up to the cent", () => {
    expect(increasedPrice(9900, { kind: "percent", percent: "5", amount_cents: null, rounding: "cent" })).toBe(10395);
    expect(increasedPrice(11900, { kind: "percent", percent: 3, amount_cents: null, rounding: "cent" })).toBe(12257);
    expect(increasedPrice(12345, { kind: "percent", percent: "2.5", amount_cents: null, rounding: "cent" })).toBe(12654); // 12653.625
    expect(increasedPrice(1, { kind: "percent", percent: "50", amount_cents: null, rounding: "cent" })).toBe(2); // 1.5 rounds up
  });

  it("rounds to the dollar when asked", () => {
    expect(increasedPrice(9900, { kind: "percent", percent: "5", amount_cents: null, rounding: "dollar" })).toBe(10400);
    expect(increasedPrice(11950, { kind: "amount", percent: null, amount_cents: "500", rounding: "dollar" })).toBe(12500);
  });

  it("adds a fixed amount", () => {
    expect(increasedPrice(9900, { kind: "amount", percent: null, amount_cents: 700, rounding: "cent" })).toBe(10600);
  });
});
