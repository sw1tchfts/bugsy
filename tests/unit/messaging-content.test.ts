import { describe, expect, it } from "vitest";
import { noticeHtml, noticeText, summaryHtml, summaryText } from "@/lib/messaging/content";
import type { RouteVisit } from "@/lib/tech/route-types";

const visit = {
  id: "v1",
  sequence: 1,
  status: "completed",
  kind: "initial",
  job_kind: "general_pest",
  treatment_areas: [],
  due_start: "2026-11-01",
  due_end: "2026-11-30",
  scheduled_for: "2026-11-02",
  route_position: 1,
  arrival_window: "any",
  interior_only: false,
  reservice_reason: null,
  dispatch_notes: null,
  price_cents: 19900,
  billing_mode: "per_visit",
  agreement_number: 7,
  account: { id: "a1", name: "Maria Lopez", phone: null },
  property: { id: "p1", address: "1234 NEIL AVE, COLUMBUS OH 43201", city: "Columbus", state: "OH", lat: null, lng: null, access_notes: null },
  service_type: { id: "s1", name: "General pest plan" },
  crew: [{ user_id: "u1", name: "Sam Rivera", role: "lead", credential: { cert_number: "OH-APP-1042", categories: ["7A"], trainee: false, cert_expires_on: null } }],
  state_rule: null,
  required_fields: [],
  captured: {
    arrived_at: "2026-11-02T14:00:00Z",
    departed_at: "2026-11-02T14:40:00Z",
    completed_at: "2026-11-02T14:40:00Z",
    conditions: { temperature_f: 58, wind_mph: 6, wind_direction: "NW", sky: "clear", captured_at: "2026-11-02T14:00:00Z", source: "manual" },
    areas_treated: ["exterior_perimeter"],
    target_pests: ["ants", "spiders"],
    products: [
      { id: "x1", product_id: "pr1", product_name: "Demand CS", epa_reg_no: "100-1066", applied_by: "u1", site_treated: "exterior_perimeter", location_description: "foundation", amount: "8", amount_unit: "fl_oz", carrier_amount: "1", carrier_unit: "gal", target_pests: ["ants"], label_check: null, recorded_at: "2026-11-02T14:10:00Z" },
    ],
    notes: [
      { id: "n1", kind: "recommendation", content: "Trim the shrubs back from the siding.", recorded_at: "2026-11-02T14:30:00Z" },
      { id: "n2", kind: "internal", content: "Dog in the yard.", recorded_at: "2026-11-02T14:31:00Z" },
    ],
    photos: [],
    signature: null,
  },
} as unknown as RouteVisit;

describe("what the summary and the notices say (spec 11 rule 8, spec 07)", () => {
  it("carries the service, times, the applicator with certification, each product with its EPA number, amount and target, conditions and recommendations", () => {
    const text = summaryText(visit, "America/New_York");
    expect(text).toContain("Service: General pest plan at 1234 NEIL AVE, COLUMBUS OH 43201");
    expect(text).toContain("Applied: Nov 2, 2026, 9:00 AM to Nov 2, 2026, 9:40 AM");
    expect(text).toContain("Applicator: Sam Rivera, certification OH-APP-1042");
    expect(text).toContain("Product: Demand CS (EPA Reg. No. 100-1066), 8 fl oz, exterior perimeter, foundation; target pests ants");
    expect(text).toContain("Conditions: 58 F, 6 mph wind, clear");
    expect(text).toContain("Recommendation: Trim the shrubs back from the siding.");
    expect(text).not.toContain("Dog in the yard");
  });

  it("escapes the HTML version and heads it with the company", () => {
    const html = summaryHtml({ ...visit, service_type: { id: "s1", name: "Pest <plan>" } } as RouteVisit, "America/New_York", { name: "Northwind & Co", phone: "614-555-0000", license: "OH-B-77", address: null });
    expect(html).toContain("<strong>Northwind &amp; Co</strong><br>Business license OH-B-77<br>614-555-0000");
    expect(html).toContain("Pest &lt;plan&gt;");
    expect(html).not.toContain("<plan>");
  });

  it("writes each notice kind, the post-application one being the summary", () => {
    expect(noticeText("post_application", { visit, timeZone: "America/New_York", propertyAddress: "x", forScheduledFor: null })).toContain("EPA Reg. No. 100-1066");
    expect(noticeText("registry_advance", { visit: null, timeZone: "UTC", propertyAddress: "12 Oak St", forScheduledFor: "2026-11-05" })).toContain("near 12 Oak St on 2026-11-05");
    expect(noticeHtml("Title\n\nline one\nline two", { name: "Co", phone: null, license: null, address: null })).toBe("<header><strong>Co</strong></header><h2>Title</h2><ul><li>line one</li><li>line two</li></ul>");
  });
});
