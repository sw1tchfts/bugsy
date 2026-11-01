// Cadences and due windows. Pure: strings in, strings out, no database and no clock.
import { addDays, addMonths, daysBetween, endOfMonth, maxIso, minIso, monthOf, startOfMonth } from "@/lib/dates";

export const CADENCES = ["monthly", "bimonthly", "quarterly", "custom", "seasonal_rounds", "job_plan"] as const;
export type Cadence = (typeof CADENCES)[number];

export const CADENCE_LABELS: Record<Cadence, string> = {
  monthly: "Monthly",
  bimonthly: "Every other month",
  quarterly: "Quarterly",
  custom: "Custom interval",
  seasonal_rounds: "Seasonal rounds",
  job_plan: "Job plan (set visits)",
};

export const BILLING_MODES = ["per_visit", "flat_monthly", "annual_prepay"] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

export const BILLING_MODE_LABELS: Record<BillingMode, string> = {
  per_visit: "Per visit",
  flat_monthly: "Flat monthly",
  annual_prepay: "Annual prepay",
};

/** A job plan step (spec 15): a visit `offset_days` after the first visit, due within `window_days`. */
export type JobStep = { label: string; offset_days: number; window_days?: number };

export type CadenceRule = { every?: number; unit?: "weeks" | "months"; rounds?: number; steps?: JobStep[] };

/** A job plan from the form: one step per line, "label @ offset days / window days" (window optional). */
export function parseJobSteps(text: string): JobStep[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^(.*?)\s*@\s*(-?\d+)\s*(?:\/\s*(\d+))?\s*$/.exec(line);
      if (!m) return { label: line, offset_days: Number.NaN };
      return { label: m[1].trim(), offset_days: Number(m[2]), ...(m[3] ? { window_days: Number(m[3]) } : {}) };
    });
}

export function formatJobSteps(steps: readonly JobStep[] | undefined | null): string {
  return (steps ?? []).map((s) => `${s.label} @ ${s.offset_days}${s.window_days ? ` / ${s.window_days}` : ""}`).join("\n");
}

/** Spec 15 rule 1: problems with a job plan's steps; empty when sound. */
export function jobStepIssues(steps: readonly JobStep[] | undefined): string[] {
  const list = steps ?? [];
  const issues: string[] = [];
  if (list.length < 1 || list.length > 20) issues.push("A job plan has 1 to 20 steps.");
  let last = -1;
  for (const [i, step] of list.entries()) {
    if (!String(step.label ?? "").trim()) issues.push(`Step ${i + 1} needs a label.`);
    if (!Number.isInteger(step.offset_days) || step.offset_days < 0) issues.push(`Step ${i + 1}'s offset is a whole number of days from the first visit.`);
    else if (step.offset_days < last) issues.push(`Step ${i + 1} comes before the step above it.`);
    else last = step.offset_days;
    if (step.window_days !== undefined && !(Number.isInteger(step.window_days) && step.window_days >= 1 && step.window_days <= 30)) issues.push(`Step ${i + 1}'s window is 1 to 30 days.`);
  }
  return issues;
}

export type PlanInput = {
  cadence: Cadence;
  cadence_rule: CadenceRule | null;
  /** First day of the term. */
  starts_on: string;
  term_months: number;
  /** Start of the initial visit's due window; the term start when null. */
  first_visit_on: string | null;
  season_start: string | null;
  season_end: string | null;
  /** Calendar months (1 to 12) with no visit. */
  skip_months: readonly number[];
  /** Calendar months (1 to 12) where the visit is interior only. */
  interior_only_months: readonly number[];
  /** Window length in days for weekly cadences. */
  window_days: number;
  initial_price_cents: number;
  recurring_price_cents: number;
  /** How many terms have been added by renewal; 0 for the first term. */
  renewals?: number;
};

export type DueWindow = {
  /** The cadence step date the window was built from. */
  step: string;
  due_start: string;
  due_end: string;
  interior_only: boolean;
  /** True when the step falls in a skipped month; skipped windows carry no visit. */
  skipped: boolean;
  /** The job plan step's label (spec 15). */
  label?: string;
};

/** Last day of the term, including renewals. */
export function endsOn(input: Pick<PlanInput, "starts_on" | "term_months" | "renewals">): string {
  return addDays(addMonths(input.starts_on, input.term_months * (1 + (input.renewals ?? 0))), -1);
}

function monthsPerStep(input: PlanInput): number | null {
  switch (input.cadence) {
    case "monthly":
      return 1;
    case "bimonthly":
      return 2;
    case "quarterly":
      return 3;
    case "custom":
      return input.cadence_rule?.unit === "months" ? Math.max(1, Math.floor(input.cadence_rule.every ?? 1)) : null;
    default:
      return null;
  }
}

