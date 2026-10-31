// Price increase arithmetic, in integer cents.

export type IncreaseRule = {
  kind: "percent" | "amount";
  /** Percent as a decimal string or number, for example "5" for five percent. */
  percent: string | number | null;
  amount_cents: number | string | bigint | null;
  rounding: "cent" | "dollar";
};

/** Rounds half up to the cent, or to the whole dollar when asked. Never floats below the cent. */
export function increasedPrice(oldCents: number, rule: IncreaseRule): number {
  let raw: number;
  if (rule.kind === "amount") {
    raw = oldCents + Number(rule.amount_cents ?? 0);
  } else {
    // Work in hundredths of a percent as integers so 9900 * 5% is exact.
    const basisPoints = Math.round(Number(rule.percent ?? 0) * 100);
    raw = oldCents + (oldCents * basisPoints) / 10000;
  }
  const unit = rule.rounding === "dollar" ? 100 : 1;
  return Math.floor(raw / unit + 0.5) * unit;
}
