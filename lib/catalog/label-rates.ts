// Label rate checks. A product's label is the law; the catalog stores the label's rates per site and this function
// says whether a captured application sits inside them. Spec 06 calls it before completion.

export type LabelRate = {
  /** Where the rate applies, as the label words it ("perimeter", "indoor crack and crevice"), or "any". */
  site: string;
  target_pests?: string[];
  /** Amount of product per unit of carrier or area, in rate_unit; null when the label gives only one bound. */
  min_rate: number | null;
  max_rate: number | null;
  /** "<product unit>/<per unit>", for example "fl_oz/gal", "oz/1000_sqft", "lb/acre", "ml/l". */
  rate_unit: string;
  /** Finished dilution bounds in percent, when the label states them. */
  dilution_min?: number | null;
  dilution_max?: number | null;
  notes?: string;
};

export type ApplicationInput = {
  site: string;
  /** Product amount applied. */
  amount: number;
  amountUnit: string;
  /** The carrier volume or area it went into or onto. */
  per: number;
  perUnit: string;
  dilutionPercent?: number | null;
};

export type LabelRateStatus = "ok" | "below_label" | "above_label" | "no_rate_on_file";

export type LabelRateCheck = {
  status: LabelRateStatus;
  rate: LabelRate | null;
  /** The application expressed in the matched rate's own unit, when one matched. */
  actual: number | null;
  reason: string;
};

type Dimension = "volume" | "mass" | "area" | "count";

/** Base factors: volume in milliliters, mass in grams, area in square meters. */
const UNITS: Record<string, { dimension: Dimension; factor: number }> = {
  ml: { dimension: "volume", factor: 1 },
  l: { dimension: "volume", factor: 1000 },
  fl_oz: { dimension: "volume", factor: 29.5735 },
  pt: { dimension: "volume", factor: 473.176 },
  qt: { dimension: "volume", factor: 946.353 },
  gal: { dimension: "volume", factor: 3785.41 },
  g: { dimension: "mass", factor: 1 },
  kg: { dimension: "mass", factor: 1000 },
  oz: { dimension: "mass", factor: 28.3495 },
  lb: { dimension: "mass", factor: 453.592 },
  sqft: { dimension: "area", factor: 0.092903 },
  "1000_sqft": { dimension: "area", factor: 92.903 },
  sqm: { dimension: "area", factor: 1 },
  acre: { dimension: "area", factor: 4046.86 },
  each: { dimension: "count", factor: 1 },
};

const EPSILON = 1e-9;

function unit(name: string) {
  return UNITS[name.trim().toLowerCase()];
}

/** Parses "fl_oz/gal" into its two units, or null when either side is unknown. */
/** `amount` in `from` expressed in `to`; null when the units are not of the same kind (a count against a volume). */
export function convertUnit(amount: number, from: string, to: string): number | null {
  const a = unit(from);
  const b = unit(to);
  if (!a || !b || a.dimension !== b.dimension) return null;
  if (a === b) return amount;
  return (amount * a.factor) / b.factor;
}

export function parseRateUnit(rateUnit: string): { amount: string; per: string } | null {
  const [amount, per] = rateUnit.split("/").map((s) => s.trim().toLowerCase());
  if (!amount || !per || !unit(amount) || !unit(per)) return null;
  return { amount, per };
}

/** Converts an application into the rate's unit; null when the dimensions do not line up. */
export function rateInUnit(input: ApplicationInput, rateUnit: string): number | null {
  const parsed = parseRateUnit(rateUnit);
  const amountUnit = unit(input.amountUnit);
  const perUnit = unit(input.perUnit);
  if (!parsed || !amountUnit || !perUnit || input.per <= 0) return null;
  const rateAmount = unit(parsed.amount);
  const ratePer = unit(parsed.per);
  if (amountUnit.dimension !== rateAmount.dimension || perUnit.dimension !== ratePer.dimension) return null;
  const amountInRateUnit = (input.amount * amountUnit.factor) / rateAmount.factor;
  const perInRateUnit = (input.per * perUnit.factor) / ratePer.factor;
  return amountInRateUnit / perInRateUnit;
}

