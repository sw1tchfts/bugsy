import { describe, expect, it } from "vitest";
import { agreementFromOption } from "@/lib/agreements/quotes";

describe("an accepted quote option becomes agreement prices", () => {
  it("sums initial lines, recurring lines with add-ons, and reports one-time work", () => {
    const prices = agreementFromOption([
      { kind: "initial", description: "Initial service and inspection", amount_cents: 22500 },
      { kind: "recurring", description: "Quarterly plan", amount_cents: "9900" },
      { kind: "add_on", description: "Detached garage add-on (recurring)", amount_cents: 1500 },
      { kind: "add_on", description: "Detached garage add-on (initial)", amount_cents: 2500 },
      { kind: "add_on", description: "Crawl space", amount_cents: 2000 },
      { kind: "one_time", description: "Wasp nest removal", amount_cents: 15000 },
      { kind: "add_on", description: "Attic treatment add-on (one-time)", amount_cents: 8000 },
    ]);
    expect(prices.initialPriceCents).toBe(25000);
    expect(prices.recurringPriceCents).toBe(13400);
    expect(prices.oneTime).toEqual([
      { description: "Wasp nest removal", amount_cents: 15000 },
      { description: "Attic treatment add-on (one-time)", amount_cents: 8000 },
    ]);
  });

  it("gives zeros for an empty option", () => {
    expect(agreementFromOption([])).toEqual({ initialPriceCents: 0, recurringPriceCents: 0, oneTime: [] });
  });
});
