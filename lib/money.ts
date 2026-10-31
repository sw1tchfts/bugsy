// Money is integer cents everywhere. These helpers mirror the database's generated columns.

/** quantity times unit price, rounded half up to the cent, the same as round(numeric) in Postgres. */
export function lineAmountCents(quantity: number, unitPriceCents: number): number {
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPriceCents)) throw new Error("quantity and price must be numbers");
  // Work in integer thousandths to avoid floating point drift before rounding.
  const thousandths = Math.round(quantity * 1000) * Math.round(unitPriceCents);
  return Math.floor((thousandths + 500) / 1000);
}

export function formatCents(cents: number | bigint | string): string {
  const n = typeof cents === "string" ? Number(cents) : Number(cents);
  return (n / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Parses "150", "150.00", "$1,250.5" into cents; returns null for anything else. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [dollars, fraction = ""] = cleaned.split(".");
  return Number(dollars) * 100 + Number((fraction + "00").slice(0, 2));
}
