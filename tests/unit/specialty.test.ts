import { describe, expect, it } from "vitest";
import { billingSchedule, settlementPreview } from "@/lib/agreements/billing";
import { type PlanInput, jobStepIssues, planIssues } from "@/lib/agreements/cadence";
import { parseJobSteps } from "@/lib/agreements/cadence";
import { planVisits, regenerationPlan } from "@/lib/agreements/visits";
import { checkAssignment } from "@/lib/dispatch/checks";
import { daysBetween } from "@/lib/dates";
import { prepText } from "@/lib/messaging/templates";
import { materialCents, materialLines } from "@/lib/specialty/materials";
import { earnedByMonth, straightLineRecognized, warrantyTerms } from "@/lib/specialty/recognition";
import { type WdiReport, wdiHtml, wdiProblems } from "@/lib/specialty/wdi";
import { gapsFor } from "@/lib/tech/gaps";
import { withLocalChanges } from "@/lib/tech/local";
import type { QueuedChange, RoutePayload, RouteVisit } from "@/lib/tech/route-types";

const steps = [
  { label: "Treatment", offset_days: 0 },
  { label: "Follow-up", offset_days: 14 },
  { label: "Final follow-up", offset_days: 28, window_days: 5 },
];
const job: PlanInput = {
  cadence: "job_plan",
  cadence_rule: { steps },
  starts_on: "2027-03-01",
  term_months: 3,
  first_visit_on: "2027-03-04",
  season_start: null,
  season_end: null,
  skip_months: [],
  interior_only_months: [],
  window_days: 30,
  initial_price_cents: 65000,
  recurring_price_cents: 0,
};

describe("job plans (spec 15 rule 1)", () => {
  it("makes one visit per step on its offset from the first visit, the first at the initial price", () => {
    const visits = planVisits(job);
    expect(visits.map((v) => [v.kind, v.label, v.due_start, v.due_end, v.price_cents])).toEqual([
      ["initial", "Treatment", "2027-03-04", "2027-03-06", 65000],
      ["recurring", "Follow-up", "2027-03-18", "2027-03-20", 0],
      ["recurring", "Final follow-up", "2027-04-01", "2027-04-05", 0],
    ]);
  });

  it("refuses steps out of order, an empty plan, and a step past the term", () => {
    expect(jobStepIssues([{ label: "A", offset_days: 7 }, { label: "B", offset_days: 3 }])).toEqual(["Step 2 comes before the step above it."]);
    expect(jobStepIssues([])).toContain("A job plan has 1 to 20 steps.");
    expect(jobStepIssues([{ label: " ", offset_days: 0, window_days: 40 }])).toEqual(["Step 1 needs a label.", "Step 1's window is 1 to 30 days."]);
    expect(planIssues({ ...job, cadence_rule: { steps: [...steps, { label: "Too late", offset_days: 120 }] } }).join(" ")).toMatch(/term/);
    expect(planIssues(job)).toEqual([]);
  });

  it("reads the plan from the form, one step per line", () => {
    expect(parseJobSteps("Treatment @ 0\nFollow-up @ 14 / 3\n\n")).toEqual([
      { label: "Treatment", offset_days: 0 },
      { label: "Follow-up", offset_days: 14, window_days: 3 },
    ]);
    expect(jobStepIssues(parseJobSteps("Treatment at day zero"))).toContain("Step 1's offset is a whole number of days from the first visit.");
  });
});

