import { describe, expect, it } from "vitest";
import type { StatePack } from "@/lib/compliance/rules";
import { type CheckInput, type CrewMember, type Credential, checkAssignment } from "@/lib/dispatch/checks";

// A fixture pack for a state that cannot exist; no real rule is invented here.
const ZZ: StatePack = {
  stateCode: "ZZ",
  version: "test-1",
  effectiveOn: "2026-01-01",
  rules: {
    "certification.categoriesByServiceLine": { value: { general_pest: ["7A"] }, source: "fixture", effectiveOn: "2026-01-01" },
    "trainee.maxDays": { value: 120, source: "fixture", effectiveOn: "2026-01-01" },
    "trainee.supervision": { value: "on_site", source: "fixture", effectiveOn: "2026-01-01" },
    "blackout.bat_exclusion": { value: [{ from: "06-01", to: "08-15" }], source: "fixture", effectiveOn: "2026-01-01" },
    "registry.triggers": { value: { treatmentAreas: ["yard"] }, source: "fixture", effectiveOn: "2026-01-01" },
  },
};

const certified: Credential = { cert_number: "A-1", categories: ["7A", "7F"], cert_expires_on: "2027-12-31", license_expires_on: "2027-12-31", trainee_registered_on: null, supervisor_id: null };
const trainee: Credential = { cert_number: null, categories: [], cert_expires_on: null, license_expires_on: null, trainee_registered_on: "2026-09-01", supervisor_id: "u1" };

const lead = (credential: Credential | null, extra: Partial<CrewMember> = {}): CrewMember => ({ user_id: "u1", name: "Sam", role: "lead", credential, branch_ids: null, ...extra });

function input(overrides: Partial<CheckInput> = {}, visit: Partial<CheckInput["visit"]> = {}): CheckInput {
  return {
    visit: {
      job_kind: "recurring_treatment",
      treatment_areas: ["interior", "perimeter"],
      due_start: "2026-11-01",
      due_end: "2026-11-30",
      scheduled_for: "2026-11-10",
      arrival_window: "any",
      property_state: "ZZ",
      registry_matches: {},
      branch_id: "b1",
      ...visit,
    },
    stateRule: { required_cert_categories: ["7A"], pack_version: "test-1", confirmed_at: null },
    crew: [lead(certified)],
    pack: ZZ,
    today: "2026-10-31",
    ...overrides,
  };
}

const codes = (r: ReturnType<typeof checkAssignment>) => ({ b: r.blockers.map((i) => i.code), w: r.warnings.map((i) => i.code) });

