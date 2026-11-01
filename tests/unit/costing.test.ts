import { describe, expect, it } from "vitest";
import { groupJobs, jobCost, type JobInput } from "@/lib/costing/jobs";

const base: JobInput = {
  visit_id: "v1",
  completed_on: "2026-10-20",
  account_id: "a1",
  account_name: "Maria Lopez",
  technician_id: "t1",
  technician_name: "Sam Rivera",
  service_line: "general_pest",
  service_name: "General pest plan",
  revenue_cents: 12900,
  product_cost_cents: 400,
  unpriced_products: 0,
  arrived_at: "2026-10-20T14:00:00Z",
  departed_at: "2026-10-20T14:45:00Z",
  crew: [{ user_id: "t1", name: "Sam Rivera", cost_cents_per_hour: 3200 }],
};

describe("job costing (spec 18 rule 8)", () => {
  it("takes the price, the product used and each crew member's time on site", () => {
    const j = jobCost(base);
    expect(j).toMatchObject({ on_site_hours: 0.75, labor_cents: 2400, margin_cents: 12900 - 400 - 2400, margin_pct: 78.3 });
  });

  it("costs a re-service with no revenue, and leaves unpriced labor unpriced", () => {
    const j = jobCost({ ...base, revenue_cents: 0, crew: [...base.crew, { user_id: "h", name: "Helper", cost_cents_per_hour: null }] });
    expect(j).toMatchObject({ labor_cents: 2400, unpriced_labor: 1, margin_cents: -2800, margin_pct: null });
  });

  it("groups by technician and route day", () => {
    const jobs = [jobCost(base), jobCost({ ...base, visit_id: "v2", account_id: "a2", account_name: "Oakwood", revenue_cents: 20000, completed_on: "2026-10-21" })];
    expect(groupJobs(jobs, "technician")).toMatchObject([{ key: "t1", visits: 2, revenue_cents: 32900, labor_cents: 4800 }]);
    expect(groupJobs(jobs, "route").map((r) => r.label)).toEqual(["2026-10-21 Sam Rivera", "2026-10-20 Sam Rivera"]);
  });
});
