// Commercial programs (spec 14): the sites list, one site's detail, and what the audit binder holds. Every query runs on
// the caller's connection, so row level security decides what a member sees.
import type postgres from "postgres";
import { type TrendInput, type TrendRow, hasActivity, hotDevices, trend } from "./devices";

type Sql = postgres.Sql | postgres.TransactionSql;

export type SiteRow = {
  property_id: string;
  address: string;
  account_id: string;
  account_name: string;
  devices: number;
  last_check: Date | null;
  checks_90: number;
  active_90: number;
  open_recommendations: number;
  overdue_recommendations: number;
  open_sightings: number;
  hot: number;
};

/** Every property with a device or a map: the sites list (rules 5 and 8). */
export async function listSites(tx: Sql, tenantId: string, today: string): Promise<SiteRow[]> {
  const rows = await tx<Omit<SiteRow, "hot">[]>`
    select p.id as property_id, p.normalized_address as address, a.id as account_id, a.name as account_name,
           (select count(*)::int from public.devices d where d.property_id = p.id and d.status = 'active') as devices,
           (select max(c.checked_at) from public.device_checks c join public.devices d on d.id = c.device_id where d.property_id = p.id) as last_check,
           (select count(*)::int from public.device_checks c join public.devices d on d.id = c.device_id where d.property_id = p.id and c.status = 'checked' and c.checked_at > now() - interval '90 days') as checks_90,
           (select count(*)::int from public.device_checks c join public.devices d on d.id = c.device_id where d.property_id = p.id and c.status = 'checked' and c.checked_at > now() - interval '90 days'
              and ((c.activity is not null and c.activity <> 'none') or coalesce(c.count, 0) > 0 or coalesce(c.bait_consumed_pct, 0) > 0)) as active_90,
           (select count(*)::int from public.recommendations r where r.property_id = p.id and r.status <> 'closed') as open_recommendations,
           (select count(*)::int from public.recommendations r where r.property_id = p.id and r.status <> 'closed' and r.due_on < ${today}) as overdue_recommendations,
           (select count(*)::int from public.sightings s where s.property_id = p.id and s.resolved_at is null) as open_sightings
    from public.properties p join public.accounts a on a.id = p.account_id
    where p.tenant_id = ${tenantId} and p.archived_at is null
      and (exists (select 1 from public.devices d where d.property_id = p.id) or exists (select 1 from public.site_maps m where m.property_id = p.id))
    order by a.name, p.normalized_address`;
  const recent = await tx<(TrendInput & { device_id: string; checked_at: Date; property_id: string })[]>`
    select c.device_id, c.checked_at, c.status, c.activity, c.count, c.bait_consumed_pct, d.property_id, d.kind, '' as month
    from public.device_checks c join public.devices d on d.id = c.device_id
    where c.tenant_id = ${tenantId} and d.status = 'active' and c.checked_at > now() - interval '180 days'`;
  return rows.map((r) => ({ ...r, hot: hotDevices(recent.filter((c) => c.property_id === r.property_id)).size }));
}

export type SiteMapRow = { id: string; name: string; file_id: string; width: number; height: number; position: number };
export type DeviceRow = {
  id: string;
  number: string;
  barcode: string | null;
  kind: string;
  zone: string;
  location: string;
  map_id: string | null;
  x: number | null;
  y: number | null;
  status: string;
  installed_on: string;
  removed_on: string | null;
  removed_reason: string | null;
};
export type CheckRow = {
  id: string;
  device_id: string;
  number: string;
  kind: string;
  visit_id: string | null;
  checked_at: Date;
  checked_by_name: string | null;
  source: string;
  status: string;
  activity: string | null;
  count: number | null;
  bait_consumed_pct: number | null;
  pest: string | null;
  actions: string[];
  notes: string | null;
};
export type EventRow = { id: string; number: string; kind: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; at: Date; by_name: string | null; visit_id: string | null };
export type SightingRow = { id: string; seen_at: Date; location: string; pest: string; count: number | null; reported_by: string | null; source: string; notes: string | null; resolved_at: Date | null; resolution: string | null };
export type RecommendationRow = {
  id: string;
  created_at: Date;
  category: string;
  description: string;
  responsibility: string;
  priority: string;
  owner_name: string | null;
  due_on: string | null;
  status: string;
  closed_on: string | null;
  closed_note: string | null;
  visit_id: string | null;
};
export type DocumentRow = { id: string; file_id: string; title: string; kind: string; valid_until: string | null; shared: boolean; created_at: Date };

