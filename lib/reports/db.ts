// The report queries (spec 12): the dashboard, the standard reports, saved custom reports and the export. Every
// query runs on the caller's connection, so under a member's session row level security decides what is counted.
import type postgres from "postgres";
import { can } from "@/lib/auth/permissions";
import { toCsv } from "@/lib/compliance/export";
import { addDays, addMonths, todayInZone } from "@/lib/dates";
import { contractLines } from "@/lib/ledger/db";
import { contractPositions } from "@/lib/ledger/post";
import { type Definition, buildQuery } from "./builder";
import { DATASETS, type Dataset, datasetFor } from "./datasets";
import { definitionFromJson } from "./form";
import { AGING, type AgingBucket, type AgreementFacts, type Attrition, type Cohort, activeOn, agingBucket, attrition, cohorts, lastActiveDay, monthsBetween, rate, retention } from "./metrics";

type Sql = postgres.Sql | postgres.TransactionSql;

export type AgreementRow = AgreementFacts & { service_line: string; cancel_reason: string | null; technician: string | null; account_name: string; number: number };

/** Every signed agreement with what retention needs: its dates, service line, reason, and the lead of its last stop. */
export async function agreementFacts(tx: Sql, tenantId: string, timeZone: string): Promise<AgreementRow[]> {
  return tx<AgreementRow[]>`
    select g.id, g.number, (g.signed_at at time zone ${timeZone})::date::text as signed_on, g.status, g.cancelled_on::text, g.ends_on::text,
           coalesce(st.service_line, 'not shown') as service_line, r.name as cancel_reason, coalesce(a.name, 'not shown') as account_name,
           (select coalesce(m.display_name, 'Member') from public.visits v left join public.memberships m on m.tenant_id = v.tenant_id and m.user_id = v.technician_id
            where v.agreement_id = g.id and v.status = 'completed' and not v.imported order by v.completed_at desc nulls last limit 1) as technician
    from public.agreements g left join public.service_types st on st.id = g.service_type_id left join public.accounts a on a.id = g.account_id
    left join public.cancel_reasons r on r.id = g.cancel_reason_id
    where g.tenant_id = ${tenantId} and g.signed_at is not null and g.status <> 'draft'`;
}

const lastFullMonth = (today: string) => addMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7);

export type Dashboard = {
  today: string;
  agreements: { active: number; attrition: Attrition; trend: Attrition[]; retention12: number | null; renewals30: number } | null;
  revenue: { this_month: number; last_month: number } | null;
  receivables: { open: number; past_due: number; accounts_past_due: number } | null;
  contracts: { deferred: number; unbilled: number } | null;
  visits: { completed_7: number; completed_30: number; reservices_30: number; reservice_rate: number | null; stops_per_day: number | null } | null;
  leads: { source: string; won: number; lost: number; rate: number | null }[] | null;
  compliance_tasks: number | null;
  texts_waiting: number | null;
};

async function revenueFor(tx: Sql, tenantId: string, from: string, to: string): Promise<number> {
  const [row] = await tx<{ cents: string | number }[]>`
    select coalesce(sum(l.credit_cents - l.debit_cents), 0) as cents from public.journal_lines l join public.journal_entries e on e.id = l.entry_id join public.gl_accounts g on g.id = l.gl_account_id
    where l.tenant_id = ${tenantId} and g.type = 'revenue' and e.posted_on between ${from} and ${to}`;
  return Number(row.cents);
}

