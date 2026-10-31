import { describe, expect, it } from "vitest";
import { type RecordCrewMember, type RecordProduct, type RecordVisit, recordGaps, requiredRecordFields } from "@/lib/compliance/records";
import type { StatePack } from "@/lib/compliance/rules";

const visit: RecordVisit = {
  job_kind: "recurring_treatment",
  arrived_at: "2026-11-02T14:05:00Z",
  departed_at: null,
  scheduled_for: "2026-11-02",
  areas_treated: ["perimeter"],
  target_pests: ["ants"],
  conditions: null,
  property_address: "1234 NEIL AVE, COLUMBUS OH 43201",
  property_state: "OH",
  service_type_name: "General pest plan",
};
const product: RecordProduct = { product_name: "Demand CS", epa_reg_no: "100-1066", amount: "0.5", amount_unit: "fl_oz", site_treated: "perimeter", target_pests: ["ants"] };
const crew: RecordCrewMember[] = [{ role: "lead", name: "Sam Rivera", credential: { cert_number: "OH-APP-1042", trainee: false } }];
const ZZ: StatePack = { stateCode: "ZZ", version: "test-1", effectiveOn: "2026-01-01", rules: { "records.requiredFields": { value: ["conditions.wind_mph", "conditions.temperature_f"], source: "fixture", effectiveOn: "2026-01-01" } } };

const keys = (gaps: { key: string }[]) => gaps.map((g) => g.key);

describe("the completion gate (rule 4)", () => {
  it("passes a complete pesticide visit", () => {
    expect(recordGaps(visit, [product], crew, requiredRecordFields("recurring_treatment", undefined), false)).toEqual([]);
  });

  it("names every missing floor field", () => {
    const required = requiredRecordFields("recurring_treatment", undefined);
    expect(keys(recordGaps({ ...visit, arrived_at: null }, [product], crew, required, false))).toEqual(["arrived_at"]);
    expect(keys(recordGaps(visit, [], crew, required, false))).toEqual(["products"]);
    expect(keys(recordGaps(visit, [{ ...product, amount: null }], crew, required, false))).toEqual(["product.amount"]);
    expect(keys(recordGaps(visit, [{ ...product, site_treated: "" }], crew, required, false))).toEqual(["product.site"]);
    expect(keys(recordGaps({ ...visit, target_pests: [] }, [{ ...product, target_pests: [] }], crew, required, false))).toEqual(["product.target_pests"]);
    expect(keys(recordGaps({ ...visit, areas_treated: [] }, [product], crew, required, false))).toEqual(["areas_treated"]);
    expect(keys(recordGaps(visit, [product], [], required, false))).toEqual(["applicator.name", "applicator.cert_number"]);
    expect(keys(recordGaps(visit, [product], [{ role: "lead", name: "Lee", credential: { cert_number: null, trainee: true } }], required, false))).toEqual(["applicator.cert_number"]);
  });

  it("adds the pack's keys and reads them off the visit", () => {
    const required = requiredRecordFields("recurring_treatment", ZZ);
    expect(required).toContain("conditions.wind_mph");
    expect(keys(recordGaps(visit, [product], crew, required, false))).toEqual(["conditions.wind_mph", "conditions.temperature_f"]);
    const withConditions = { ...visit, conditions: { wind_mph: 4, temperature_f: 61 } };
    expect(recordGaps(withConditions, [product], crew, required, false)).toEqual([]);
  });

  it("asks only for times and some evidence on work that applies no pesticide", () => {
    const required = requiredRecordFields("trapping", ZZ);
    expect(required).toEqual(["arrived_at", "departed_at", "note_or_photo"]);
    const trapping = { ...visit, job_kind: "trapping" as const, areas_treated: [], target_pests: [] };
    expect(keys(recordGaps(trapping, [], [], required, false))).toEqual(["note_or_photo"]);
    expect(recordGaps(trapping, [], [], required, true)).toEqual([]);
  });
});