export type Site = {
  property: { id: string; address: string; state_code: string; account_id: string; account_name: string };
  maps: SiteMapRow[];
  devices: DeviceRow[];
  checks: CheckRow[];
  events: EventRow[];
  sightings: SightingRow[];
  recommendations: RecommendationRow[];
  documents: DocumentRow[];
  hot: Set<string>;
  trend: TrendRow[];
};

async function names(tx: Sql, tenantId: string): Promise<Map<string, string>> {
  const rows = await tx<{ user_id: string; name: string | null }[]>`select user_id, display_name as name from public.memberships where tenant_id = ${tenantId}`;
  return new Map(rows.map((r) => [r.user_id, r.name ?? "Member"]));
}

/** One site with its maps, devices, checks in the range, history, sightings, recommendations and documents. */
export async function loadSite(tx: Sql, tenantId: string, propertyId: string, timeZone: string, from: string, to: string): Promise<Site | null> {
  const [property] = await tx<Site["property"][]>`
    select p.id, p.normalized_address as address, p.state_code, a.id as account_id, a.name as account_name
    from public.properties p join public.accounts a on a.id = p.account_id where p.id = ${propertyId} and p.tenant_id = ${tenantId}`;
  if (!property) return null;
  const who = await names(tx, tenantId);
  const maps = await tx<SiteMapRow[]>`select id, name, file_id, width, height, position from public.site_maps where property_id = ${propertyId} and archived_at is null order by position, name`;
  const devices = (
    await tx<(Omit<DeviceRow, "x" | "y"> & { x: string | null; y: string | null })[]>`
      select id, number, barcode, kind, zone, location, map_id, x::text, y::text, status, installed_on::text, removed_on::text, removed_reason
      from public.devices where property_id = ${propertyId} order by status, kind, length(number), number`
  ).map((d) => ({ ...d, x: d.x === null ? null : Number(d.x), y: d.y === null ? null : Number(d.y) }));
  const checks = (
    await tx<(Omit<CheckRow, "checked_by_name"> & { checked_by: string | null })[]>`
      select c.id, c.device_id, d.number, d.kind, c.visit_id, c.checked_at, c.checked_by, c.source, c.status, c.activity, c.count, c.bait_consumed_pct, c.pest, c.actions, c.notes
      from public.device_checks c join public.devices d on d.id = c.device_id
      where d.property_id = ${propertyId} and (c.checked_at at time zone ${timeZone})::date between ${from} and ${to}
      order by c.checked_at desc`
  ).map((c) => ({ ...c, checked_by_name: c.checked_by ? (who.get(c.checked_by) ?? "Member") : null }));
  const events = (
    await tx<(Omit<EventRow, "by_name"> & { by: string | null })[]>`
      select e.id, d.number, e.kind, e.before, e.after, e.at, e.by, e.visit_id from public.device_events e join public.devices d on d.id = e.device_id
      where d.property_id = ${propertyId} and (e.at at time zone ${timeZone})::date between ${from} and ${to} order by e.at desc`
  ).map((e) => ({ ...e, by_name: e.by ? (who.get(e.by) ?? "Member") : null }));
  const sightings = await tx<SightingRow[]>`
    select id, seen_at, location, pest, count, reported_by, source, notes, resolved_at, resolution from public.sightings
    where property_id = ${propertyId} and (resolved_at is null or (seen_at at time zone ${timeZone})::date between ${from} and ${to} or (resolved_at at time zone ${timeZone})::date between ${from} and ${to})
    order by seen_at desc`;
  const recommendations = await tx<RecommendationRow[]>`
    select id, created_at, category, description, responsibility, priority, owner_name, due_on::text, status, closed_on::text, closed_note, visit_id from public.recommendations
    where property_id = ${propertyId} and (status <> 'closed' or (created_at at time zone ${timeZone})::date between ${from} and ${to} or closed_on between ${from} and ${to})
    order by status = 'closed', due_on nulls last, created_at desc`;
  const documents = await tx<DocumentRow[]>`select id, file_id, title, kind, valid_until::text, shared, created_at from public.site_documents where property_id = ${propertyId} order by kind, title`;
  // Hot is about the latest checks whenever they were; the trend is the range's.
  const latest = await tx<{ device_id: string; checked_at: Date; status: string; activity: string | null; count: number | null; bait_consumed_pct: number | null }[]>`
    select c.device_id, c.checked_at, c.status, c.activity, c.count, c.bait_consumed_pct from public.device_checks c join public.devices d on d.id = c.device_id
    where d.property_id = ${propertyId} and d.status = 'active' and c.checked_at > now() - interval '180 days'`;
  const month = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).format(d).slice(0, 7);
  return {
    property,
    maps,
    devices,
    checks,
    events,
    sightings,
    recommendations,
    documents,
    hot: hotDevices(latest),
    trend: trend(checks.map((c) => ({ month: month(new Date(c.checked_at)), kind: c.kind, status: c.status, activity: c.activity, count: c.count, bait_consumed_pct: c.bait_consumed_pct }))),
  };
}

