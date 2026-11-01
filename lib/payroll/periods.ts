// Pay periods, hours and pay (spec 18 rules 9 to 13), pure. Bugsy reports hours and pay due for the payroll provider;
// it does not compute overtime, minimum wage or taxes.
import { addDays, fromTenantLocal } from "@/lib/dates";

export const PERIOD_KINDS = ["weekly", "biweekly", "semimonthly"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];
export const PAY_KINDS = ["hourly", "production", "salary"] as const;
export type PayKind = (typeof PAY_KINDS)[number];

export type PaySettings = { period: PeriodKind; anchor_on: string };
export type Period = { starts_on: string; ends_on: string };

const DAY = 86_400_000;
const dayNumber = (iso: string) => Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY);
const lastOfMonth = (iso: string) => {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0));
  return d.toISOString().slice(0, 10);
};

/** Rule 9: the period a business day falls in. */
export function periodFor(settings: PaySettings, day: string): Period {
  if (settings.period === "semimonthly") {
    const month = day.slice(0, 7);
    return Number(day.slice(8, 10)) <= 15 ? { starts_on: `${month}-01`, ends_on: `${month}-15` } : { starts_on: `${month}-16`, ends_on: lastOfMonth(day) };
  }
  const length = settings.period === "weekly" ? 7 : 14;
  const offset = (((dayNumber(day) - dayNumber(settings.anchor_on)) % length) + length) % length;
  const starts_on = addDays(day, -offset);
  return { starts_on, ends_on: addDays(starts_on, length - 1) };
}

/** The latest period whose last day has passed: the one an export can take today (rule 9). */
export function lastClosedPeriod(settings: PaySettings, today: string): Period {
  const current = periodFor(settings, today);
  return periodFor(settings, addDays(current.starts_on, -1));
}

export function periodClosed(period: Period, today: string): boolean {
  return period.ends_on < today;
}

/** Rule 10: the workweek starts on the anchor's weekday. */
export function workweekStart(anchorOn: string, day: string): string {
  const offset = (((dayNumber(day) - dayNumber(anchorOn)) % 7) + 7) % 7;
  return addDays(day, -offset);
}

export type Entry = { started_at: Date | string; ended_at: Date | string | null };

const hours = (ms: number) => Math.round((ms / 3_600_000) * 100) / 100;

/**
 * Rule 10: hours of closed entries inside the period, in the company's time zone, totaled and by workweek. An entry
 * that crosses the period's edge counts only its inside part; one that crosses midnight into a new workweek splits.
 */
export function hoursInPeriod(entries: readonly Entry[], period: Period, timeZone: string, anchorOn: string): { total: number; byWeek: Record<string, number> } {
  const start = fromTenantLocal(`${period.starts_on}T00:00`, timeZone) as Date;
  const end = fromTenantLocal(`${addDays(period.ends_on, 1)}T00:00`, timeZone) as Date;
  const weeks: { from: number; to: number; key: string }[] = [];
  for (let w = workweekStart(anchorOn, period.starts_on); w <= period.ends_on; w = addDays(w, 7)) {
    const from = Math.max((fromTenantLocal(`${w}T00:00`, timeZone) as Date).getTime(), start.getTime());
    const to = Math.min((fromTenantLocal(`${addDays(w, 7)}T00:00`, timeZone) as Date).getTime(), end.getTime());
    if (to > from) weeks.push({ from, to, key: w < period.starts_on ? period.starts_on : w });
  }
  const byWeekMs = new Map<string, number>();
  let totalMs = 0;
  for (const e of entries) {
    if (!e.ended_at) continue;
    const a = new Date(e.started_at).getTime();
    const b = new Date(e.ended_at).getTime();
    if (!(b > a)) continue;
    for (const w of weeks) {
      const ms = Math.min(b, w.to) - Math.max(a, w.from);
      if (ms > 0) {
        byWeekMs.set(w.key, (byWeekMs.get(w.key) ?? 0) + ms);
        totalMs += ms;
      }
    }
  }
  return { total: hours(totalMs), byWeek: Object.fromEntries([...byWeekMs.entries()].map(([k, v]) => [k, hours(v)])) };
}

