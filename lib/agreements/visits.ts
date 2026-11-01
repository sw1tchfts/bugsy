// The visit plan an agreement promises, and how to regenerate it without touching work already scheduled or done.
import { type PlanInput, cadenceSteps, planIssues } from "@/lib/agreements/cadence";

export type PlannedVisit = {
  kind: "initial" | "recurring";
  sequence: number;
  due_start: string;
  due_end: string;
  price_cents: number;
  interior_only: boolean;
};

/** The visits for the whole term: the first window is the initial visit, the rest recur; skipped months carry none. */
export function planVisits(input: PlanInput): PlannedVisit[] {
  const issues = planIssues(input);
  if (issues.length) throw new Error(issues.join(" "));
  const windows = cadenceSteps(input).filter((w) => !w.skipped);
  return windows.map((w, i) => ({
    kind: i === 0 ? "initial" : "recurring",
    sequence: i + 1,
    due_start: w.due_start,
    due_end: w.due_end,
    price_cents: i === 0 ? input.initial_price_cents : input.recurring_price_cents,
    interior_only: w.interior_only,
  }));
}

export function contractTotalCents(visits: readonly { price_cents: number | string | bigint }[]): number {
  return visits.reduce((sum, v) => sum + Number(v.price_cents), 0);
}

export type ExistingVisit = {
  id: string;
  kind: string;
  sequence: number;
  due_start: string;
  due_end: string;
  status: string;
  price_cents: number | string | bigint;
  /** Done before Bugsy (spec 10). */
  imported?: boolean;
};

export type RegenerationPlan = {
  /** Planned visits to delete. */
  remove: string[];
  /** Visits that stay exactly as they are. */
  keep: ExistingVisit[];
  /** New planned visits, with sequence numbers continuing after the kept ones. */
  insert: PlannedVisit[];
};

function overlaps(a: { due_start: string; due_end: string }, b: { due_start: string; due_end: string }): boolean {
  return a.due_start <= b.due_end && a.due_end >= b.due_start;
}

/**
 * Rule 6: only `planned` visits move. Scheduled, started, completed, skipped and cancelled visits stay, re-services
 * always stay, a kept initial visit means the new plan adds no second one, and a new window that overlaps a kept
 * visit's window is not inserted.
 */
export function regenerationPlan(existing: readonly ExistingVisit[], planned: readonly PlannedVisit[]): RegenerationPlan {
  const keep = existing.filter((v) => v.status !== "planned" || v.kind === "reservice");
  const remove = existing.filter((v) => v.status === "planned" && v.kind !== "reservice").map((v) => v.id);
  const anchors = keep.filter((v) => v.kind !== "reservice" && v.status !== "cancelled" && v.status !== "skipped");
  const hasInitial = anchors.some((v) => v.kind === "initial");
  let sequence = existing.reduce((max, v) => Math.max(max, v.sequence), 0);
  const insert: PlannedVisit[] = [];
  for (const visit of planned) {
    if (visit.kind === "initial" && hasInitial) continue;
    if (anchors.some((a) => overlaps(a, visit))) continue;
    sequence += 1;
    insert.push({ ...visit, sequence });
  }
  return { remove, keep, insert };
}
