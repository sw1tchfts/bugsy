import { describe, expect, it } from "vitest";
import { stateDefaults } from "@/lib/catalog/state-defaults";
import { PACKS, type StatePack, getStatePack } from "@/lib/compliance/rules";

// A fixture pack for a state that cannot exist, so no real rule is ever invented here.
const ZZ: StatePack = {
  stateCode: "ZZ",
  version: "test-1",
  effectiveOn: "2026-01-01",
  rules: {
    "certification.categoriesByServiceLine": {
      value: { general_pest: ["7A"], mosquito: ["7F", "3A"], termite: ["7B"] },
      source: "fixture",
      effectiveOn: "2026-01-01",
    },
    "tax.taxabilityByServiceLine": {
      value: { general_pest: "exempt", mosquito: "exempt", termite: "exempt" },
      source: "fixture",
      effectiveOn: "2026-01-01",
    },
    "tax.taxabilityByTreatmentArea": {
      value: { yard: "taxable" },
      source: "fixture",
      effectiveOn: "2026-01-01",
    },
  },
};
const packs = { ZZ };

describe("state defaults for a service type (rules 2 to 4)", () => {
  it("ships with no researched state, so every real state answers unknown", () => {
    expect(Object.keys(PACKS)).toEqual([]);
    expect(getStatePack("OH")).toBeUndefined();
    expect(stateDefaults("OH", "general_pest", ["interior", "perimeter"])).toEqual({ certCategories: [], taxClass: "unknown", packVersion: null });
  });

  it("reads certification categories by service line, sorted", () => {
    expect(stateDefaults("ZZ", "mosquito", ["yard"], packs).certCategories).toEqual(["3A", "7F"]);
    expect(stateDefaults("ZZ", "general_pest", ["interior"], packs).certCategories).toEqual(["7A"]);
    expect(stateDefaults("zz", "wildlife", [], packs).certCategories).toEqual([]);
  });

  it("takes taxability from the service line unless a treated area overrides it", () => {
    expect(stateDefaults("ZZ", "general_pest", ["interior", "perimeter"], packs).taxClass).toBe("exempt");
    expect(stateDefaults("ZZ", "mosquito", ["yard"], packs).taxClass).toBe("taxable");
    expect(stateDefaults("ZZ", "general_pest", ["perimeter", "yard"], packs).taxClass).toBe("taxable");
    expect(stateDefaults("ZZ", "wildlife", [], packs).taxClass).toBe("unknown");
  });

  it("records the pack version the defaults came from", () => {
    expect(stateDefaults("ZZ", "termite", ["wood"], packs).packVersion).toBe("test-1");
  });
});