/** Rule 11: a visit's price split equally among the people who did it, down to the cent, the remainder to the lead. */
export function crewSplit(priceCents: number, people: readonly string[], lead: string | null): Map<string, number> {
  const unique = [...new Set(people.concat(lead ? [lead] : []))];
  const out = new Map<string, number>();
  if (unique.length === 0 || priceCents <= 0) return out;
  const share = Math.floor(priceCents / unique.length);
  for (const p of unique) out.set(p, share);
  const first = lead && out.has(lead) ? lead : unique[0];
  out.set(first, (out.get(first) ?? 0) + (priceCents - share * unique.length));
  return out;
}

/** A rate as an integer of thousandths of a percent, so the product stays exact before the one rounding (half up). */
export function percentOf(cents: number, percent: number | string | null): number {
  const thousandths = Math.round(Number(percent ?? 0) * 1000);
  return Math.floor((cents * thousandths + 50_000) / 100_000);
}

export type Rate = { kind: PayKind; hourly_rate_cents: number | null; production_percent: number | string | null; draw_cents: number | null; salary_cents: number | null };

/** Rule 11: what the period pays a person before the payroll provider's math. */
export function payDue(rate: Rate | null, worked: number, productionRevenueCents: number): { production_pay_cents: number; pay_due_cents: number | null } {
  if (!rate) return { production_pay_cents: 0, pay_due_cents: null };
  if (rate.kind === "production") {
    const production = percentOf(productionRevenueCents, rate.production_percent);
    return { production_pay_cents: production, pay_due_cents: Math.max(production, rate.draw_cents ?? 0) };
  }
  if (rate.kind === "salary") return { production_pay_cents: 0, pay_due_cents: rate.salary_cents ?? 0 };
  return { production_pay_cents: 0, pay_due_cents: Math.round(worked * (rate.hourly_rate_cents ?? 0) + 1e-6) };
}

export type ExportLine = {
  payroll_id: string | null;
  name: string;
  email: string;
  kind: PayKind | null;
  hours: number;
  hours_by_week: Record<string, number>;
  hourly_rate_cents: number | null;
  production_revenue_cents: number;
  production_percent: string | null;
  production_pay_cents: number;
  draw_cents: number | null;
  salary_cents: number | null;
  pay_due_cents: number | null;
  commissions_cents: number;
};

const money = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));
const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The file for the payroll provider: one row per person, money in dollars with cents, hours to the hundredth. */
export function exportCsv(period: Period, lines: readonly ExportLine[]): string {
  const weeks = [...new Set(lines.flatMap((l) => Object.keys(l.hours_by_week)))].sort();
  const head = ["period_start", "period_end", "payroll_id", "name", "email", "pay_kind", "hours", ...weeks.map((w) => `hours_week_of_${w}`), "hourly_rate", "production_revenue", "production_percent", "production_pay", "draw", "salary", "pay_due", "commissions"];
  const rows = lines.map((l) =>
    [
      period.starts_on,
      period.ends_on,
      l.payroll_id ?? "",
      l.name,
      l.email,
      l.kind ?? "",
      l.hours.toFixed(2),
      ...weeks.map((w) => (l.hours_by_week[w] ?? 0).toFixed(2)),
      money(l.hourly_rate_cents),
      money(l.production_revenue_cents),
      l.production_percent ?? "",
      money(l.production_pay_cents),
      money(l.draw_cents),
      money(l.salary_cents),
      money(l.pay_due_cents),
      money(l.commissions_cents),
    ].map((v) => cell(String(v))),
  );
  return [head.join(","), ...rows.map((r) => r.join(","))].join("\r\n") + "\r\n";
}

export type Register = { gross_wages_cents: number; employer_taxes_cents: number; withholdings_cents: number; net_pay_cents: number; commissions_cents: number };

/** Rule 13: what makes a register's totals postable. */
export function registerProblems(r: Register, exportedCommissionsCents: number): string[] {
  const p: string[] = [];
  for (const [k, v] of Object.entries(r)) if (!Number.isInteger(v) || v < 0) p.push(`${k.replace(/_cents$/, "").replace(/_/g, " ")} is a whole number of cents, zero or more`);
  if (r.gross_wages_cents !== r.net_pay_cents + r.withholdings_cents) p.push("gross wages must equal net pay plus withholdings");
  if (r.commissions_cents !== exportedCommissionsCents) p.push("the commissions paid must be the export's commissions");
  if (r.commissions_cents > r.gross_wages_cents) p.push("commissions are part of gross wages");
  return p;
}