describe("straight-line recognition (spec 15 rule 2)", () => {
  const fee = 29500;
  const year = daysBetween("2027-07-01", "2028-07-01");
  const sold = [{ kind: "initial", due_start: "2027-07-01", price_cents: fee }];
  const terms = warrantyTerms("2027-07-01", 12, 0, sold);

  it("earns each term's fee evenly by day from the term's start to the next term's start", () => {
    expect(terms).toEqual([{ start: "2027-07-01", end: "2028-07-01", cents: fee }]);
    const months = earnedByMonth(terms, "2027-07", "2027-10");
    expect(months.map((m) => m.month)).toEqual(["2027-07", "2027-08", "2027-09", "2027-10"]);
    expect(months[0].earned).toBe(Math.round((fee * 31) / year));
    // The running total reaches the fee exactly at the end of the term, and stays there.
    expect(straightLineRecognized(terms, "2027-06-30")).toBe(0);
    expect(straightLineRecognized(terms, "2028-06-30")).toBe(fee);
    expect(straightLineRecognized(terms, "2028-12-31")).toBe(fee);
  });

  it("earns a renewal's fee over its own term, and counts a skipped or cancelled reinspection as sold", () => {
    const renewed = warrantyTerms("2027-07-01", 12, 1, [...sold, { kind: "recurring", due_start: "2028-07-01", price_cents: 31000 }]);
    expect(renewed.map((t) => t.cents)).toEqual([fee, 31000]);
    expect(straightLineRecognized(renewed, "2028-07-01")).toBe(fee + Math.round(31000 / daysBetween("2028-07-01", "2029-07-01")));
  });

  it("is the same whatever the billing mode: twelve monthly installments earn the year's fee by the year's end", () => {
    const monthly = warrantyTerms("2026-01-01", 12, 0, Array.from({ length: 12 }, (_, i) => ({ kind: i ? "recurring" : "initial", due_start: `2026-${String(i + 1).padStart(2, "0")}-01`, price_cents: 10000 })));
    expect(straightLineRecognized(monthly, "2026-12-31")).toBe(120000);
  });

  it("settles a warranty cancelled mid-year with a refund of the unearned share of a prepaid fee", () => {
    const schedule = billingSchedule({ billing_mode: "annual_prepay", starts_on: "2027-07-01", term_months: 12 }, [
      { kind: "initial", sequence: 1, due_start: "2027-07-01", due_end: "2027-07-31", price_cents: fee, interior_only: false },
    ]);
    expect(schedule).toEqual([expect.objectContaining({ date: "2027-07-01", amount_cents: fee })]);
    // Effective 2028-01-01: earned through the day before.
    const earned = straightLineRecognized(terms, "2027-12-31");
    expect(earned).toBe(Math.round((fee * daysBetween("2027-07-01", "2028-01-01")) / year));
    const s = settlementPreview({ billedCents: fee, recognizedCents: earned });
    expect(s.refundCents).toBe(fee - earned);
    expect(s.finalInvoiceCents).toBe(0);
  });
});

describe("job plan regeneration (spec 15 rule 1)", () => {
  it("keeps every step when an edit regenerates the plan after the first visit is scheduled", () => {
    const wildlife: PlanInput = {
      ...job,
      cadence_rule: { steps: [{ label: "Set traps", offset_days: 0 }, { label: "Trap check", offset_days: 2 }, { label: "Trap check", offset_days: 4 }, { label: "Exclusion", offset_days: 7 }] },
      first_visit_on: "2027-03-01",
    };
    const planned = planVisits(wildlife);
    const existing = planned.map((v, i) => ({ id: `v${i}`, kind: v.kind, sequence: v.sequence, due_start: v.due_start, due_end: v.due_end, status: i === 0 ? "scheduled" : "planned", price_cents: v.price_cents, step_label: v.label ?? null }));
    const plan = regenerationPlan(existing, planned);
    expect(plan.keep.map((v) => v.step_label)).toEqual(["Set traps"]);
    expect(plan.insert.map((v) => v.label)).toEqual(["Trap check", "Trap check", "Exclusion"]);
  });
});