describe("dispatch checks (rules 1 to 7)", () => {
  it("passes a certified, current lead with the right categories", () => {
    const r = checkAssignment(input());
    expect(r.ok).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("blocks an empty crew", () => {
    expect(codes(checkAssignment(input({ crew: [] }))).b).toContain("no_crew");
  });

  it("blocks missing or unconfirmed state rules unless a pack covers the state (rule 3)", () => {
    expect(codes(checkAssignment(input({ stateRule: null }))).b).toContain("no_state_rules");
    expect(codes(checkAssignment(input({ stateRule: { required_cert_categories: [], pack_version: null, confirmed_at: null }, pack: undefined }))).b).toContain("state_rules_unconfirmed");
    const confirmed = checkAssignment(input({ stateRule: { required_cert_categories: [], pack_version: null, confirmed_at: "2026-10-01T00:00:00Z" }, pack: undefined }));
    expect(confirmed.ok).toBe(true);
  });

  it("checks credentials on the scheduled date: missing, expired the day before, allowed the day of, categories (rule 2)", () => {
    expect(codes(checkAssignment(input({ crew: [lead(null)] }))).b).toEqual(["no_credential"]);
    expect(codes(checkAssignment(input({ crew: [lead({ ...certified, cert_expires_on: "2026-11-09" })] }))).b).toEqual(["cert_expired"]);
    expect(checkAssignment(input({ crew: [lead({ ...certified, cert_expires_on: "2026-11-10" })] })).ok).toBe(true);
    expect(codes(checkAssignment(input({ crew: [lead({ ...certified, license_expires_on: "2026-01-01" })] }))).b).toEqual(["license_expired"]);
    expect(codes(checkAssignment(input({ crew: [lead({ ...certified, categories: ["7F"] })] }))).b).toEqual(["missing_categories"]);
    expect(checkAssignment(input({ crew: [lead(certified, { role: "helper" }), { user_id: "u2", name: "Lee", role: "lead", credential: certified, branch_ids: null }] })).ok).toBe(true);
  });

  it("supervises trainees and applies the pack's time limit (rule 2)", () => {
    const alone = checkAssignment(input({ crew: [lead(trainee)] }));
    expect(codes(alone).b).toEqual(["trainee_unsupervised"]);
    const supervised = checkAssignment(input({ crew: [lead(trainee), { user_id: "u2", name: "Lee", role: "supervisor", credential: certified, branch_ids: null }] }));
    expect(supervised.ok).toBe(true);
    const overLimit = checkAssignment(input({ crew: [{ ...lead(trainee), role: "applicator" }, { user_id: "u2", name: "Lee", role: "lead", credential: certified, branch_ids: null }] }, { scheduled_for: "2027-02-01", due_start: "2027-02-01", due_end: "2027-02-28" }));
    expect(codes(overLimit).b).toEqual(["trainee_over_limit"]);
    const unknownState = checkAssignment(input({ pack: undefined, stateRule: { required_cert_categories: [], pack_version: null, confirmed_at: "2026-10-01T00:00:00Z" }, crew: [lead(trainee), { user_id: "u2", name: "Lee", role: "supervisor", credential: certified, branch_ids: null }] }));
    expect(unknownState.ok).toBe(true);
    expect(codes(unknownState).w).toContain("trainee_rules_unknown");
  });

  it("skips the credential check for work that applies no pesticide", () => {
    const r = checkAssignment(input({ crew: [lead(null)] }, { job_kind: "trapping", treatment_areas: [] }));
    expect(r.ok).toBe(true);
  });

  it("refuses dates inside a blackout the pack defines (rule 4)", () => {
    const inside = checkAssignment(input({ crew: [lead(null)] }, { job_kind: "bat_exclusion", treatment_areas: [], scheduled_for: "2026-07-04", due_start: "2026-07-01", due_end: "2026-07-31" }));
    expect(codes(inside).b).toEqual(["blackout"]);
    const outside = checkAssignment(input({ crew: [lead(null)] }, { job_kind: "bat_exclusion", treatment_areas: [], scheduled_for: "2026-09-04", due_start: "2026-09-01", due_end: "2026-09-30" }));
    expect(outside.ok).toBe(true);
    const noPack = checkAssignment(input({ pack: undefined, crew: [lead(null)] }, { job_kind: "bat_exclusion", treatment_areas: [], scheduled_for: "2026-07-04", due_start: "2026-07-01", due_end: "2026-07-31" }));
    expect(noPack.ok).toBe(true);
  });

  it("holds registry addresses for the work the pack names (rule 5)", () => {
    const yard = checkAssignment(input({}, { treatment_areas: ["yard"], registry_matches: { ZZ: ["reg-1"] } }));
    expect(codes(yard).b).toEqual(["registry_notice_due"]);
    const interior = checkAssignment(input({}, { treatment_areas: ["interior"], registry_matches: { ZZ: ["reg-1"] } }));
    expect(interior.ok).toBe(true);
    const noMatch = checkAssignment(input({}, { treatment_areas: ["yard"], registry_matches: {} }));
    expect(noMatch.ok).toBe(true);
  });

  it("warns, never blocks, on window, past date, branch and arrival order (rules 6, 7, 10)", () => {
    const late = checkAssignment(input({}, { scheduled_for: "2026-12-05" }));
    expect(late.ok).toBe(true);
    expect(codes(late).w).toEqual(["outside_window"]);
    const past = checkAssignment(input({ today: "2026-12-01" }));
    expect(codes(past).w).toEqual(["past_date"]);
    const branch = checkAssignment(input({ crew: [lead(certified, { branch_ids: ["b2"] })] }));
    expect(codes(branch).w).toEqual(["branch_mismatch"]);
    const order = checkAssignment(
      input({
        dayStops: [
          { id: "a", arrival_window: "afternoon", route_position: 1 },
          { id: "b", arrival_window: "morning", route_position: 2 },
        ],
      }),
    );
    expect(codes(order).w).toEqual(["window_order"]);
    const fine = checkAssignment(
      input({
        dayStops: [
          { id: "a", arrival_window: "morning", route_position: 1 },
          { id: "c", arrival_window: "any", route_position: 2 },
          { id: "b", arrival_window: "afternoon", route_position: 3 },
        ],
      }),
    );
    expect(fine.warnings).toEqual([]);
  });
});