/** The owner dashboard: each tile only when the member may read what it counts (rule 10). */
export async function dashboard(tx: Sql, tenantId: string, timeZone: string, permissions: readonly string[]): Promise<Dashboard> {
  const today = todayInZone(timeZone);
  const month = today.slice(0, 7);
  const out: Dashboard = { today, agreements: null, revenue: null, receivables: null, contracts: null, visits: null, leads: null, compliance_tasks: null, texts_waiting: null };
  if (can(permissions, "agreements.read")) {
    const book = await agreementFacts(tx, tenantId, timeZone);
    const last = lastFullMonth(today);
    const months = monthsBetween(addMonths(`${last}-01`, -11), `${last}-01`);
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from public.agreements where tenant_id = ${tenantId} and status = 'active' and ends_on between ${today} and ${addDays(today, 30)}`;
    out.agreements = {
      active: book.filter((a) => activeOn(a, today)).length,
      attrition: attrition(book, last, today),
      trend: months.map((m) => attrition(book, m, today)),
      retention12: retention(book, addMonths(today, -12), today).rate,
      renewals30: n,
    };
  }
  if (can(permissions, "gl.read")) {
    const prev = addMonths(`${month}-01`, -1);
    out.revenue = { this_month: await revenueFor(tx, tenantId, `${month}-01`, today), last_month: await revenueFor(tx, tenantId, prev, addDays(`${month}-01`, -1)) };
    const positions = contractPositions(await contractLines(tx, tenantId), today);
    out.contracts = { deferred: positions.reduce((s, p) => s + p.deferred_cents, 0), unbilled: positions.reduce((s, p) => s + p.asset_cents, 0) };
  }
  if (can(permissions, "billing.read")) {
    const [r] = await tx<{ open: string | number; past_due: string | number; accounts: number }[]>`
      select coalesce(sum(total_cents - paid_cents), 0) as open, coalesce(sum(total_cents - paid_cents) filter (where status = 'past_due'), 0) as past_due,
             count(distinct account_id) filter (where status = 'past_due')::int as accounts
      from public.invoices where tenant_id = ${tenantId} and kind = 'invoice' and status in ('issued', 'partially_paid', 'past_due')`;
    out.receivables = { open: Number(r.open), past_due: Number(r.past_due), accounts_past_due: r.accounts };
  }
  if (can(permissions, "visits.read")) {
    const [v] = await tx<{ c7: number; c30: number; r30: number; days: number; base30: number }[]>`
      select count(*) filter (where status = 'completed' and completed_at >= now() - interval '7 days')::int as c7,
             count(*) filter (where status = 'completed' and completed_at >= now() - interval '30 days')::int as c30,
             count(*) filter (where kind = 'reservice' and created_at >= now() - interval '30 days')::int as r30,
             count(distinct (technician_id, (completed_at at time zone ${timeZone})::date)) filter (where status = 'completed' and completed_at >= now() - interval '30 days' and technician_id is not null)::int as days,
             count(*) filter (where status = 'completed' and completed_at >= now() - interval '30 days' and kind <> 'reservice')::int as base30
      from public.visits where tenant_id = ${tenantId} and not imported`;
    out.visits = { completed_7: v.c7, completed_30: v.c30, reservices_30: v.r30, reservice_rate: rate(v.r30, v.base30), stops_per_day: v.days ? v.c30 / v.days : null };
  }
  if (can(permissions, "customers.read")) out.leads = (await salesBySource(tx, tenantId, timeZone, addDays(today, -90), today)).rows.map((r) => ({ source: r.source, won: r.won, lost: r.lost, rate: r.rate }));
  if (can(permissions, "compliance.read")) {
    const [c] = await tx<{ n: number }[]>`select count(*)::int as n from public.compliance_tasks where tenant_id = ${tenantId} and status = 'open'`;
    out.compliance_tasks = c.n;
  }
  if (can(permissions, "messages.send")) {
    const [m] = await tx<{ n: number }[]>`select count(*)::int as n from public.messages where tenant_id = ${tenantId} and direction = 'inbound' and read_at is null`;
    out.texts_waiting = m.n;
  }
  return out;
}

export type Breakdown = { key: string; lost: number };
export type RetentionReport = { months: Attrition[]; reasons: Breakdown[]; lines: Breakdown[]; technicians: Breakdown[]; cohorts: Cohort[]; retention: { base: number; kept: number; rate: number | null }; lost: (AgreementRow & { last_active: string })[] };

function tally(rows: readonly AgreementRow[], key: (r: AgreementRow) => string): Breakdown[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m.entries()].map(([k, lost]) => ({ key: k, lost })).sort((a, b) => b.lost - a.lost || a.key.localeCompare(b.key));
}

/** Retention and churn over a range (rules 2 to 4). */
export async function retentionReport(tx: Sql, tenantId: string, timeZone: string, from: string, to: string): Promise<RetentionReport> {
  const today = todayInZone(timeZone);
  const book = await agreementFacts(tx, tenantId, timeZone);
  const lost = book
    .map((a) => ({ ...a, last_active: lastActiveDay(a, today) }))
    .filter((a): a is AgreementRow & { last_active: string } => a.last_active !== null && a.last_active >= from && a.last_active <= to)
    .sort((a, b) => a.last_active.localeCompare(b.last_active));
  return {
    months: monthsBetween(from, to).map((m) => attrition(book, m, today)),
    reasons: tally(lost, (r) => r.cancel_reason ?? (r.cancelled_on ? "no reason recorded" : "ended, not renewed")),
    lines: tally(lost, (r) => r.service_line),
    technicians: tally(lost, (r) => r.technician ?? "no visit yet"),
    cohorts: cohorts(book, from.slice(0, 7), to.slice(0, 7), 12, today),
    retention: retention(book, from, to),
    lost,
  };
}

export type TechnicianRow = { technician: string; stops: number; working_days: number; stops_per_day: number | null; revenue_cents: number; minutes_on_site: number | null; product_cost_cents: number | null; base: number; reserviced: number; reservice_rate: number | null };

/** Productivity per lead technician for a range (rule 5). Product cost comes from the ledger, net of reversals, and is
 *  null for a member who cannot read the ledger rather than a zero that looks real. */
export async function technicianReport(tx: Sql, tenantId: string, timeZone: string, from: string, to: string, permissions: readonly string[]): Promise<TechnicianRow[]> {
  const rows = await tx<{ technician: string; stops: number; working_days: number; revenue: string | number; minutes: string | number | null; cost: string | number; base: number; reserviced: number }[]>`
    with done as (
      select v.id, v.agreement_id, v.technician_id, v.kind, v.price_cents, v.completed_at, v.arrived_at, v.departed_at, (v.completed_at at time zone ${timeZone})::date as day
      from public.visits v
      where v.tenant_id = ${tenantId} and v.status = 'completed' and not v.imported and v.technician_id is not null
        and (v.completed_at at time zone ${timeZone})::date between ${from} and ${to}
    )
    select coalesce(m.display_name, 'Member') as technician, count(*)::int as stops, count(distinct d.day)::int as working_days, coalesce(sum(d.price_cents), 0) as revenue,
           avg(extract(epoch from (d.departed_at - d.arrived_at)) / 60) filter (where d.arrived_at is not null and d.departed_at is not null) as minutes,
           (select coalesce(sum(l.debit_cents - l.credit_cents), 0) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id join public.gl_accounts g on g.id = l.gl_account_id
            where e.tenant_id = ${tenantId} and g.key = 'chemical_cost'
              and coalesce(e.reverses, e.id) in (select u.id from public.journal_entries u join public.visit_products vp on vp.id = u.source_id
                                                 where u.tenant_id = ${tenantId} and u.source_type = 'product_use' and vp.visit_id in (select id from done x where x.technician_id = d.technician_id))) as cost,
           count(*) filter (where d.kind <> 'reservice')::int as base,
           count(*) filter (where d.kind <> 'reservice' and exists (
             select 1 from public.visits r where r.agreement_id = d.agreement_id and r.kind = 'reservice' and r.created_at > d.completed_at and r.created_at <= d.completed_at + interval '30 days'))::int as reserviced
    from done d left join public.memberships m on m.tenant_id = ${tenantId} and m.user_id = d.technician_id
    group by d.technician_id, m.display_name order by stops desc, technician`;
  return rows.map((r) => ({
    technician: r.technician,
    stops: r.stops,
    working_days: r.working_days,
    stops_per_day: r.working_days ? r.stops / r.working_days : null,
    revenue_cents: Number(r.revenue),
    minutes_on_site: r.minutes === null ? null : Math.round(Number(r.minutes)),
    product_cost_cents: can(permissions, "gl.read") ? Number(r.cost) : null,
    base: r.base,
    reserviced: r.reserviced,
    reservice_rate: rate(r.reserviced, r.base),
  }));
}

export type RevenueRow = { period: string; account: string; cents: number };

/** Revenue by account and month from the ledger (rule 6). */
export async function revenueByLine(tx: Sql, tenantId: string, from: string, to: string): Promise<{ rows: RevenueRow[]; months: string[]; accounts: string[]; totals: Record<string, number> }> {
  const rows = (
    await tx<{ period: string; account: string; cents: string | number }[]>`
      select e.period, g.name as account, sum(l.credit_cents - l.debit_cents) as cents
      from public.journal_lines l join public.journal_entries e on e.id = l.entry_id join public.gl_accounts g on g.id = l.gl_account_id
      where l.tenant_id = ${tenantId} and g.type = 'revenue' and e.posted_on between ${from} and ${to}
      group by e.period, g.number, g.name order by e.period, g.number`
  ).map((r) => ({ ...r, cents: Number(r.cents) }));
  const months = monthsBetween(from, to);
  const accounts = [...new Set(rows.map((r) => r.account))];
  const totals: Record<string, number> = {};
  for (const m of months) totals[m] = rows.filter((r) => r.period === m).reduce((s, r) => s + r.cents, 0);
  return { rows, months, accounts, totals };
}

export { AGING };
export type AgingRow = { account: string; account_id: string; buckets: Record<AgingBucket, number>; total: number };

/** Receivables aging on a day (rule 7): each invoice issued by then and not void by then, less what was paid on it by
 *  then (by the payment's received date), bucketed by days past due on that day. */
export async function arAging(tx: Sql, tenantId: string, timeZone: string, day: string): Promise<{ rows: AgingRow[]; totals: Record<AgingBucket, number> }> {
  const open = await tx<{ account_id: string; account: string; due_on: string | null; open: string | number }[]>`
    select i.account_id, coalesce(a.name, 'not shown') as account, i.due_on::text,
           i.total_cents - coalesce((select sum(pa.amount_cents) from public.payment_allocations pa left join public.payments p on p.id = pa.payment_id
                                     where pa.invoice_id = i.id and (coalesce(p.received_at, pa.created_at) at time zone ${timeZone})::date <= ${day}), 0) as open
    from public.invoices i left join public.accounts a on a.id = i.account_id
    where i.tenant_id = ${tenantId} and i.kind = 'invoice' and i.status <> 'draft' and i.issued_on <= ${day}
      and (i.voided_at is null or (i.voided_at at time zone ${timeZone})::date > ${day})`;
  const empty = () => Object.fromEntries(AGING.map((b) => [b, 0])) as Record<AgingBucket, number>;
  const by = new Map<string, AgingRow>();
  const totals = empty();
  for (const o of open) {
    const cents = Number(o.open);
    if (cents <= 0) continue;
    const row = by.get(o.account_id) ?? { account: o.account, account_id: o.account_id, buckets: empty(), total: 0 };
    const b = agingBucket(o.due_on, day);
    row.buckets[b] += cents;
    row.total += cents;
    totals[b] += cents;
    by.set(o.account_id, row);
  }
  return { rows: [...by.values()].sort((a, b) => b.total - a.total), totals };
}

export type SourceRow = { source: string; leads: number; won: number; lost: number; open: number; rate: number | null };

/** Leads created in the range by source, with the close rate (rule 8). */
export async function salesBySource(tx: Sql, tenantId: string, timeZone: string, from: string, to: string): Promise<{ rows: SourceRow[]; total: SourceRow }> {
  const rows = (
    await tx<{ source: string; leads: number; won: number; lost: number }[]>`
      select coalesce(s.name, 'unknown') as source, count(*)::int as leads, count(*) filter (where l.stage = 'won')::int as won, count(*) filter (where l.stage = 'lost')::int as lost
      from public.leads l left join public.lead_sources s on s.id = l.source_id
      where l.tenant_id = ${tenantId} and (l.created_at at time zone ${timeZone})::date between ${from} and ${to}
      group by 1 order by leads desc, source`
  ).map((r) => ({ ...r, open: r.leads - r.won - r.lost, rate: rate(r.won, r.won + r.lost) }));
  const sum = (k: "leads" | "won" | "lost" | "open") => rows.reduce((s, r) => s + r[k], 0);
  return { rows, total: { source: "All sources", leads: sum("leads"), won: sum("won"), lost: sum("lost"), open: sum("open"), rate: rate(sum("won"), sum("won") + sum("lost")) } };
}

export type ReserviceRow = { service_type: string; reason: string; reservices: number; completed: number; rate: number | null };

/** Re-services booked in the range by service type and reason, against that service type's completed visits. */
export async function reserviceReport(tx: Sql, tenantId: string, timeZone: string, from: string, to: string): Promise<ReserviceRow[]> {
  const rows = await tx<{ service_type: string; reason: string; reservices: number; completed: number }[]>`
    with r as (
      select v.service_type_id, coalesce(nullif(trim(v.reservice_reason), ''), 'no reason given') as reason, count(*)::int as reservices
      from public.visits v where v.tenant_id = ${tenantId} and v.kind = 'reservice' and (v.created_at at time zone ${timeZone})::date between ${from} and ${to}
      group by 1, 2
    ), c as (
      select v.service_type_id, count(*)::int as completed from public.visits v
      where v.tenant_id = ${tenantId} and v.status = 'completed' and not v.imported and v.kind <> 'reservice' and (v.completed_at at time zone ${timeZone})::date between ${from} and ${to}
      group by 1
    )
    select st.name as service_type, r.reason, r.reservices, coalesce(c.completed, 0) as completed
    from r join public.service_types st on st.id = r.service_type_id left join c on c.service_type_id = r.service_type_id
    order by r.reservices desc, st.name`;
  return rows.map((r) => ({ ...r, rate: rate(r.reservices, r.completed) }));
}

// ---------------------------------------------------------------------------
// Custom reports and the export (rules 9 to 11)
// ---------------------------------------------------------------------------

export function datasetsFor(permissions: readonly string[]): Dataset[] {
  return DATASETS.filter((d) => can(permissions, d.permission));
}

export async function runDefinition(tx: Sql, tenantId: string, dataset: Dataset, def: Definition, rowLimit: number | null): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
  const q = buildQuery(def, dataset, tenantId, rowLimit);
  const rows = (await tx.unsafe(q.text, q.params as never[])) as unknown as Record<string, unknown>[];
  return { columns: q.columns, rows };
}

export type SavedReport = { id: string; name: string; dataset: string; definition: Definition; shared: boolean; created_by: string | null; author: string; updated_at: string };

/** Saved reports the member can see: their own and the shared ones (rule 11; row level security decides). */
export async function listSaved(tx: Sql, tenantId: string): Promise<SavedReport[]> {
  const rows = await tx<(Omit<SavedReport, "definition"> & { definition: unknown })[]>`
    select r.id, r.name, r.dataset, r.definition, r.shared, r.created_by, coalesce(m.display_name, 'Member') as author, r.updated_at::text
    from public.saved_reports r left join public.memberships m on m.tenant_id = r.tenant_id and m.user_id = r.created_by
    where r.tenant_id = ${tenantId} order by r.name`;
  return rows.map((r) => ({ ...r, definition: definitionFromJson(r.definition) }));
}

export async function loadSaved(tx: Sql, tenantId: string, reportId: string): Promise<SavedReport | null> {
  return (await listSaved(tx, tenantId)).find((r) => r.id === reportId) ?? null;
}

/** Runs a saved report under the member's session; null when its dataset needs a permission they lack (rule 10). */
export async function runSaved(tx: Sql, tenantId: string, report: SavedReport, permissions: readonly string[], rowLimit: number): Promise<{ columns: string[]; rows: Record<string, unknown>[] } | null> {
  const dataset = datasetFor(report.dataset);
  if (!dataset || !can(permissions, dataset.permission)) return null;
  return runDefinition(tx, tenantId, dataset, report.definition, rowLimit);
}

export function rowsToCsv(columns: readonly string[], rows: readonly Record<string, unknown>[]): string {
  return toCsv(columns, rows.map((r) => columns.map((c) => r[c])));
}

/** One CSV per dataset the member can read, each run under their session, with a README of the columns. */
export async function exportDatasets(tx: Sql, tenantId: string, permissions: readonly string[]): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const readme: string[] = ["Bugsy data export", "", "One CSV per dataset your role can read, every row your role can see. Money columns are integer cents; dates are YYYY-MM-DD in the company's time zone.", ""];
  for (const d of datasetsFor(permissions)) {
    const { columns, rows } = await runDefinition(tx, tenantId, d, { columns: d.columns.map((c) => c.name), filters: [], group_by: [], aggregates: [] }, null);
    files[`${d.key}.csv`] = rowsToCsv(columns, rows);
    readme.push(`${d.key}.csv (${rows.length} rows): ${d.columns.map((c) => `${c.name} (${c.type})`).join(", ")}`);
  }
  files["README.txt"] = `${readme.join("\n")}\n`;
  return files;
}
