import { describe, expect, it } from "vitest";
import { priceBookOffers } from "@/lib/catalog/pricing";
import { nextAt, nps, stepProblems } from "@/lib/growth/sequences";
import { commissionFor, covers, releasableOn, shouldChargeBack, shouldRelease } from "@/lib/sales/commissions";
import { doNotKnock, inTerritory, knockStats, latestByAddress, streetOf } from "@/lib/sales/territory";

describe("territories and knocks (spec 17 rules 1 and 2)", () => {
  const t = { zip_codes: ["43201"], streets: ["Oak Avenue"] };

  it("matches an address by its ZIP or its street, whatever the abbreviation", () => {
    expect(streetOf("125 N. Main St.")).toBe("north main street");
    expect(inTerritory({ line1: "9 Pine Rd", postal_code: "43201-1234" }, t)).toBe(true);
    expect(inTerritory({ line1: "48 oak ave", postal_code: "43999" }, t)).toBe(true);
    expect(inTerritory({ line1: "48 Elm Street", postal_code: "43999" }, t)).toBe(false);
  });

  it("keeps an address on the do-not-knock list until the office clears it", () => {
    const knocks = [
      { normalized_address: "222 ELM", outcome: "do_not_knock", knocked_at: "2027-03-01T15:00:00Z" },
      { normalized_address: "226 ELM", outcome: "do_not_knock", knocked_at: "2027-03-01T15:00:00Z", cleared_at: "2027-03-02T15:00:00Z" },
    ];
    expect(doNotKnock(knocks, "222 ELM")).toBe(true);
    expect(doNotKnock(knocks, "226 ELM")).toBe(false);
    expect(doNotKnock(knocks, "230 ELM")).toBe(false);
  });

  it("counts doors and the close rate on answered doors", () => {
    const knocks = [
      { normalized_address: "A", outcome: "not_home", knocked_at: "2027-03-01T15:00:00Z" },
      { normalized_address: "A", outcome: "sold", knocked_at: "2027-03-02T15:00:00Z" },
      { normalized_address: "B", outcome: "not_interested", knocked_at: "2027-03-01T15:00:00Z" },
    ];
    expect(knockStats(knocks)).toMatchObject({ doors: 2, sold: 1, not_home: 1, close_rate: 0.5 });
    expect(latestByAddress(knocks).get("A")?.outcome).toBe("sold");
  });
});

