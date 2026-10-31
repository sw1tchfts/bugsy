// Reads the agreement form into columns and a plan input, with every validation message the office needs.
import { BILLING_MODES, type BillingMode, CADENCES, type Cadence, type CadenceRule, type PlanInput, planIssues } from "@/lib/agreements/cadence";
import { intOrNull, opt, str } from "@/lib/customers/forms";
import { isIsoDate } from "@/lib/dates";
import { parseDollarsToCents } from "@/lib/money";

export const AGREEMENT_STATUS_LABELS = {
  draft: "Draft",
  active: "Active",
  on_hold: "On hold",
  cancelled: "Cancelled",
  ended: "Ended",
} as const;

export const VISIT_STATUS_LABELS = {
  planned: "Planned",
  scheduled: "Scheduled",
  en_route: "En route",
  in_progress: "In progress",
  completed: "Completed",
  skipped: "Skipped",
  cancelled: "Cancelled",
} as const;

export const VISIT_KIND_LABELS = { initial: "Initial", recurring: "Recurring", reservice: "Re-service", one_time: "One-time", inspection: "Inspection" } as const;

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type AgreementColumns = {
  cadence: Cadence;
  cadence_rule: CadenceRule;
  season_start: string | null;
  season_end: string | null;
  skip_months: number[];
  interior_only_months: number[];
  initial_price_cents: number;
  recurring_price_cents: number;
  billing_mode: BillingMode;
  term_months: number;
  auto_renew: boolean;
  cancel_fee_cents: number;
  starts_on: string;
  first_visit_on: string;
  window_days: number;
  terms_text: string | null;
  notes: string | null;
};

function months(formData: FormData, key: string): number[] {
  return [...new Set(formData.getAll(key).map((v) => Number(v)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 12))].sort((a, b) => a - b);
}

function dollars(formData: FormData, key: string): number | null {
  const raw = str(formData, key);
  if (!raw) return 0;
  return parseDollarsToCents(raw);
}

/** Validates the plan fields shared by create and update. */
export function readAgreementColumns(formData: FormData): { value: AgreementColumns } | { error: string } {
  const cadence = str(formData, "cadence") as Cadence;
  if (!CADENCES.includes(cadence)) return { error: "Pick a cadence." };
  const billingMode = str(formData, "billing_mode") as BillingMode;
  if (!BILLING_MODES.includes(billingMode)) return { error: "Pick a billing mode." };
  const startsOn = str(formData, "starts_on");
  if (!isIsoDate(startsOn)) return { error: "A start date is required." };
  const firstVisitOn = opt(formData, "first_visit_on") ?? startsOn;
  if (!isIsoDate(firstVisitOn)) return { error: "The first visit date is not a date." };
  const termMonths = intOrNull(formData, "term_months") ?? 12;
  const initial = dollars(formData, "initial_price");
  const recurring = dollars(formData, "recurring_price");
  const cancelFee = dollars(formData, "cancel_fee");
  if (initial === null || recurring === null || cancelFee === null) return { error: "Prices are dollars and cents, for example 199.00." };

  const rule: CadenceRule = {};
  if (cadence === "custom") {
    rule.every = intOrNull(formData, "every") ?? 0;
    rule.unit = str(formData, "unit") === "months" ? "months" : "weeks";
  }
  if (cadence === "seasonal_rounds") rule.rounds = intOrNull(formData, "rounds") ?? 0;
  const seasonStart = cadence === "seasonal_rounds" ? opt(formData, "season_start") : null;
  const seasonEnd = cadence === "seasonal_rounds" ? opt(formData, "season_end") : null;
  if (cadence === "seasonal_rounds" && (!seasonStart || !seasonEnd || !isIsoDate(seasonStart) || !isIsoDate(seasonEnd))) return { error: "A seasonal program needs a season start and end." };

  const value: AgreementColumns = {
    cadence,
    cadence_rule: rule,
    season_start: seasonStart,
    season_end: seasonEnd,
    skip_months: months(formData, "skip_months"),
    interior_only_months: months(formData, "interior_only_months"),
    initial_price_cents: initial,
    recurring_price_cents: recurring,
    billing_mode: billingMode,
    term_months: termMonths,
    auto_renew: formData.get("auto_renew") === "true",
    cancel_fee_cents: cancelFee,
    starts_on: startsOn,
    first_visit_on: firstVisitOn,
    window_days: intOrNull(formData, "window_days") ?? (cadence === "custom" && rule.unit === "weeks" ? 7 : 30),
    terms_text: opt(formData, "terms_text"),
    notes: opt(formData, "notes"),
  };
  if (value.term_months < 1 || value.term_months > 60) return { error: "The term is between 1 and 60 months." };
  if (value.window_days < 1 || value.window_days > 90) return { error: "A due window is between 1 and 90 days." };
  const issues = planIssues(planInputFrom(value));
  if (issues.length) return { error: issues.join(" ") };
  return { value };
}

export function planInputFrom(columns: AgreementColumns, renewals = 0): PlanInput {
  return {
    cadence: columns.cadence,
    cadence_rule: columns.cadence_rule,
    starts_on: columns.starts_on,
    term_months: columns.term_months,
    first_visit_on: columns.first_visit_on,
    season_start: columns.season_start,
    season_end: columns.season_end,
    skip_months: columns.skip_months,
    interior_only_months: columns.interior_only_months,
    window_days: columns.window_days,
    initial_price_cents: columns.initial_price_cents,
    recurring_price_cents: columns.recurring_price_cents,
    renewals,
  };
}
