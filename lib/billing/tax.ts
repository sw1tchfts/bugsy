// Sales tax (spec 08 rule 5): the service type's tax class for the property's state decides whether a line is taxed;
// the rates in force for the service address on the issue date decide how much. Rates are data in tax_rates with
// sources and effective dates; nothing here knows a rate. Integer cents in, integer cents out, half up per line.

export type TaxRate = {
  id?: string;
  state_code: string;
  postal_code: string;
  jurisdiction_kind: string;
  jurisdiction_name: string;
  rate: string | number;
  effective_from: string;
  effective_to: string | null;
};

export type TaxClass = "taxable" | "exempt" | "unknown" | "exempt_certificate";

export type TaxBreakdown = { kind: string; name: string; rate: string; cents: number };

export type LineTax = { tax_cents: number; rate: string; breakdown: TaxBreakdown[] };

const SCALE = BigInt(1_000_000_000);

/** A decimal rate string such as "0.055" as an integer scaled by 1e9; a number is accepted but strings are exact. */
export function scaledRate(rate: string | number): bigint {
  const text = typeof rate === "number" ? rate.toString() : rate.trim();
  const match = /^(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) throw new Error(`not a rate: ${text}`);
  const whole = match[1] || "0";
  const fraction = (match[2] || "").padEnd(9, "0").slice(0, 9);
  return BigInt(whole) * SCALE + BigInt(fraction);
}

/** cents * rate, rounded half up to the cent, with the rate scaled by 1e9. */
export function centsAtRate(cents: number, scaled: bigint): number {
  const numerator = BigInt(cents) * scaled;
  const twice = numerator * BigInt(2) + SCALE;
  return Number(twice / (SCALE * BigInt(2)));
}

function formatRate(scaled: bigint): string {
  const whole = scaled / SCALE;
  const fraction = (scaled % SCALE).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction.length ? `${whole}.${fraction}` : `${whole}`;
}

/** The rows that apply to an address on a date. */
export function ratesInForce(rates: readonly TaxRate[], stateCode: string, postalCode: string, onDate: string): TaxRate[] {
  const zip = postalCode.trim().slice(0, 5);
  const state = stateCode.trim().toUpperCase();
  return rates.filter((r) => r.state_code === state && r.postal_code === zip && r.effective_from <= onDate && (r.effective_to === null || r.effective_to >= onDate));
}

/** The line's tax class: the account's certificate wins, then the service type's rule for the state, else unknown. */
export function taxClassFor(
  stateRule: { tax_class: string } | null | undefined,
  account: { tax_exempt_number: string | null; tax_exempt_expires_on: string | null } | null | undefined,
  onDate: string,
): TaxClass {
  if (account?.tax_exempt_number && (!account.tax_exempt_expires_on || account.tax_exempt_expires_on >= onDate)) return "exempt_certificate";
  const cls = stateRule?.tax_class;
  return cls === "taxable" || cls === "exempt" ? cls : "unknown";
}

/** The tax on one line: nothing unless the class is taxable; the breakdown sums exactly to the line's tax. */
export function taxForLine(input: { amount_cents: number; tax_class: TaxClass; rates: readonly TaxRate[] }): LineTax {
  if (input.tax_class !== "taxable" || input.rates.length === 0 || input.amount_cents <= 0) return { tax_cents: 0, rate: "0", breakdown: [] };
  const scaled = input.rates.map((r) => scaledRate(r.rate));
  const total = scaled.reduce((sum, s) => sum + s, BigInt(0));
  const tax_cents = centsAtRate(input.amount_cents, total);
  const breakdown: TaxBreakdown[] = input.rates.map((r, i) => ({ kind: r.jurisdiction_kind, name: r.jurisdiction_name, rate: formatRate(scaled[i]), cents: centsAtRate(input.amount_cents, scaled[i]) }));
  const spread = breakdown.reduce((sum, b) => sum + b.cents, 0);
  if (breakdown.length && spread !== tax_cents) breakdown[breakdown.length - 1].cents += tax_cents - spread;
  return { tax_cents, rate: formatRate(total), breakdown };
}
