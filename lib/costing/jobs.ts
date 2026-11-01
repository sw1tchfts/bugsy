// Job costing (spec 18 rule 8), pure: a completed visit's revenue, product and labor cost and margin, and the groups the
// report shows. A management view: labor posts to the ledger through the payroll journal, never per visit.

export type CrewTime = { user_id: string; name: string; cost_cents_per_hour: number | null };

export type JobInput = {
  visit_id: string;
  completed_on: string;
  account_id: string;
  account_name: string;
  technician_id: string | null;
  technician_name: string;
  service_line: string;
  service_name: string;
  revenue_cents: number;
  product_cost_cents: number;
  /** Product used whose cost is not known (no cost, or units that do not convert). */
  unpriced_products: number;
  arrived_at: Date | string | null;
  departed_at: Date | string | null;
  crew: readonly CrewTime[];
};

export type JobCost = JobInput & {
  on_site_hours: number;
  labor_cents: number;
  /** People on the crew without a labor cost: their labor is not priced, not zero. */
  unpriced_labor: number;
  margin_cents: number;
  margin_pct: number | null;
};

export function onSiteHours(arrived: Date | string | null, departed: Date | string | null): number {
  if (!arrived || !departed) return 0;
  const ms = new Date(departed).getTime() - new Date(arrived).getTime();
  return ms > 0 ? Math.round((ms / 3_600_000) * 100) / 100 : 0;
}

export function jobCost(input: JobInput): JobCost {
  const hours = onSiteHours(input.arrived_at, input.departed_at);
  const ms = input.arrived_at && input.departed_at ? Math.max(0, new Date(input.departed_at).getTime() - new Date(input.arrived_at).getTime()) : 0;
  let labor = 0;
  let unpriced = 0;
  for (const c of input.crew) {
    if (c.cost_cents_per_hour === null) unpriced += 1;
    else labor += Math.round((ms / 3_600_000) * c.cost_cents_per_hour + 1e-6);
  }
  const margin = input.revenue_cents - input.product_cost_cents - labor;
  return {
    ...input,
    on_site_hours: hours,
    labor_cents: labor,
    unpriced_labor: unpriced,
    margin_cents: margin,
    margin_pct: input.revenue_cents > 0 ? Math.round((margin / input.revenue_cents) * 1000) / 10 : null,
  };
}

export const GROUPS = ["visit", "account", "technician", "route", "service_line"] as const;
export type Group = (typeof GROUPS)[number];
export const GROUP_LABELS: Record<Group, string> = { visit: "Visit", account: "Account", technician: "Technician", route: "Route day", service_line: "Service line" };

export type GroupRow = {
  key: string;
  label: string;
  visits: number;
  revenue_cents: number;
  product_cost_cents: number;
  labor_cents: number;
  margin_cents: number;
  margin_pct: number | null;
  on_site_hours: number;
  unpriced: number;
};

function keyOf(j: JobCost, group: Group): [string, string] {
  switch (group) {
    case "visit":
      return [j.visit_id, `${j.completed_on} ${j.account_name}: ${j.service_name}`];
    case "account":
      return [j.account_id, j.account_name];
    case "technician":
      return [j.technician_id ?? "none", j.technician_name];
    case "route":
      return [`${j.technician_id ?? "none"}:${j.completed_on}`, `${j.completed_on} ${j.technician_name}`];
    case "service_line":
      return [j.service_line, j.service_line.replace(/_/g, " ")];
  }
}

/** The report's rows, largest revenue first; margin percent on revenue, none for $0 work. */
export function groupJobs(jobs: readonly JobCost[], group: Group): GroupRow[] {
  const rows = new Map<string, GroupRow>();
  for (const j of jobs) {
    const [key, label] = keyOf(j, group);
    const r = rows.get(key) ?? { key, label, visits: 0, revenue_cents: 0, product_cost_cents: 0, labor_cents: 0, margin_cents: 0, margin_pct: null, on_site_hours: 0, unpriced: 0 };
    r.visits += 1;
    r.revenue_cents += j.revenue_cents;
    r.product_cost_cents += j.product_cost_cents;
    r.labor_cents += j.labor_cents;
    r.margin_cents += j.margin_cents;
    r.on_site_hours = Math.round((r.on_site_hours + j.on_site_hours) * 100) / 100;
    r.unpriced += j.unpriced_labor + j.unpriced_products;
    rows.set(key, r);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, margin_pct: r.revenue_cents > 0 ? Math.round((r.margin_cents / r.revenue_cents) * 1000) / 10 : null }))
    .sort((a, b) => b.revenue_cents - a.revenue_cents || a.label.localeCompare(b.label));
}
