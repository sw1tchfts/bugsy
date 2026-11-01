// The time clock and payroll's database work (spec 18 rules 6, 7 and 9 to 13), on the caller's connection.
import type postgres from "postgres";
import { dateInZone, todayInZone } from "@/lib/dates";
import { postEntry } from "@/lib/ledger/db";
import { payrollLines } from "@/lib/ledger/post";
import { payCommissions } from "@/lib/sales/db";
import { type ExportLine, type PaySettings, type Period, type Rate, crewSplit, exportCsv, hoursInPeriod, payDue, periodClosed, registerProblems, type Register } from "./periods";

type Sql = postgres.Sql | postgres.TransactionSql;

const fail = (message: string, code = "23514"): never => {
  throw Object.assign(new Error(message), { code });
};

export type TimeEntry = { id: string; user_id: string; name: string | null; started_at: Date; ended_at: Date | null; source: string; note: string | null; edit_reason: string | null; edited_at: Date | null; pay_period_id: string | null };

export async function openEntry(tx: Sql, tenantId: string, userId: string): Promise<{ id: string; started_at: Date } | null> {
  const [row] = await tx<{ id: string; started_at: Date }[]>`select id, started_at from public.time_entries where tenant_id = ${tenantId} and user_id = ${userId} and ended_at is null`;
  return row ?? null;
}

/** Rule 6: clock in opens the person's one entry; clock out closes it, after its start. */
export async function clock(tx: Sql, tenantId: string, userId: string, direction: "in" | "out", at: Date, source: "app" | "office"): Promise<string> {
  const open = await openEntry(tx, tenantId, userId);
  if (direction === "in") {
    if (open) fail("You are already clocked in.");
    const [row] = await tx<{ id: string }[]>`
      insert into public.time_entries (tenant_id, user_id, started_at, source) values (${tenantId}, ${userId}, ${at}, ${source}) returning id`;
    return row.id;
  }
  if (!open) fail("You are not clocked in.");
  if (at.getTime() <= open!.started_at.getTime()) fail("A clock-out comes after its clock-in.");
  await tx`update public.time_entries set ended_at = ${at} where id = ${open!.id}`;
  return open!.id;
}

export async function entriesBetween(tx: Sql, tenantId: string, from: Date, to: Date, userId?: string | null): Promise<TimeEntry[]> {
  return tx<TimeEntry[]>`
    select e.id, e.user_id, m.display_name as name, e.started_at, e.ended_at, e.source, e.note, e.edit_reason, e.edited_at, e.pay_period_id
    from public.time_entries e left join public.memberships m on m.tenant_id = e.tenant_id and m.user_id = e.user_id
    where e.tenant_id = ${tenantId} and e.started_at < ${to} and coalesce(e.ended_at, 'infinity'::timestamptz) > ${from}
      and (${userId ?? null}::uuid is null or e.user_id = ${userId ?? null}::uuid)
    order by e.started_at desc`;
}

/** Rule 6: entries left open more than 16 hours, for the office to close. */
export async function longOpen(tx: Sql, tenantId: string, now: Date): Promise<TimeEntry[]> {
  return tx<TimeEntry[]>`
    select e.id, e.user_id, m.display_name as name, e.started_at, e.ended_at, e.source, e.note, e.edit_reason, e.edited_at, e.pay_period_id
    from public.time_entries e left join public.memberships m on m.tenant_id = e.tenant_id and m.user_id = e.user_id
    where e.tenant_id = ${tenantId} and e.ended_at is null and e.started_at < ${new Date(now.getTime() - 16 * 3_600_000)} order by e.started_at`;
}

/** Rule 7: the office's correction, with its reason; the audit log keeps the original. */
export async function correctEntry(tx: Sql, tenantId: string, input: { id: string; started_at: Date; ended_at: Date | null; reason: string }): Promise<void> {
  if (!input.reason.trim()) fail("Say why the time changes.");
  if (input.ended_at && input.ended_at.getTime() <= input.started_at.getTime()) fail("The end comes after the start.");
  const r = await tx`update public.time_entries set started_at = ${input.started_at}, ended_at = ${input.ended_at}, edit_reason = ${input.reason.trim()} where id = ${input.id} and tenant_id = ${tenantId}`;
  if (r.count === 0) fail("That entry is not here.");
}

