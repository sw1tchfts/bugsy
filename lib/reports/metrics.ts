// Retention and productivity arithmetic (spec 12 rules 1 to 5), pure and tested. Dates are business dates.
import { addDays, addMonths, endOfMonth } from "@/lib/dates";

export type AgreementFacts = { id: string; signed_on: string | null; status: string; cancelled_on: string | null; ends_on: string };

/** Rule 1: signed by then, not a draft, not cancelled by then, and its term (renewals included) not over. */
export function activeOn(a: AgreementFacts, day: string): boolean {
  if (!a.signed_on || a.status === "draft" || a.signed_on > day) return false;
  if (a.cancelled_on && a.cancelled_on <= day) return false;
  return a.ends_on >= day;
}

/** The last day an agreement was active, once it has stopped: the day before its cancellation took effect, or its
 *  term's last day once that has passed. A loss belongs to the month of this day, the month it was last active in. */
export function lastActiveDay(a: AgreementFacts, today: string): string | null {
  if (!a.signed_on || a.status === "draft") return null;
  if (a.cancelled_on) {
    // A plan cancelled the day it was signed was never active; its loss still belongs to the month it was signed in.
    const before = addDays(a.cancelled_on, -1);
    return before < a.signed_on ? a.signed_on : before;
  }
  return a.ends_on < today ? a.ends_on : null;
}

export const monthStart = (month: string) => `${month}-01`;
export const monthEnd = (month: string) => endOfMonth(monthStart(month));
export const nextMonth = (month: string) => addMonths(monthStart(month), 1).slice(0, 7);

export type Attrition = { month: string; active_at_start: number; lost: number; rate: number | null };

/** Rule 2: agreements lost in the month over those active on its first day; null with nobody to lose. */
export function attrition(agreements: readonly AgreementFacts[], month: string, today: string): Attrition {
  const start = monthStart(month);
  const end = monthEnd(month);
  const base = agreements.filter((a) => activeOn(a, start));
  const lost = base.filter((a) => {
    const at = lastActiveDay(a, today);
    return at !== null && at >= start && at <= end;
  }).length;
  return { month, active_at_start: base.length, lost, rate: base.length ? lost / base.length : null };
}

/** Rule 2: the share of agreements active on `from` still active on `to`. */
export function retention(agreements: readonly AgreementFacts[], from: string, to: string): { base: number; kept: number; rate: number | null } {
  const base = agreements.filter((a) => activeOn(a, from));
  const kept = base.filter((a) => activeOn(a, to)).length;
  return { base: base.length, kept, rate: base.length ? kept / base.length : null };
}

export type Cohort = { month: string; signed: number; retained: (number | null)[] };

/** Rule 3: agreements signed in a month; at N, the share active at the end of the Nth month after, while that has come. */
export function cohorts(agreements: readonly AgreementFacts[], fromMonth: string, toMonth: string, depth: number, today: string): Cohort[] {
  const out: Cohort[] = [];
  for (let m = fromMonth; m <= toMonth; m = nextMonth(m)) {
    const signed = agreements.filter((a) => a.signed_on && a.status !== "draft" && a.signed_on.slice(0, 7) === m);
    const retained: (number | null)[] = [];
    for (let n = 0; n <= depth; n += 1) {
      const at = endOfMonth(addMonths(monthStart(m), n));
      if (at > today || signed.length === 0) retained.push(null);
      else retained.push(signed.filter((a) => activeOn(a, at)).length / signed.length);
    }
    out.push({ month: m, signed: signed.length, retained });
  }
  return out;
}

export function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function percent(value: number | null, digits = 1): string {
  return value === null ? "no data" : `${(value * 100).toFixed(digits)}%`;
}

/** Months from `from` to `to` inclusive, as YYYY-MM. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = nextMonth(m)) out.push(m);
  return out;
}