export type BinderData = Site & {
  company: { name: string; legal_name: string | null; licenses: { branch: string; number: string | null; expires: string | null }[] };
  applicators: { name: string; cert_number: string | null; license_number: string | null; categories: string[]; expires: string | null }[];
  applications: { business_date: string; product: string; epa_reg_no: string; amount: string; unit: string; site_treated: string; target_pests: string[]; applicator: string | null }[];
  visits: { id: string; date: string | null; service: string; technician: string | null }[];
  range: { from: string; to: string };
  made_at: Date;
};

/** Everything rule 10 puts in the binder for a property and a range, under the caller's session. */
export async function binderData(tx: Sql, tenantId: string, propertyId: string, timeZone: string, from: string, to: string): Promise<BinderData | null> {
  const site = await loadSite(tx, tenantId, propertyId, timeZone, from, to);
  if (!site) return null;
  const who = await names(tx, tenantId);
  const [company] = await tx<{ name: string; legal_name: string | null }[]>`select name, legal_name from public.tenants where id = ${tenantId}`;
  const licenses = await tx<{ branch: string; number: string | null; expires: string | null }[]>`
    select name as branch, business_license_number as number, license_expires_on::text as expires from public.branches
    where tenant_id = ${tenantId} and archived_at is null and state_code = ${site.property.state_code} order by name`;
  const visits = await tx<{ id: string; date: string | null; service: string; technician_id: string | null }[]>`
    select v.id, (v.completed_at at time zone ${timeZone})::date::text as date, st.name as service, v.technician_id
    from public.visits v join public.service_types st on st.id = v.service_type_id
    where v.property_id = ${propertyId} and v.status = 'completed' and not v.imported and (v.completed_at at time zone ${timeZone})::date between ${from} and ${to}
    order by v.completed_at`;
  const crew = [...new Set((await tx<{ user_id: string }[]>`select distinct c.user_id from public.visit_crew c where c.visit_id = any(${visits.map((v) => v.id)}::uuid[])`).map((r) => r.user_id))];
  const applicators = (
    await tx<{ user_id: string; cert_number: string | null; license_number: string | null; categories: string[] | null; expires: string | null }[]>`
      select user_id, cert_number, license_number, categories, cert_expires_on::text as expires from public.applicator_credentials
      where tenant_id = ${tenantId} and user_id = any(${crew}::uuid[]) and state_code = ${site.property.state_code} and archived_at is null`
  ).map((c) => ({ name: who.get(c.user_id) ?? "Member", cert_number: c.cert_number, license_number: c.license_number, categories: c.categories ?? [], expires: c.expires }));
  const applications = (
    await tx<{ business_date: string; product: string; epa_reg_no: string; amount: string; unit: string; site_treated: string; target_pests: string[]; applied_by: string | null }[]>`
      select (v.completed_at at time zone ${timeZone})::date::text as business_date, pr.name as product, pr.epa_reg_no, vp.amount::text, vp.amount_unit as unit, vp.site_treated, vp.target_pests, vp.applied_by
      from public.visit_products vp join public.visits v on v.id = vp.visit_id join public.products pr on pr.id = vp.product_id
      where v.property_id = ${propertyId} and v.status = 'completed' and (v.completed_at at time zone ${timeZone})::date between ${from} and ${to}
      order by v.completed_at, vp.recorded_at`
  ).map((a) => ({ ...a, applicator: a.applied_by ? (who.get(a.applied_by) ?? "Member") : null }));
  return {
    ...site,
    company: { name: company.name, legal_name: company.legal_name, licenses },
    applicators,
    applications,
    visits: visits.map((v) => ({ id: v.id, date: v.date, service: v.service, technician: v.technician_id ? (who.get(v.technician_id) ?? "Member") : null })),
    range: { from, to },
    made_at: new Date(),
  };
}

export { hasActivity };