export async function addEntry(tx: Sql, tenantId: string, input: { user_id: string; started_at: Date; ended_at: Date; reason: string }): Promise<void> {
  if (!input.reason.trim()) fail("Say why the time is added.");
  if (input.ended_at.getTime() <= input.started_at.getTime()) fail("The end comes after the start.");
  await tx`insert into public.time_entries (tenant_id, user_id, started_at, ended_at, source, edit_reason)
           values (${tenantId}, ${input.user_id}, ${input.started_at}, ${input.ended_at}, 'office', ${input.reason.trim()})`;
}

export async function paySettings(tx: Sql, tenantId: string): Promise<PaySettings | null> {
  const [row] = await tx<{ period: PaySettings["period"]; anchor_on: string }[]>`select period, anchor_on::text from public.pay_settings where tenant_id = ${tenantId}`;
  return row ?? null;
}

export type RateRow = Rate & { id: string; user_id: string; effective_from: string; labor_cost_cents_per_hour: number | null };

export async function payRates(tx: Sql, tenantId: string): Promise<RateRow[]> {
  const rows = await tx<(Omit<RateRow, "hourly_rate_cents" | "draw_cents" | "salary_cents" | "labor_cost_cents_per_hour"> & Record<"hourly_rate_cents" | "draw_cents" | "salary_cents" | "labor_cost_cents_per_hour", string | null>)[]>`
    select id, user_id, kind, hourly_rate_cents, production_percent::text, draw_cents, salary_cents, labor_cost_cents_per_hour, effective_from::text
    from public.pay_rates where tenant_id = ${tenantId} order by user_id, effective_from desc`;
  const n = (v: string | null) => (v === null ? null : Number(v));
  return rows.map((r) => ({ ...r, hourly_rate_cents: n(r.hourly_rate_cents), draw_cents: n(r.draw_cents), salary_cents: n(r.salary_cents), labor_cost_cents_per_hour: n(r.labor_cost_cents_per_hour) }));
}

/** Rule 11: the rate in effect on a day. */
export function rateOn(rates: readonly RateRow[], userId: string, day: string): RateRow | null {
  return rates.filter((r) => r.user_id === userId && r.effective_from <= day).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
}

