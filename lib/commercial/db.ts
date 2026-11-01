// Commercial programs (spec 14): the sites list, one site's detail, and what the audit binder holds. Every query runs on
// the caller's connection, so row level security decides what a member sees.
import type postgres from "postgres";
import { type Amendment, type RecordSnapshot, applyAmendments } from "@/lib/compliance/records";
import { type CheckLike, type TrendRow, devicesAsOf, hasActivity, hotDevices, trend } from "./devices";

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
  const recent = await lastChecks(tx, tenantId, null, null, null);
  return rows.map((r) => ({ ...r, hot: hotDevices(recent.filter((c) => c.property_id === r.property_id)).size }));
}

/** Rule 5: each active device's last three checks, however old, through a business date when one is given. */
async function lastChecks(tx: Sql, tenantId: string, propertyId: string | null, timeZone: string | null, through: string | null): Promise<(CheckLike & { property_id: string })[]> {
  return tx<(CheckLike & { property_id: string })[]>`
    select device_id, checked_at, status, activity, count, bait_consumed_pct, property_id from (
      select c.device_id, c.checked_at, c.status, c.activity, c.count, c.bait_consumed_pct, d.property_id,
             row_number() over (partition by c.device_id order by c.checked_at desc) as n
      from public.device_checks c join public.devices d on d.id = c.device_id
      where c.tenant_id = ${tenantId} and d.status = 'active' and (${propertyId}::uuid is null or d.property_id = ${propertyId})
        and (${through}::date is null or (c.checked_at at time zone ${timeZone ?? "UTC"})::date <= ${through}::date)
    ) x where n <= 3`;
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
  // Open now, or open at some point of the range (raised by its end and not closed before its start).
  const sightings = await tx<SightingRow[]>`
    select id, seen_at, location, pest, count, reported_by, source, notes, resolved_at, resolution from public.sightings
    where property_id = ${propertyId}
      and (resolved_at is null or ((seen_at at time zone ${timeZone})::date <= ${to} and (resolved_at at time zone ${timeZone})::date >= ${from}))
    order by seen_at desc`;
  const recommendations = await tx<RecommendationRow[]>`
    select id, created_at, category, description, responsibility, priority, owner_name, due_on::text, status, closed_on::text, closed_note, visit_id from public.recommendations
    where property_id = ${propertyId} and (status <> 'closed' or ((created_at at time zone ${timeZone})::date <= ${to} and closed_on >= ${from}))
    order by status = 'closed', due_on nulls last, created_at desc`;
  const documents = await tx<DocumentRow[]>`select id, file_id, title, kind, valid_until::text, shared, created_at from public.site_documents where property_id = ${propertyId} order by kind, title`;
  // Hot is about the latest checks whenever they were; the trend is the range's.
  const latest = await lastChecks(tx, tenantId, propertyId, null, null);
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
    trend: trend(checks.map((c) => ({ month: month(new Date(c.checked_at)), kind: c.kind, device_id: c.device_id, status: c.status, activity: c.activity, count: c.count, bait_consumed_pct: c.bait_consumed_pct }))),
  };
}

export type BinderData = Site & {
  company: { name: string; legal_name: string | null; licenses: { branch: string; number: string | null; expires: string | null }[] };
  applicators: { name: string; cert_number: string | null; categories: string[]; expires: string | null }[];
  applications: { business_date: string; product: string; epa_reg_no: string; amount: string; unit: string; site_treated: string; target_pests: string[]; applicator: string | null }[];
  visits: { id: string; date: string | null; service: string; technician: string | null }[];
  /** Spec 15 rule 4: animals caught at the site's visits in the range, by visit. */
  captures: { visit_date: string | null; species: string; count: number; disposition: string; location: string | null; notes: string | null }[];
  range: { from: string; to: string };
  time_zone: string;
  made_at: Date;
};

/** Everything rule 10 puts in the binder for a property and a range, under the caller's session. Devices and maps are
 *  as they stood at the end of the range (rule 2); applications and applicators come from the application records
 *  (spec 07) with their amendments, so the binder says what the legal record says. */
