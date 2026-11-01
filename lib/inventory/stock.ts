// Inventory math (spec 18 rules 1 to 4), pure: quantities are in the tenant product's unit, money in integer cents.
import { convertUnit } from "@/lib/catalog/label-rates";

export const LOCATION_KINDS = ["warehouse", "truck"] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];
export const MOVEMENT_KINDS = ["receipt", "transfer", "usage", "adjustment"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

/** Quantities keep four decimals: a label rate in fluid ounces on a product stocked in gallons stays exact enough. */
export function roundQty(q: number): number {
  return Math.round(q * 10_000) / 10_000;
}

/** Rule 1: an application in the product's stock unit, or null when the units do not convert (it is listed, not deducted). */
export function usageInStockUnit(amount: number | string, usageUnit: string, stockUnit: string): number | null {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const converted = convertUnit(n, usageUnit, stockUnit);
  return converted === null ? null : roundQty(converted);
}

/** A quantity at a unit cost, half up to the cent. */
export function valueCents(quantity: number, unitCostCents: number): number {
  return Math.round(quantity * unitCostCents + 1e-6);
}

/**
 * Rule 2: the moving average cost after a receipt, half up to the cent. With nothing (or less than nothing) on hand the
 * receipt's own cost is the cost.
 */
export function movingAverage(onHand: number, currentCostCents: number, received: number, receiptCostCents: number): number {
  if (received <= 0) return currentCostCents;
  if (onHand <= 0) return receiptCostCents;
  const total = onHand * currentCostCents + received * receiptCostCents;
  return Math.round(total / (onHand + received) + 1e-9);
}

export type Movement = { product_id: string; from_location_id: string | null; to_location_id: string | null; quantity: number | string };

/** Stock on hand per location and product: what came in minus what went out. */
export function levels(movements: readonly Movement[]): Map<string, number> {
  const out = new Map<string, number>();
  const add = (location: string | null, product: string, q: number) => {
    if (!location) return;
    const key = `${location}:${product}`;
    out.set(key, roundQty((out.get(key) ?? 0) + q));
  };
  for (const m of movements) {
    const q = Number(m.quantity);
    add(m.to_location_id, m.product_id, q);
    add(m.from_location_id, m.product_id, -q);
  }
  return out;
}

/** Rule 4: a count's difference: positive is found stock (in), negative is shrink (out). */
export function countDifference(onHand: number, counted: number): number {
  return roundQty(counted - onHand);
}

export type StockFlag = "negative" | "low" | null;

/** Low against the location kind's minimum; negative whenever usage ran ahead of receipts (rule 3). */
export function stockFlag(onHand: number, kind: LocationKind, minimums: { truck_minimum: number | string | null; warehouse_minimum: number | string | null }): StockFlag {
  if (onHand < 0) return "negative";
  const min = kind === "truck" ? minimums.truck_minimum : minimums.warehouse_minimum;
  if (min !== null && min !== undefined && onHand < Number(min)) return "low";
  return null;
}

/** What the movement form checks before the database does: a positive quantity and the right ends for its kind. */
export function movementProblems(m: { kind: MovementKind; from: string | null; to: string | null; quantity: number }): string[] {
  const p: string[] = [];
  if (!Number.isFinite(m.quantity) || m.quantity <= 0) p.push("Enter a quantity above zero.");
  if (m.kind === "receipt" && (!m.to || m.from)) p.push("A receipt goes into one location.");
  if (m.kind === "transfer" && (!m.from || !m.to || m.from === m.to)) p.push("A transfer moves stock between two different locations.");
  if (m.kind === "usage" && (!m.from || m.to)) p.push("Usage comes off one location.");
  return p;
}
