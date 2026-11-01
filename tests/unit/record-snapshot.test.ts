import { describe, expect, it } from "vitest";
import { applyAmendments, buildRecordSnapshot, lockDueAt, readPath, retentionUntil } from "@/lib/compliance/records";
import type { StatePack } from "@/lib/compliance/rules";
import type { RouteVisit } from "@/lib/tech/route-types";

const TZ = "America/New_York";

function visit(overrides: Partial<RouteVisit> = {}, captured: Partial<RouteVisit["captured"]> = {}): RouteVisit {
  return {
    id: "v1",
    sequence: 1,
    status: "completed",
    kind: "recurring",
    job_kind: "recurring_treatment",
    treatment_areas: ["interior", "perimeter"],
    due_start: "2026-11-01",
    due_end: "2026-11-30",
    scheduled_for: "2026-11-01",
    route_position: 1,
    arrival_window: "any",
    interior_only: false,
    reservice_reason: null,
    dispatch_notes: null,
    price_cents: 9900,
    billing_mode: "per_visit",
    agreement_number: 7,
    account: { id: "a1", name: "Maria Lopez", phone: null },
    property: { id: "p1", address: "1234 NEIL AVE", city: "COLUMBUS", state: "OH", lat: null, lng: null, access_notes: null },
    service_type: { id: "s1", name: "General pest plan" },
    crew: [{ user_id: "u1", name: "Sam Rivera", role: "lead", credential: { cert_number: "OH-APP-1042", categories: ["7A", "7F"], trainee: false, cert_expires_on: "2027-12-31" } }],
    state_rule: null,
    required_fields: [],
    captured: {
      // 01:30 EST on November 1, after the clocks fell back; the business date is November 1.
      arrived_at: "2026-11-01T05:40:00Z",
      departed_at: "2026-11-01T06:30:00Z",
      completed_at: "2026-11-01T06:30:00Z",
      conditions: { temperature_f: 64, wind_mph: 4, wind_direction: "NW", sky: "clear", captured_at: "2026-11-01T05:45:00Z", source: "manual" },
      areas_treated: ["perimeter"],
      target_pests: ["ants"],
      products: [
        {
          id: "vp1",
          product_id: "pr1",
          product_name: "Demand CS",
          epa_reg_no: "100-1066",
          applied_by: "u1",
          site_treated: "perimeter",
          location_description: null,
          amount: "0.5",
          amount_unit: "fl_oz",
          carrier_amount: "1",
          carrier_unit: "gal",
          target_pests: ["ants"],
          label_check: { status: "ok", reason: "within the label" },
          recorded_at: "2026-11-01T06:00:00Z",
        },
      ],
      notes: [{ id: "n1", kind: "note", content: "Ant trail at the foundation.", recorded_at: "2026-11-01T06:10:00Z" }],
      photos: [],
      signature: { signer_name: "Maria Lopez", signed_at: "2026-11-01T06:28:00Z", file_id: "f1" },
      ...captured,
    },
    ...overrides,
  };
}

const pack = (rules: StatePack["rules"]): StatePack => ({ stateCode: "ZZ", version: "test-1", effectiveOn: "2026-01-01", rules });