describe("commissions (spec 17 rules 4 to 7)", () => {
  const plan = { basis: "first_year" as const, percent: "10.5", flat_cents: null };
  const sale = {
    starts_on: "2027-03-01",
    signed_on: "2027-03-01",
    visits: [
      { kind: "initial", due_start: "2027-03-01", price_cents: 24900 },
      { kind: "recurring", due_start: "2027-06-01", price_cents: 11900 },
      { kind: "recurring", due_start: "2027-09-01", price_cents: 11900 },
      { kind: "recurring", due_start: "2027-12-01", price_cents: 11900 },
      { kind: "recurring", due_start: "2028-03-01", price_cents: 11900 },
      { kind: "reservice", due_start: "2027-04-01", price_cents: 0 },
    ],
  };

  it("pays a percent of the first year's visits, half up to the cent, or of the first visit, or a flat amount", () => {
    expect(commissionFor(plan, sale)).toEqual({ basis_cents: 60600, amount_cents: 6363 });
    expect(commissionFor({ ...plan, basis: "initial", percent: "10" }, sale)).toEqual({ basis_cents: 24900, amount_cents: 2490 });
    expect(commissionFor({ basis: "flat", percent: null, flat_cents: 5000 }, sale)).toEqual({ basis_cents: 5000, amount_cents: 5000 });
    // 0.5 cent rounds up: 10% of 15 cents is 1.5.
    expect(commissionFor({ ...plan, basis: "initial", percent: "10" }, { ...sale, visits: [{ kind: "initial", due_start: "2027-03-01", price_cents: 15 }] }).amount_cents).toBe(2);
  });

  it("covers sellers by role or by name, only while the plan is on", () => {
    expect(covers({ role_keys: ["sales_rep"], user_ids: [], active: true }, { user_id: "u", role_key: "sales_rep" })).toBe(true);
    expect(covers({ role_keys: [], user_ids: ["u"], active: true }, { user_id: "u", role_key: "technician" })).toBe(true);
    expect(covers({ role_keys: ["sales_rep"], user_ids: [], active: false }, { user_id: "u", role_key: "sales_rep" })).toBe(false);
  });

  it("holds until the days pass and enough invoices are paid, and charges back an early cancellation", () => {
    const held = { status: "held", releasable_on: releasableOn({ hold_days: 30 }, "2027-03-01") };
    expect(held.releasable_on).toBe("2027-03-31");
    expect(shouldRelease(held, { hold_paid_invoices: 1 }, "2027-03-30", 1)).toBe(false);
    expect(shouldRelease(held, { hold_paid_invoices: 1 }, "2027-03-31", 0)).toBe(false);
    expect(shouldRelease(held, { hold_paid_invoices: 1 }, "2027-03-31", 1)).toBe(true);
    expect(shouldChargeBack({ status: "payable" }, { chargeback_days: 90 }, "2027-03-01", "2027-05-30")).toBe(true);
    expect(shouldChargeBack({ status: "payable" }, { chargeback_days: 90 }, "2027-03-01", "2027-06-01")).toBe(false);
    expect(shouldChargeBack({ status: "charged_back" }, { chargeback_days: 90 }, "2027-03-01", "2027-03-05")).toBe(false);
    expect(shouldChargeBack({ status: "held" }, { chargeback_days: 90 }, "2027-03-01", null)).toBe(false);
  });
});

describe("sequences and surveys (spec 17 rules 8 and 9)", () => {
  it("checks steps and times each one from the previous", () => {
    const steps = [
      { delay_days: 0, channel: "email" as const, subject: "Renew", body: "Hi" },
      { delay_days: 7, channel: "sms" as const, subject: null, body: "Reminder" },
    ];
    expect(stepProblems(steps)).toEqual([]);
    expect(stepProblems([{ delay_days: 0, channel: "email", subject: "", body: " " }])).toEqual(["Step 1: write the message.", "Step 1: an email needs a subject."]);
    const from = new Date("2027-03-01T15:00:00Z");
    expect(nextAt(steps, 1, from)?.toISOString()).toBe("2027-03-08T15:00:00.000Z");
    expect(nextAt(steps, 2, from)).toBeNull();
  });

  it("scores promoters minus detractors", () => {
    expect(nps([10, 9, 8, 6, 0])).toBe(0);
    expect(nps([10, 10, 9, 7])).toBe(75);
    expect(nps([])).toBeNull();
  });
});

describe("the quick quote at the door (spec 17 rule 3)", () => {
  const band = (id: string, min: number, max: number | null, initial: number, recurring: number) => ({
    id, service_type_id: "gp", name: "General pest plan", add_on: false, size_basis: "size_sqft" as const, size_min: min, size_max: max,
    initial_price_cents: initial, recurring_price_cents: recurring, one_time_price_cents: 0,
  });
  const items = [band("small", 0, 2000, 19900, 9900), band("mid", 2001, 3500, 24900, 12900), band("large", 3501, null, 29900, 15900)];

  it("prices the house by the band its size falls in, and asks for the size when it is missing", () => {
    const pick = (sizeSqft: number | null) => priceBookOffers(items, { sizeSqft, lotSqft: null })[0].pick;
    expect(pick(1800)).toMatchObject({ status: "match", item: { id: "small", initial_price_cents: 19900, recurring_price_cents: 9900 } });
    expect(pick(2001)).toMatchObject({ status: "match", item: { id: "mid" } });
    expect(pick(5200)).toMatchObject({ status: "match", item: { id: "large" } });
    expect(pick(null)).toEqual({ status: "needs_measurement", basis: "size_sqft" });
  });
});

