import { describe, expect, it } from "vitest";
import { type PriceBookItemLike, bandLabel, offeredColumns, pickPriceBookItem, priceBookLine, priceBookOffers } from "@/lib/catalog/pricing";

function band(partial: Partial<PriceBookItemLike> & { id: string }): PriceBookItemLike {
  return {
    service_type_id: "st1",
    name: "General pest plan",
    add_on: false,
    size_basis: "size_sqft",
    size_min: 0,
    size_max: null,
    initial_price_cents: 0,
    recurring_price_cents: 0,
    one_time_price_cents: 0,
    ...partial,
  };
}

const small = band({ id: "small", size_min: 0, size_max: 2000, initial_price_cents: 19900, recurring_price_cents: "9900" });
const medium = band({ id: "medium", size_min: 2000, size_max: 3500, initial_price_cents: 24900, recurring_price_cents: 11900 });
const large = band({ id: "large", size_min: 3500, size_max: null, initial_price_cents: 29900, recurring_price_cents: 13900 });
const garage = band({ id: "garage", name: "Detached garage", add_on: true, size_basis: "none", initial_price_cents: 2500, recurring_price_cents: 1500 });

describe("price book bands (rules 5 and 6)", () => {
  it("picks the band that contains the home size, with an inclusive lower and exclusive upper bound", () => {
    expect(pickPriceBookItem([small, medium, large], { sizeSqft: 1999, lotSqft: null })).toEqual({ status: "match", item: small });
    expect(pickPriceBookItem([small, medium, large], { sizeSqft: 2000, lotSqft: null })).toEqual({ status: "match", item: medium });
    expect(pickPriceBookItem([small, medium, large], { sizeSqft: 3499, lotSqft: null })).toEqual({ status: "match", item: medium });
    expect(pickPriceBookItem([small, medium, large], { sizeSqft: 3500, lotSqft: null })).toEqual({ status: "match", item: large });
    expect(pickPriceBookItem([small, medium, large], { sizeSqft: 12000, lotSqft: null })).toEqual({ status: "match", item: large });
  });

  it("asks for the measurement instead of guessing when the property has none", () => {
    expect(pickPriceBookItem([small, medium, large], { sizeSqft: null, lotSqft: 8000 })).toEqual({ status: "needs_measurement", basis: "size_sqft" });
    const lot = band({ id: "lot", size_basis: "lot_sqft", size_min: 0, size_max: 10000 });
    expect(pickPriceBookItem([lot], { sizeSqft: 1800, lotSqft: null })).toEqual({ status: "needs_measurement", basis: "lot_sqft" });
  });

  it("applies a basis-free item to every property and reports a gap between bands", () => {
    expect(pickPriceBookItem([garage], { sizeSqft: null, lotSqft: null })).toEqual({ status: "match", item: garage });
    expect(pickPriceBookItem([small, large], { sizeSqft: 2500, lotSqft: null })).toEqual({ status: "no_band" });
  });

  it("groups bands by name into offers", () => {
    const offers = priceBookOffers([small, medium, large, garage], { sizeSqft: 2400, lotSqft: null });
    expect(offers.map((o) => o.name)).toEqual(["General pest plan", "Detached garage"]);
    expect(offers[0].pick).toEqual({ status: "match", item: medium });
    expect(offers[1].addOn).toBe(true);
  });
});

describe("price book lines (rule 7)", () => {
  it("copies the name, kind and the right price column, as integer cents", () => {
    expect(priceBookLine(medium, "initial")).toEqual({ description: "General pest plan", kind: "initial", unit_price_cents: 24900, price_book_item_id: "medium" });
    expect(priceBookLine(small, "recurring")).toEqual({ description: "General pest plan", kind: "recurring", unit_price_cents: 9900, price_book_item_id: "small" });
  });

  it("keeps add-ons as add_on lines and says which price they carry", () => {
    expect(priceBookLine(garage, "recurring")).toEqual({ description: "Detached garage add-on (recurring)", kind: "add_on", unit_price_cents: 1500, price_book_item_id: "garage" });
  });

  it("offers only the price columns an item has", () => {
    expect(offeredColumns(medium)).toEqual(["initial", "recurring"]);
    expect(offeredColumns(band({ id: "once", one_time_price_cents: 15000 }))).toEqual(["one_time"]);
  });

  it("labels bands for people", () => {
    expect(bandLabel(small)).toBe("0 to 1,999 sq ft");
    expect(bandLabel(large)).toBe("3,500 sq ft and up");
    expect(bandLabel(garage)).toBe("any size");
    expect(bandLabel(band({ id: "lot", size_basis: "lot_sqft", size_min: 10000, size_max: 20000 }))).toBe("10,000 to 19,999 lot sq ft");
  });
});
