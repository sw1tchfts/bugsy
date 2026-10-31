// Reads product fields from a form the same way for tenants and platform admins.
import { normalizeEpaRegNo } from "@/lib/catalog/epa";
import { type LabelRate, parseLabelRates } from "@/lib/catalog/label-rates";

export const SIGNAL_WORDS = ["caution", "warning", "danger", "none"] as const;
export const PRODUCT_UNITS = ["fl_oz", "oz", "lb", "gal", "ml", "l", "g", "kg", "each"] as const;
export const UNIT_LABELS: Record<(typeof PRODUCT_UNITS)[number], string> = {
  fl_oz: "fl oz",
  oz: "oz",
  lb: "lb",
  gal: "gal",
  ml: "ml",
  l: "L",
  g: "g",
  kg: "kg",
  each: "each",
};

export type ProductInput = {
  name: string;
  manufacturer: string | null;
  epa_reg_no: string;
  active_ingredients: string[];
  signal_word: string;
  restricted_use: boolean;
  rei_hours: number | null;
  formulation: string | null;
  label_url: string | null;
  sds_url: string | null;
  label_rates: LabelRate[];
};

function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function url(value: string): string | null | undefined {
  if (!value) return null;
  return /^https?:\/\/\S+$/i.test(value) ? value : undefined;
}

export function readProduct(formData: FormData): { value: ProductInput } | { error: string } {
  const name = text(formData, "name");
  if (!name) return { error: "A product needs its name as printed on the label." };
  const epa = normalizeEpaRegNo(text(formData, "epa_reg_no"));
  if (!epa) return { error: "The EPA registration number looks like 7969-210 (or 25b-exempt for a minimum-risk product)." };
  const signal = text(formData, "signal_word") || "caution";
  if (!(SIGNAL_WORDS as readonly string[]).includes(signal)) return { error: "Pick the label's signal word." };
  const reiRaw = text(formData, "rei_hours");
  const rei = reiRaw ? Number(reiRaw) : null;
  if (rei !== null && (Number.isNaN(rei) || rei < 0)) return { error: "The restricted entry interval is hours, for example 4." };
  const labelUrl = url(text(formData, "label_url"));
  const sdsUrl = url(text(formData, "sds_url"));
  if (labelUrl === undefined || sdsUrl === undefined) return { error: "Label and SDS links start with http:// or https://." };
  const rates = parseLabelRates(text(formData, "label_rates"));
  if ("error" in rates) return { error: rates.error };
  return {
    value: {
      name,
      manufacturer: text(formData, "manufacturer") || null,
      epa_reg_no: epa,
      active_ingredients: text(formData, "active_ingredients")
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      signal_word: signal,
      restricted_use: formData.get("restricted_use") === "true",
      rei_hours: rei,
      formulation: text(formData, "formulation") || null,
      label_url: labelUrl,
      sds_url: sdsUrl,
      label_rates: rates.rates,
    },
  };
}
