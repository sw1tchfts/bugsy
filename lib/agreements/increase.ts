// Price increase arithmetic, in integer cents. No floating point touches the money: percents become basis points
// and the rounding is done on integers (BigInt, so a large book of agreements cannot overflow either).

export type IncreaseRule = {
  kind: "percent" | "amount";
  /** Percent as a decimal string or number, for example "5" for five percent. */
  percent: string | number | null;
  amount_cents: number | string | bigint | null;
  rounding: "cent" | "dollar";
};

const TEN_THOUSAND = BigInt(10000);
const TWO = BigInt(2);

/** Half-up rounding of numerator/denominator to a multiple of `unit`, all integers. */
function roundToUnit(numerator: bigint, denominator: bigint, unit: bigint): bigint {
  return ((numerator * TWO + denominator * unit) / (denominator * unit * TWO)) * unit;
}

/** Rounds half up to the cent, or to the whole dollar when asked. */
export function increasedPrice(oldCents: number, rule: IncreaseRule): number {
  const unit = BigInt(rule.rounding === "dollar" ? 100 : 1);
  if (rule.kind === "amount") {
    const raw = BigInt(oldCents) + BigInt(Math.round(Number(rule.amount_cents ?? 0)));
    return Number(roundToUnit(raw, BigInt(1), unit));
  }
  // Hundredths of a percent as integers: 5% is 500 basis points, so new = old * 10500 / 10000.
  const basisPoints = BigInt(Math.round(Number(rule.percent ?? 0) * 100));
  return Number(roundToUnit(BigInt(oldCents) * (TEN_THOUSAND + basisPoints), TEN_THOUSAND, unit));
}