export async function binderData(tx: Sql, tenantId: string, propertyId: string, timeZone: string, from: string, to: string): Promise<BinderData | null> {
  const site = await loadSite(tx, tenantId, propertyId, timeZone, from, to);
  if (!site) return null;
  const who = await names(tx, tenantId);
  const [company] = await tx<{ name: string; legal_name: string | null }[]>`select name, legal_name from public.tenants where id = ${tenantId}`;
  const licenses = await tx<{ branch: string; number: string | null; expires: string | null }[]>`
    select name as branch, business_license_number as number, license_expires_on::text as expires from public.branches
    where tenant_id = ${tenantId} and archived_at is null and state_code = ${site.property.state_code} order by name`;

  const events = await tx<{ device_id: string; kind: string; on: string; after: Record<string, unknown> | null }[]>`
    select e.device_id, e.kind, (e.at at time zone ${timeZone})::date::text as on, e.after
    from public.device_events e join public.devices d on d.id = e.device_id
    where d.property_id = ${propertyId} order by e.at, e.created_at`;
  const devices = devicesAsOf(site.devices, events, from, to);
  const maps = await tx<SiteMapRow[]>`
    select id, name, file_id, width, height, position from public.site_maps
    where property_id = ${propertyId} and (archived_at is null or (archived_at at time zone ${timeZone})::date >= ${from}) order by position, name`;
  const hot = hotDevices(await lastChecks(tx, tenantId, propertyId, timeZone, to));

  const visits = await tx<{ id: string; date: string | null; service: string; technician_id: string | null }[]>`
    select v.id, (v.completed_at at time zone ${timeZone})::date::text as date, st.name as service, v.technician_id
    from public.visits v join public.service_types st on st.id = v.service_type_id
    where v.property_id = ${propertyId} and v.status = 'completed' and not v.imported and (v.completed_at at time zone ${timeZone})::date between ${from} and ${to}
    order by v.completed_at`;
  const records = await tx<{ id: string; business_date: string; snapshot: RecordSnapshot }[]>`
    select r.id, r.business_date::text, r.snapshot from public.application_records r join public.visits v on v.id = r.visit_id
    where r.tenant_id = ${tenantId} and v.property_id = ${propertyId} and r.business_date between ${from} and ${to}
    order by r.business_date, r.created_at`;
  const amendments = records.length
    ? await tx<(Amendment & { record_id: string })[]>`
        select record_id, changed_fields from public.application_record_amendments where tenant_id = ${tenantId} and record_id = any(${records.map((r) => r.id)}::uuid[]) order by created_at`
    : [];
  const current = records.map((r) => ({
    business_date: r.business_date,
    snapshot: applyAmendments(r.snapshot as unknown as Record<string, unknown>, amendments.filter((a) => a.record_id === r.id)) as unknown as RecordSnapshot,
  }));
  const applications = current.flatMap((r) =>
    (r.snapshot.products ?? []).map((p) => ({
      business_date: r.business_date,
      product: p.product_name,
      epa_reg_no: p.epa_reg_no,
      amount: String(p.amount),
      unit: p.amount_unit,
      site_treated: p.site_treated,
      target_pests: p.target_pests ?? [],
      applicator: p.applied_by?.name ?? null,
    })),
  );
  // The crew's credentials as each record holds them, latest record first, once per person.
  const applicators = new Map<string, BinderData["applicators"][number]>();
  for (const r of [...current].reverse()) {
    for (const m of r.snapshot.crew ?? []) {
      if (!applicators.has(m.user_id)) applicators.set(m.user_id, { name: m.name, cert_number: m.cert_number, categories: m.categories ?? [], expires: m.cert_expires_on });
    }
  }
  const captures = await tx<BinderData["captures"]>`
    select (coalesce(v.completed_at, c.created_at) at time zone ${timeZone})::date::text as visit_date, c.species, c.count, c.disposition, c.location, c.notes
    from public.wildlife_captures c join public.visits v on v.id = c.visit_id
    where v.property_id = ${propertyId} and (c.created_at at time zone ${timeZone})::date between ${from} and ${to}
    order by c.created_at`;
  return {
    ...site,
    maps,
    devices,
    hot,
    captures,
    company: { name: company.name, legal_name: company.legal_name, licenses },
    applicators: [...applicators.values()],
    applications,
    visits: visits.map((v) => ({ id: v.id, date: v.date, service: v.service, technician: v.technician_id ? (who.get(v.technician_id) ?? "Member") : null })),
    range: { from, to },
    time_zone: timeZone,
    made_at: new Date(),
  };
}

export { hasActivity };