function siteMatches(rate: LabelRate, site: string): boolean {
  const want = site.trim().toLowerCase();
  const have = rate.site.trim().toLowerCase();
  return have === "any" || have === "*" || have === want;
}

/** Compares an application against the product's label rates for that site. */
export function checkLabelRate(product: { label_rates: LabelRate[] | unknown }, input: ApplicationInput): LabelRateCheck {
  const rates = Array.isArray(product.label_rates) ? (product.label_rates as LabelRate[]) : [];
  const candidates = rates.filter((r) => r && typeof r.site === "string" && siteMatches(r, input.site));
  if (candidates.length === 0) return { status: "no_rate_on_file", rate: null, actual: null, reason: `no label rate on file for ${input.site}` };

  for (const rate of candidates) {
    const actual = rateInUnit(input, rate.rate_unit);
    if (actual === null) continue;
    if (rate.min_rate !== null && rate.min_rate !== undefined && actual < rate.min_rate - EPSILON) {
      return { status: "below_label", rate, actual, reason: `${trim(actual)} ${rate.rate_unit} is below the label minimum of ${rate.min_rate}` };
    }
    if (rate.max_rate !== null && rate.max_rate !== undefined && actual > rate.max_rate + EPSILON) {
      return { status: "above_label", rate, actual, reason: `${trim(actual)} ${rate.rate_unit} is above the label maximum of ${rate.max_rate}` };
    }
    if (input.dilutionPercent !== null && input.dilutionPercent !== undefined) {
      if (rate.dilution_min !== null && rate.dilution_min !== undefined && input.dilutionPercent < rate.dilution_min - EPSILON) {
        return { status: "below_label", rate, actual, reason: `${input.dilutionPercent}% is below the label dilution of ${rate.dilution_min}%` };
      }
      if (rate.dilution_max !== null && rate.dilution_max !== undefined && input.dilutionPercent > rate.dilution_max + EPSILON) {
        return { status: "above_label", rate, actual, reason: `${input.dilutionPercent}% is above the label dilution of ${rate.dilution_max}%` };
      }
    }
    return { status: "ok", rate, actual, reason: `${trim(actual)} ${rate.rate_unit} is within the label` };
  }
  return { status: "no_rate_on_file", rate: null, actual: null, reason: `the label rate for ${input.site} is in different units than the application` };
}

function trim(n: number): string {
  return Number(n.toFixed(4)).toString();
}

/** Validates label rate JSON as entered in the console; returns the clean array or the first problem. */
export function parseLabelRates(text: string): { rates: LabelRate[] } | { error: string } {
  if (!text.trim()) return { rates: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "Label rates must be a JSON array." };
  }
  if (!Array.isArray(parsed)) return { error: "Label rates must be a JSON array." };
  const rates: LabelRate[] = [];
  for (const [i, raw] of parsed.entries()) {
    const r = raw as Partial<LabelRate>;
    if (!r || typeof r.site !== "string" || !r.site.trim()) return { error: `Rate ${i + 1} needs a site.` };
    if (typeof r.rate_unit !== "string" || !parseRateUnit(r.rate_unit)) return { error: `Rate ${i + 1} needs a rate_unit such as fl_oz/gal or oz/1000_sqft.` };
    const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
    const min = num(r.min_rate);
    const max = num(r.max_rate);
    if ((min !== null && Number.isNaN(min)) || (max !== null && Number.isNaN(max))) return { error: `Rate ${i + 1} has a rate that is not a number.` };
    if (min === null && max === null) return { error: `Rate ${i + 1} needs a minimum or a maximum.` };
    if (min !== null && max !== null && min > max) return { error: `Rate ${i + 1} has a minimum above its maximum.` };
    rates.push({
      site: r.site.trim(),
      target_pests: Array.isArray(r.target_pests) ? r.target_pests.map(String) : [],
      min_rate: min,
      max_rate: max,
      rate_unit: r.rate_unit.trim().toLowerCase(),
      dilution_min: num(r.dilution_min),
      dilution_max: num(r.dilution_max),
      notes: typeof r.notes === "string" ? r.notes : undefined,
    });
  }
  return { rates };
}