describe("materials (spec 15 rule 5)", () => {
  it("prices quantity times unit price, half up to the cent, without floating point drift", () => {
    expect(materialCents("6", 450)).toBe(2700);
    expect(materialCents("2.5", 199)).toBe(498); // 497.5 rounds up
    expect(materialCents("0.333", 100)).toBe(33); // 33.3
    expect(materialCents("1.005", 1000)).toBe(1005);
    expect(materialCents(0.1 + 0.2, 1000)).toBe(300);
  });

  it("bills only billable materials with a price", () => {
    const lines = materialLines([
      { description: "Hardware cloth", quantity: "6", unit: "sq ft", unit_price_cents: 450, billable: true },
      { description: "Bait", quantity: "1", unit: "each", unit_price_cents: 0, billable: true },
      { description: "Gloves", quantity: "2", unit: "pair", unit_price_cents: 500, billable: false },
    ]);
    expect(lines).toEqual([{ description: "Hardware cloth (6 sq ft)", amount_cents: 2700 }]);
  });
});

describe("the WDI report (spec 15 rule 7)", () => {
  const answered: WdiReport = {
    number: null,
    requested_by: "Agent <Lakeview>",
    buyer: "Carter",
    seller: "Lopez",
    structures: "House",
    inspected_areas: "Crawlspace, garage, attic",
    inaccessible_areas: "None",
    findings: {
      live_insects: { seen: false, where: "" },
      dead_insects: { seen: false, where: "" },
      damage: { seen: true, where: "Garage sill plate" },
      evidence: { seen: true, where: "Old tubes on the garage foundation" },
      previous_treatment: { seen: false, where: "" },
    },
    treatment_recommended: false,
    notes: null,
    status: "draft",
    issued_at: null,
  };
  const inspector = { name: "Sam Rivera", cert_number: "C-1042" };

  it("is ready to issue with every area and finding answered and a credentialed inspector", () => {
    expect(wdiProblems(answered, inspector)).toEqual([]);
  });

  it("names what stops it from being issued", () => {
    const problems = wdiProblems({ ...answered, inaccessible_areas: " ", findings: { ...answered.findings, damage: { seen: true, where: "" }, previous_treatment: undefined }, treatment_recommended: null }, { name: "Sam Rivera", cert_number: null });
    expect(problems).toEqual([
      "Say which areas could not be inspected (or none).",
      "Say where: visible damage.",
      "Answer: evidence of previous treatment.",
      "Say whether treatment is recommended.",
      "Sam Rivera has no credential on file for this state.",
    ]);
    expect(wdiProblems(answered, null)).toEqual(["The inspection needs an inspector on its crew."]);
    expect(wdiProblems(answered, { ...inspector, cert_expires_on: "2027-02-28" }, { today: "2027-03-04", visit_status: "completed" })).toEqual(["Sam Rivera's credential expired on 2027-02-28."]);
    expect(wdiProblems(answered, inspector, { visit_status: "scheduled" })).toEqual(["Issue the report once the inspection has started."]);
  });

  it("escapes every value in the printable report", () => {
    const html = wdiHtml({ ...answered, number: 7 }, { company: { name: "Lakeshore", legal_name: null, license: "B-1" }, property: { address: "1 <Main> St", state: "OH" }, inspected_on: "2027-03-04", issued_on: "2027-03-05", inspector: { ...inspector, license_number: null } });
    expect(html).toContain("No. 7");
    expect(html).toContain("Agent &lt;Lakeview&gt;");
    expect(html).toContain("1 &lt;Main&gt; St");
    expect(html).not.toContain("<Main>");
    expect(html).toContain("Issued 2027-03-05.");
  });
});

function routeVisit(over: Partial<RouteVisit> = {}): RouteVisit {
  return {
    id: "v1",
    sequence: 1,
    status: "in_progress",
    kind: "initial",
    job_kind: "bed_bug_treatment",
    treatment_areas: ["interior"],
    due_start: "2027-03-04",
    due_end: "2027-03-06",
    scheduled_for: "2027-03-04",
    route_position: 1,
    arrival_window: "any",
    interior_only: false,
    reservice_reason: null,
    dispatch_notes: null,
    price_cents: 65000,
    billing_mode: "per_visit",
    agreement_number: 12,
    account: { id: "a", name: "Harbor View", phone: null },
    property: { id: "p", address: "1 HARBOR RD", city: null, state: "OH", lat: null, lng: null, access_notes: null },
    service_type: { id: "st", name: "Bed bug treatment" },
    crew: [],
    state_rule: null,
    required_fields: [],
    site: null,
    specialty: { step_label: "Treatment", prep_checklist: ["Bag the bedding"], prep_check: null, wildlife: false, authorized: false, captures: [], materials: [] },
    captured: { arrived_at: "2027-03-04T14:00:00Z", departed_at: null, completed_at: null, conditions: null, areas_treated: [], target_pests: [], products: [], notes: [], photos: [], signature: null, device_checks: [] },
    ...over,
  };
}