describe("the record snapshot (rule 2)", () => {
  it("copies the visit, captures, crew and credentials, and is complete when the federal floor is met", () => {
    const build = buildRecordSnapshot(visit(), undefined, TZ);
    expect(build.complete).toBe(true);
    expect(build.missing).toEqual([]);
    expect(build.business_date).toBe("2026-11-01");
    expect(build.snapshot.crew[0]).toEqual({ user_id: "u1", name: "Sam Rivera", role: "lead", cert_number: "OH-APP-1042", categories: ["7A", "7F"], trainee: false, cert_expires_on: "2027-12-31" });
    expect(build.snapshot.products[0].applied_by).toEqual({ user_id: "u1", name: "Sam Rivera", cert_number: "OH-APP-1042" });
    expect(build.snapshot.products[0].epa_reg_no).toBe("100-1066");
    expect(build.snapshot.time_zone).toBe(TZ);
    expect(build.snapshot.pack_version).toBeNull();
    expect(build.required).toContain("applicator.cert_number");
  });

  it("lists what an imported, half-captured visit is missing", () => {
    const build = buildRecordSnapshot(visit({}, { products: [], areas_treated: [], departed_at: null, completed_at: "2026-11-01T06:30:00Z" }), undefined, TZ);
    expect(build.complete).toBe(false);
    expect(build.missing).toEqual(expect.arrayContaining(["products", "areas_treated"]));
    expect(build.missing).not.toContain("departed_at");
    const noTimes = buildRecordSnapshot(visit({}, { products: [], departed_at: null, completed_at: null }), undefined, TZ);
    expect(noTimes.missing).toContain("departed_at");
    expect(noTimes.business_date).toBe("2026-11-01");
  });

  it("adds the pack's record fields to what is required", () => {
    const build = buildRecordSnapshot(visit({}, { conditions: null }), pack({ "records.requiredFields": { value: ["conditions.wind_mph"], source: "fixture", effectiveOn: "2026-01-01" } }), TZ);
    expect(build.required).toContain("conditions.wind_mph");
    expect(build.missing).toEqual(["conditions.wind_mph"]);
    expect(build.snapshot.pack_version).toBe("test-1");
  });
});

describe("lock timing and retention (rules 3 and 5)", () => {
  it("locks at the end of the business day without a pack, on the fall-back and spring-forward days too", () => {
    // November 1, 2026 ends at 23:59:59 EST, which is 04:59:59 UTC the next day.
    expect(lockDueAt("2026-11-01T06:30:00Z", "2026-11-01", TZ, undefined)).toBe("2026-11-02T04:59:59.000Z");
    // March 14, 2027 loses an hour at 02:00; its end is 23:59:59 EDT, which is 03:59:59 UTC the next day.
    expect(lockDueAt(null, "2027-03-14", TZ, undefined)).toBe("2027-03-15T03:59:59.000Z");
  });

  it("follows the pack's completion rule", () => {
    const hours = pack({ "records.completeBy": { value: { kind: "hours_after_departure", hours: 24 }, source: "fixture", effectiveOn: "2026-01-01" } });
    expect(lockDueAt("2026-11-01T06:30:00Z", "2026-11-01", TZ, hours)).toBe("2026-11-02T06:30:00.000Z");
    expect(lockDueAt(null, "2026-11-01", TZ, hours)).toBe("2026-11-02T04:59:59.000Z");
    const endOfDay = pack({ "records.completeBy": { value: { kind: "end_of_day" }, source: "fixture", effectiveOn: "2026-01-01" } });
    expect(lockDueAt("2026-11-01T06:30:00Z", "2026-11-01", TZ, endOfDay)).toBe("2026-11-02T04:59:59.000Z");
  });

  it("keeps the record for the pack's years, or until a pack says otherwise", () => {
    expect(retentionUntil("2026-11-01", pack({ "records.retentionYears": { value: 3, source: "fixture", effectiveOn: "2026-01-01" } }))).toBe("2029-11-01");
    expect(retentionUntil("2026-11-01", undefined)).toBeNull();
  });
});

describe("amendments (rule 4)", () => {
  it("applies dotted keys and array indexes in order and leaves the original untouched", () => {
    const original = buildRecordSnapshot(visit(), undefined, TZ).snapshot;
    const current = applyAmendments(original as unknown as Record<string, unknown>, [
      { changed_fields: { "conditions.wind_mph": { from: 4, to: 6 } } },
      { changed_fields: { "products.0.amount": { from: "0.5", to: "0.6" }, areas_treated: { from: ["perimeter"], to: ["perimeter", "interior"] } } },
      { changed_fields: { "conditions.wind_mph": { from: 6, to: 7 } } },
    ]);
    expect(readPath(current, "conditions.wind_mph")).toBe(7);
    expect(readPath(current, "products.0.amount")).toBe("0.6");
    expect(readPath(current, "areas_treated")).toEqual(["perimeter", "interior"]);
    expect(readPath(original as unknown as Record<string, unknown>, "conditions.wind_mph")).toBe(4);
    expect(readPath(original as unknown as Record<string, unknown>, "products.0.amount")).toBe("0.5");
    expect(readPath(current, "no.such.key")).toBeUndefined();
  });
});