/** Rules 10 to 12: one line per person with time, pay or commissions in the period. */
export async function buildExport(tx: Sql, tenantId: string, settings: PaySettings, period: Period, timeZone: string): Promise<ExportLine[]> {
  const people = await tx<{ user_id: string; name: string | null; email: string; payroll_id: string | null }[]>`
    select m.user_id, m.display_name as name, u.email, m.payroll_id from public.memberships m join auth.users u on u.id = m.user_id where m.tenant_id = ${tenantId}`;
  const from = new Date(`${period.starts_on}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${period.ends_on}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + 2);
  const entries = await tx<{ user_id: string; started_at: Date; ended_at: Date | null }[]>`
    select user_id, started_at, ended_at from public.time_entries where tenant_id = ${tenantId} and started_at < ${to} and coalesce(ended_at, 'infinity'::timestamptz) > ${from}`;
  const visits = await tx<{ id: string; price_cents: string; technician_id: string | null; completed_at: Date; crew: string[] }[]>`
    select v.id, v.price_cents, v.technician_id, v.completed_at,
           coalesce((select array_agg(c.user_id) from public.visit_crew c where c.visit_id = v.id), '{}') as crew
    from public.visits v
    where v.tenant_id = ${tenantId} and v.status = 'completed' and not v.imported and v.price_cents > 0 and v.completed_at >= ${from} and v.completed_at < ${to}`;
  const revenue = new Map<string, number>();
  for (const v of visits) {
    const day = dateInZone(v.completed_at, timeZone);
    if (day < period.starts_on || day > period.ends_on) continue;
    for (const [u, c] of crewSplit(Number(v.price_cents), v.crew, v.technician_id)) revenue.set(u, (revenue.get(u) ?? 0) + c);
  }
  const commissions = new Map(
    (
      await tx<{ user_id: string; payable: string; owed: string }[]>`
        select user_id,
               coalesce(sum(amount_cents) filter (where status = 'payable' and released_on <= ${period.ends_on}), 0)::text as payable,
               coalesce(sum(amount_cents) filter (where status = 'charged_back' and paid_on is not null and recovered_payout_id is null), 0)::text as owed
        from public.commissions where tenant_id = ${tenantId} group by user_id`
    ).map((r) => [r.user_id, Math.max(0, Number(r.payable) - Number(r.owed))]),
  );
  const rates = await payRates(tx, tenantId);
  const lines: ExportLine[] = [];
  for (const p of people) {
    const hours = hoursInPeriod(entries.filter((e) => e.user_id === p.user_id), period, timeZone, settings.anchor_on);
    const rate = rateOn(rates, p.user_id, period.ends_on);
    const production = revenue.get(p.user_id) ?? 0;
    const owedCommissions = commissions.get(p.user_id) ?? 0;
    if (hours.total === 0 && production === 0 && owedCommissions === 0 && !rate) continue;
    const pay = payDue(rate, hours.total, production);
    lines.push({
      payroll_id: p.payroll_id,
      name: p.name ?? p.email,
      email: p.email,
      kind: rate?.kind ?? null,
      hours: hours.total,
      hours_by_week: hours.byWeek,
      hourly_rate_cents: rate?.kind === "hourly" ? rate.hourly_rate_cents : null,
      production_revenue_cents: production,
      production_percent: rate?.kind === "production" && rate.production_percent !== null ? Number(rate.production_percent).toFixed(3) : null,
      production_pay_cents: pay.production_pay_cents,
      draw_cents: rate?.kind === "production" ? rate.draw_cents : null,
      salary_cents: rate?.kind === "salary" ? rate.salary_cents : null,
      pay_due_cents: pay.pay_due_cents,
      commissions_cents: owedCommissions,
    });
  }
  return lines.sort((a, b) => a.name.localeCompare(b.name));
}

/** Rule 12: the export as sent, the period's time locked, payroll-paid commissions recorded (posted by the journal). */
export async function exportPeriod(tx: Sql, tenantId: string, period: Period, timeZone: string): Promise<string> {
  const settings = await paySettings(tx, tenantId);
  if (!settings) fail("Set the pay period first.");
  if (!periodClosed(period, todayInZone(timeZone))) fail("A period exports once its last day has passed.");
  const [taken] = await tx<{ id: string }[]>`select id from public.pay_periods where tenant_id = ${tenantId} and starts_on = ${period.starts_on}`;
  if (taken) fail("This period was already exported; a correction goes in the next one.");
  const lines = await buildExport(tx, tenantId, settings!, period, timeZone);
  const people = await tx<{ user_id: string; email: string }[]>`select m.user_id, u.email from public.memberships m join auth.users u on u.id = m.user_id where m.tenant_id = ${tenantId}`;
  const userOf = new Map(people.map((p) => [p.email, p.user_id]));
  const commissions = lines.reduce((s, l) => s + l.commissions_cents, 0);
  const [pp] = await tx<{ id: string }[]>`
    insert into public.pay_periods (tenant_id, starts_on, ends_on, commissions_cents) values (${tenantId}, ${period.starts_on}, ${period.ends_on}, ${commissions}) returning id`;
  for (const l of lines) {
    const userId = userOf.get(l.email) as string;
    await tx`
      insert into public.pay_period_lines (tenant_id, pay_period_id, user_id, payroll_id, name, email, kind, hours, hours_by_week, hourly_rate_cents, production_revenue_cents,
                                           production_percent, production_pay_cents, draw_cents, salary_cents, pay_due_cents, commissions_cents)
      values (${tenantId}, ${pp.id}, ${userId}, ${l.payroll_id}, ${l.name}, ${l.email}, ${l.kind}, ${l.hours}, ${tx.json(l.hours_by_week)}, ${l.hourly_rate_cents},
              ${l.production_revenue_cents}, ${l.production_percent}, ${l.production_pay_cents}, ${l.draw_cents}, ${l.salary_cents}, ${l.pay_due_cents}, ${l.commissions_cents})`;
    if (l.commissions_cents > 0) {
      const paid = await payCommissions(tx, tenantId, userId, { paid_on: period.ends_on, method: "payroll", reference: `pay period ${period.starts_on} to ${period.ends_on}` }, { post: false, pay_period_id: pp.id, through: period.ends_on });
      if (paid.amount_cents !== l.commissions_cents) fail("The commissions changed while the export ran; export again.");
    }
  }
  // The period's closed time is fixed from now on (rule 7).
  const start = new Date(`${period.starts_on}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(`${period.ends_on}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 2);
  const closed = await tx<{ id: string; started_at: Date; ended_at: Date }[]>`
    select id, started_at, ended_at from public.time_entries where tenant_id = ${tenantId} and pay_period_id is null and ended_at is not null and started_at < ${end} and ended_at > ${start}`;
  const ids = closed.filter((e) => hoursInPeriod([e], period, timeZone, settings!.anchor_on).total > 0).map((e) => e.id);
  if (ids.length) await tx`update public.time_entries set pay_period_id = ${pp.id} where id = any(${ids}::uuid[])`;
  return pp.id;
}

export async function periodCsv(tx: Sql, tenantId: string, periodId: string): Promise<{ csv: string; period: Period } | null> {
  const [p] = await tx<{ starts_on: string; ends_on: string }[]>`select starts_on::text, ends_on::text from public.pay_periods where id = ${periodId} and tenant_id = ${tenantId}`;
  if (!p) return null;
  const rows = await tx<(Omit<ExportLine, "hours" | "hourly_rate_cents" | "production_revenue_cents" | "production_pay_cents" | "draw_cents" | "salary_cents" | "pay_due_cents" | "commissions_cents"> & Record<string, string | null>)[]>`
    select payroll_id, name, email, kind, hours::text, hours_by_week, hourly_rate_cents::text, production_revenue_cents::text, production_percent::text, production_pay_cents::text,
           draw_cents::text, salary_cents::text, pay_due_cents::text, commissions_cents::text
    from public.pay_period_lines where pay_period_id = ${periodId} order by name`;
  const n = (v: string | null) => (v === null ? null : Number(v));
  const lines: ExportLine[] = rows.map((r) => ({
    payroll_id: r.payroll_id,
    name: r.name,
    email: r.email,
    kind: r.kind,
    hours: Number(r.hours),
    hours_by_week: r.hours_by_week as unknown as Record<string, number>,
    hourly_rate_cents: n(r.hourly_rate_cents as string | null),
    production_revenue_cents: Number(r.production_revenue_cents),
    production_percent: r.production_percent as string | null,
    production_pay_cents: Number(r.production_pay_cents),
    draw_cents: n(r.draw_cents as string | null),
    salary_cents: n(r.salary_cents as string | null),
    pay_due_cents: n(r.pay_due_cents as string | null),
    commissions_cents: Number(r.commissions_cents),
  }));
  return { csv: exportCsv(p, lines), period: p };
}

/** Rule 13: the register's totals, posted once as the payroll journal. */
export async function postPayroll(tx: Sql, tenantId: string, periodId: string, register: Register, timeZone: string): Promise<string | null> {
  const [p] = await tx<{ id: string; status: string; ends_on: string; commissions_cents: string }[]>`
    select id, status, ends_on::text, commissions_cents::text from public.pay_periods where id = ${periodId} and tenant_id = ${tenantId} for update`;
  if (!p) fail("That pay period is not here.");
  if (p!.status === "posted") fail("This period's payroll is already posted.");
  const problems = registerProblems(register, Number(p!.commissions_cents));
  if (problems.length) fail(problems.join("; "));
  const postedOn = todayInZone(timeZone);
  await tx`
    update public.pay_periods set status = 'posted', gross_wages_cents = ${register.gross_wages_cents}, employer_taxes_cents = ${register.employer_taxes_cents},
           withholdings_cents = ${register.withholdings_cents}, net_pay_cents = ${register.net_pay_cents}, posted_on = ${postedOn}, posted_by = auth.uid()
    where id = ${periodId}`;
  return postEntry(tx, tenantId, {
    source_type: "payroll",
    source_key: `payroll:${periodId}`,
    source_id: periodId,
    posted_on: postedOn,
    memo: `Payroll for ${p!.ends_on}`,
    lines: payrollLines(register),
  });
}