/** Problems that make a plan impossible; empty when the input is sound. */
export function planIssues(input: PlanInput): string[] {
  const issues: string[] = [];
  const first = input.first_visit_on ?? input.starts_on;
  if (first < input.starts_on) issues.push("The first visit cannot be before the agreement starts.");
  if (first > endsOn(input)) issues.push("The first visit falls after the term ends.");
  if (input.skip_months.includes(monthOf(first)) && input.cadence !== "seasonal_rounds" && input.cadence !== "job_plan") issues.push("The first visit falls in a skipped month; pick another first visit date.");
  if (input.cadence === "custom") {
    const every = input.cadence_rule?.every ?? 0;
    if (!(every >= 1) || !["weeks", "months"].includes(input.cadence_rule?.unit ?? "")) issues.push("A custom cadence needs an interval in weeks or months.");
  }
  if (input.cadence === "job_plan") {
    issues.push(...jobStepIssues(input.cadence_rule?.steps));
    const steps = input.cadence_rule?.steps ?? [];
    const lastOffset = steps.length ? Math.max(...steps.map((s) => Number(s.offset_days) || 0)) : 0;
    if (addDays(first, lastOffset) > endsOn(input)) issues.push("The job plan's last step falls after the term ends; lengthen the term.");
  }
  if (input.cadence === "seasonal_rounds") {
    const rounds = input.cadence_rule?.rounds ?? 0;
    if (!(rounds >= 1)) issues.push("A seasonal program needs its number of rounds.");
    if (!input.season_start || !input.season_end) issues.push("A seasonal program needs a season start and end.");
    else if (input.season_end < input.season_start) issues.push("The season ends before it starts.");
  }
  if (input.term_months < 1) issues.push("The term must be at least one month.");
  if (input.initial_price_cents < 0 || input.recurring_price_cents < 0) issues.push("Prices cannot be negative.");
  return issues;
}

/**
 * Every cadence step in the term with its due window. Monthly-style cadences are due any day in the step's calendar
 * month (the initial visit from its own date); weekly cadences are due within `window_days` of the step; seasonal
 * rounds split the season into equal spans. Windows are clipped to the term. Skipped months are returned flagged so
 * callers can show them; `planVisits` drops them.
 */
export function cadenceSteps(input: PlanInput): DueWindow[] {
  const ends = endsOn(input);
  const first = input.first_visit_on ?? input.starts_on;
  const windows: DueWindow[] = [];
  const flag = (step: string, due_start: string, due_end: string): DueWindow => ({
    step,
    due_start,
    due_end,
    interior_only: input.interior_only_months.includes(monthOf(step)),
    skipped: input.skip_months.includes(monthOf(step)),
  });

  if (input.cadence === "job_plan") {
    // One window per step, from the first visit date plus the step's offset; skip months do not apply to a job.
    for (const step of input.cadence_rule?.steps ?? []) {
      const dueStart = addDays(first, step.offset_days);
      if (dueStart > ends) continue;
      windows.push({ step: dueStart, due_start: dueStart, due_end: minIso(addDays(dueStart, (step.window_days ?? 3) - 1), ends), interior_only: false, skipped: false, label: step.label.trim() });
    }
    return windows;
  }

  if (input.cadence === "seasonal_rounds") {
    const rounds = Math.max(1, Math.floor(input.cadence_rule?.rounds ?? 1));
    const terms = 1 + (input.renewals ?? 0);
    for (let term = 0; term < terms; term++) {
      const seasonStart = addMonths(input.season_start ?? input.starts_on, 12 * term);
      const seasonEnd = addMonths(input.season_end ?? ends, 12 * term);
      const span = (daysBetween(seasonStart, seasonEnd) + 1) / rounds;
      for (let r = 0; r < rounds; r++) {
        const dueStart = addDays(seasonStart, Math.floor(r * span));
        const dueEnd = r === rounds - 1 ? seasonEnd : addDays(seasonStart, Math.floor((r + 1) * span) - 1);
        if (dueStart > ends || dueEnd < input.starts_on) continue;
        windows.push(flag(dueStart, maxIso(dueStart, input.starts_on), minIso(dueEnd, ends)));
      }
    }
    return windows;
  }

  const months = monthsPerStep(input);
  if (months !== null) {
    for (let i = 0; ; i++) {
      const step = addMonths(first, i * months);
      if (step > ends) break;
      const dueStart = i === 0 ? step : maxIso(startOfMonth(step), input.starts_on);
      windows.push(flag(step, dueStart, minIso(endOfMonth(step), ends)));
    }
    return windows;
  }

  // Custom weekly cadence.
  const stepDays = Math.max(1, Math.floor(input.cadence_rule?.every ?? 1)) * 7;
  const windowDays = Math.max(1, input.window_days || 7);
  for (let i = 0; ; i++) {
    const step = addDays(first, i * stepDays);
    if (step > ends) break;
    windows.push(flag(step, step, minIso(addDays(step, windowDays - 1), ends)));
  }
  return windows;
}