describe("prep checks at the door (spec 15 rule 6)", () => {
  const route = { products: [] } as unknown as RoutePayload;
  const change = (payload: QueuedChange["payload"], id = "c1"): QueuedChange => ({ id, visit_id: "v1", created_at: "2027-03-04T14:10:00Z", payload, status: "pending", error: null, gaps: null });

  it("asks for a prep check before completion when the service type has a checklist, and not otherwise", () => {
    expect(gapsFor(routeVisit())).toContain("prep");
    const checked = withLocalChanges(route, routeVisit(), [change({ kind: "prep_check", ready: false, missing: ["Bag the bedding"], notes: null, at: "2027-03-04T14:10:00Z" })]);
    expect(checked.specialty?.prep_check).toMatchObject({ ready: false, missing: ["Bag the bedding"] });
    expect(gapsFor(checked)).not.toContain("prep");
    expect(gapsFor(routeVisit({ specialty: { ...routeVisit().specialty!, prep_checklist: [] } }))).not.toContain("prep");
  });

  it("shows captures and materials queued on the phone before they sync", () => {
    const v = withLocalChanges(route, routeVisit(), [
      change({ kind: "capture", species: "Raccoon", count: 2, disposition: "relocated", location: "Attic", notes: null, at: "2027-03-04T14:11:00Z" }, "c2"),
      change({ kind: "material", description: "Hardware cloth", quantity: "6", unit: "sq ft", unit_price_cents: 450, billable: true, at: "2027-03-04T14:12:00Z" }, "c3"),
    ]);
    expect(v.specialty?.captures.map((c) => [c.species, c.count])).toEqual([["Raccoon", 2]]);
    expect(v.specialty?.materials.map((m) => m.description)).toEqual(["Hardware cloth"]);
  });

  it("puts the checklist in the reminder as one sentence", () => {
    expect(prepText(["Bag the bedding.", " Clear the floor ", ""])).toBe(" Before we arrive, please: Bag the bedding; Clear the floor.");
    expect(prepText(null)).toBe("");
  });
});

describe("the wildlife dispatch blocker (spec 15 rule 3)", () => {
  const input = (job_kind: string, authorization_on_file?: boolean) =>
    checkAssignment({
      visit: {
        job_kind: job_kind as never,
        treatment_areas: [],
        due_start: "2027-03-01",
        due_end: "2027-03-31",
        scheduled_for: "2027-03-04",
        arrival_window: "any",
        property_state: "ZZ",
        registry_matches: null,
        branch_id: null,
        authorization_on_file,
      },
      stateRule: { required_cert_categories: [], pack_version: null, confirmed_at: "2027-01-01T00:00:00Z" },
      crew: [{ user_id: "u", name: "Sam", role: "lead", credential: null, branch_ids: null }],
      pack: undefined,
      today: "2027-03-01",
    });

  it("refuses trapping, exclusion and repair without the owner's authorization, and names it", () => {
    for (const kind of ["trapping", "exclusion", "bat_exclusion", "repair"]) {
      const r = input(kind, false);
      expect(r.ok).toBe(false);
      expect(r.blockers.map((b) => b.code)).toContain("no_authorization");
    }
    expect(input("trapping", true).blockers.map((b) => b.code)).not.toContain("no_authorization");
    expect(input("inspection", false).blockers.map((b) => b.code)).not.toContain("no_authorization");
  });
});
