// Price book lookups. Pure functions shared by the quote builder now and by agreements later.

export type SizeBasis = "none" | "size_sqft" | "lot_sqft";
export type PriceColumn = "initial" | "recurring" | "one_time";
export type LineKind = "initial" | "recurring" | "one_time" | "add_on";

export type PriceBookItemLike = {
  id: string;
  service_type_id: string;
  name: string;
  add_on: boolean;
  size_basis: SizeBasis;
  size_min: number;
  size_max: number | null;
  initial_price_cents: number | string | bigint;
  recurring_price_cents: number | string | bigint;
  one_time_price_cents: number | string | bigint;
};

export type PropertyMeasure = { sizeSqft: number | null; lotSqft: number | null };

export type PricePick =
  | { status: "match"; item: PriceBookItemLike }
  | { status: "needs_measurement"; basis: Exclude<SizeBasis, "none"> }
  | { status: "no_band" };

/** Picks, among the bands that share one item name, the one whose band contains the property's measure. */
export function pickPriceBookItem(bands: readonly PriceBookItemLike[], measure: PropertyMeasure): PricePick {
  let missing: Exclude<SizeBasis, "none"> | null = null;
  for (const band of bands) {
    if (band.size_basis === "none") return { status: "match", item: band };
    const value = band.size_basis === "size_sqft" ? measure.sizeSqft : measure.lotSqft;
    if (value === null || value === undefined) {
      missing = band.size_basis;
      continue;
    }
    if (value >= band.size_min && (band.size_max === null || value < band.size_max)) return { status: "match", item: band };
  }
  return missing ? { status: "needs_measurement", basis: missing } : { status: "no_band" };
}

export type PriceBookOffer = { serviceTypeId: string; name: string; addOn: boolean; pick: PricePick };

/** Groups a service type's items by name and resolves each group against the property, in the order given. */
export function priceBookOffers(items: readonly PriceBookItemLike[], measure: PropertyMeasure): PriceBookOffer[] {
  const groups = new Map<string, PriceBookItemLike[]>();
  for (const item of items) {
    const key = `${item.service_type_id}\u0000${item.name}`;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()].map((bands) => ({
    serviceTypeId: bands[0].service_type_id,
    name: bands[0].name,
    addOn: bands[0].add_on,
    pick: pickPriceBookItem(bands, measure),
  }));
}

export function cents(value: number | string | bigint): number {
  return typeof value === "number" ? value : Number(value);
}

export function priceFor(item: PriceBookItemLike, column: PriceColumn): number {
  if (column === "initial") return cents(item.initial_price_cents);
  if (column === "recurring") return cents(item.recurring_price_cents);
  return cents(item.one_time_price_cents);
}

/** The price columns an item actually offers (non-zero), in display order. */
export function offeredColumns(item: PriceBookItemLike): PriceColumn[] {
  return (["initial", "recurring", "one_time"] as const).filter((c) => priceFor(item, c) > 0);
}

const COLUMN_LABELS: Record<PriceColumn, string> = { initial: "initial", recurring: "recurring", one_time: "one-time" };

/** The quote line an item produces for one of its price columns. Add-ons keep the add_on kind and say which price they carry. */
export function priceBookLine(item: PriceBookItemLike, column: PriceColumn): { description: string; kind: LineKind; unit_price_cents: number; price_book_item_id: string } {
  return {
    description: item.add_on ? `${item.name} add-on (${COLUMN_LABELS[column]})` : item.name,
    kind: item.add_on ? "add_on" : column,
    unit_price_cents: priceFor(item, column),
    price_book_item_id: item.id,
  };
}

/** A human label for a band, for example "2,000 to 3,499 sq ft" or "3,500 sq ft and up". */
export function bandLabel(item: Pick<PriceBookItemLike, "size_basis" | "size_min" | "size_max">): string {
  if (item.size_basis === "none") return "any size";
  const what = item.size_basis === "size_sqft" ? "sq ft" : "lot sq ft";
  const fmt = (n: number) => n.toLocaleString("en-US");
  if (item.size_max === null) return `${fmt(item.size_min)} ${what} and up`;
  return `${fmt(item.size_min)} to ${fmt(item.size_max - 1)} ${what}`;
}
