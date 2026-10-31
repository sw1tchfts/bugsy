import { describe, expect, it } from "vitest";
import { type LabelRate, checkLabelRate, parseLabelRates, rateInUnit } from "@/lib/catalog/label-rates";

const perimeter: LabelRate = { site: "perimeter", target_pests: ["ants"], min_rate: 0.2, max_rate: 0.8, rate_unit: "fl_oz/gal" };
const granular: LabelRate = { site: "lawn", min_rate: 2.3, max_rate: 4.6, rate_unit: "lb/1000_sqft" };
const dilution: LabelRate = { site: "any", min_rate: null, max_rate: 0.8, rate_unit: "fl_oz/gal", dilution_min: 0.06, dilution_max: 0.06 };
const product = { label_rates: [perimeter, granular] };

describe("label rate checks (rule 12)", () => {
  it("passes an application inside the label range", () => {
    const result = checkLabelRate(product, { site: "perimeter", amount: 0.5, amountUnit: "fl_oz", per: 1, perUnit: "gal" });
    expect(result.status).toBe("ok");
    expect(result.rate).toBe(perimeter);
    expect(result.actual).toBeCloseTo(0.5);
  });

  it("flags below and above the label", () => {
    expect(checkLabelRate(product, { site: "Perimeter", amount: 0.1, amountUnit: "fl_oz", per: 1, perUnit: "gal" }).status).toBe("below_label");
    expect(checkLabelRate(product, { site: "perimeter", amount: 1, amountUnit: "fl_oz", per: 1, perUnit: "gal" }).status).toBe("above_label");
    expect(checkLabelRate(product, { site: "perimeter", amount: 0.8, amountUnit: "fl_oz", per: 1, perUnit: "gal" }).status).toBe("ok");
  });

  it("converts units before comparing", () => {
    // 4 fl oz in 5 gallons is 0.8 fl oz per gallon, the label maximum.
    expect(checkLabelRate(product, { site: "perimeter", amount: 4, amountUnit: "fl_oz", per: 5, perUnit: "gal" }).status).toBe("ok");
    // 60 ml in 3.785 liters is about 2.03 fl oz per gallon.
    expect(rateInUnit({ site: "perimeter", amount: 60, amountUnit: "ml", per: 3.78541, perUnit: "l" }, "fl_oz/gal")).toBeCloseTo(2.03, 2);
    // 3 lb over 1,000 sq ft, entered as 3 lb over 93 sq m.
    expect(checkLabelRate(product, { site: "lawn", amount: 3, amountUnit: "lb", per: 93, perUnit: "sqm" }).status).toBe("ok");
    // 10 kg per acre is about 0.51 lb per 1,000 sq ft, below the label.
    expect(checkLabelRate(product, { site: "lawn", amount: 10, amountUnit: "kg", per: 1, perUnit: "acre" }).status).toBe("below_label");
  });

  it("says no rate on file for an unknown site or unlike units", () => {
    expect(checkLabelRate(product, { site: "indoor", amount: 1, amountUnit: "fl_oz", per: 1, perUnit: "gal" }).status).toBe("no_rate_on_file");
    expect(checkLabelRate(product, { site: "perimeter", amount: 1, amountUnit: "oz", per: 1000, perUnit: "sqft" }).status).toBe("no_rate_on_file");
    expect(checkLabelRate({ label_rates: "not an array" }, { site: "perimeter", amount: 1, amountUnit: "fl_oz", per: 1, perUnit: "gal" }).status).toBe("no_rate_on_file");
  });

  it("checks the finished dilution when the label states one", () => {
    const p = { label_rates: [dilution] };
    expect(checkLabelRate(p, { site: "crack and crevice", amount: 0.8, amountUnit: "fl_oz", per: 1, perUnit: "gal", dilutionPercent: 0.06 }).status).toBe("ok");
    expect(checkLabelRate(p, { site: "crack and crevice", amount: 0.8, amountUnit: "fl_oz", per: 1, perUnit: "gal", dilutionPercent: 0.12 }).status).toBe("above_label");
    expect(checkLabelRate(p, { site: "crack and crevice", amount: 0.8, amountUnit: "fl_oz", per: 1, perUnit: "gal", dilutionPercent: 0.03 }).status).toBe("below_label");
  });
});

describe("label rate entry", () => {
  it("accepts a clean array and normalizes numbers", () => {
    const parsed = parseLabelRates('[{"site":"Perimeter","min_rate":"0.2","max_rate":0.8,"rate_unit":"FL_OZ/GAL","target_pests":["ants"]}]');
    expect(parsed).toEqual({ rates: [{ site: "Perimeter", target_pests: ["ants"], min_rate: 0.2, max_rate: 0.8, rate_unit: "fl_oz/gal", dilution_min: null, dilution_max: null, notes: undefined }] });
    expect(parseLabelRates("  ")).toEqual({ rates: [] });
  });

  it("explains what is wrong", () => {
    expect(parseLabelRates("{")).toEqual({ error: "Label rates must be a JSON array." });
    expect(parseLabelRates('[{"site":"","min_rate":1,"rate_unit":"fl_oz/gal"}]')).toEqual({ error: "Rate 1 needs a site." });
    expect(parseLabelRates('[{"site":"x","min_rate":1,"rate_unit":"cups/bucket"}]')).toEqual({ error: "Rate 1 needs a rate_unit such as fl_oz/gal or oz/1000_sqft." });
    expect(parseLabelRates('[{"site":"x","rate_unit":"fl_oz/gal"}]')).toEqual({ error: "Rate 1 needs a minimum or a maximum." });
    expect(parseLabelRates('[{"site":"x","min_rate":2,"max_rate":1,"rate_unit":"fl_oz/gal"}]')).toEqual({ error: "Rate 1 has a minimum above its maximum." });
  });
});
