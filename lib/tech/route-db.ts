// Loads a technician's route for a day with everything the stop screen needs, under the technician's own session.
import type postgres from "postgres";
import type { JobKind, TreatmentArea } from "@/lib/catalog/service-lines";
import { requiredRecordFields } from "@/lib/compliance/records";
import { getStatePack } from "@/lib/compliance/rules";
import type { ArrivalWindow, CrewRole } from "@/lib/dispatch/checks";
import { listMembers } from "@/lib/dispatch/db";
import type { CapturedNote, CapturedPhoto, CapturedProduct, RouteCrewMember, RoutePayload, RouteProduct, RouteVisit } from "@/lib/tech/route-types";
import type { Conditions } from "@/lib/weather/provider";

type Sql = postgres.Sql | postgres.TransactionSql;

type VisitRow = {
  id: string;
  sequence: number;
  status: string;
  kind: string;
  job_kind: JobKind;
  treatment_areas: TreatmentArea[];
  due_start: string;
  due_end: string;
  scheduled_for: string | null;
  route_position: number | null;
  arrival_window: ArrivalWindow;
  interior_only: boolean;
  reservice_reason: string | null;
  dispatch_notes: string | null;
  price_cents: string;
  billing_mode: string | null;
  agreement_number: number | null;
  account_id: string;
  account_name: string;
  account_phone: string | null;
  property_id: string;
  address: string;
  city: string | null;
  state_code: string;
  lat: number | null;
  lng: number | null;
  access_notes: string | null;
  service_type_id: string;
  service_type_name: string;
  arrived_at: string | null;
  departed_at: string | null;
  completed_at: string | null;
  conditions: Conditions | null;
  areas_treated: string[];
  target_pests: string[];
  required_cert_categories: string[] | null;
  pack_version: string | null;
  confirmed_at: string | null;
};

const VISIT_SELECT = (tx: Sql) => tx`
  select v.id, v.sequence, v.status, v.kind, st.job_kind, st.treatment_areas, v.due_start, v.due_end, v.scheduled_for, v.route_position, v.arrival_window,
         v.interior_only, v.reservice_reason, v.dispatch_notes, v.price_cents, a.billing_mode, a.number as agreement_number,
         ac.id as account_id, ac.name as account_name, ac.phone as account_phone,
         p.id as property_id, p.normalized_address as address, p.city, p.state_code, p.lat, p.lng, p.access_notes,
         st.id as service_type_id, st.name as service_type_name,
         v.arrived_at, v.departed_at, v.completed_at, v.conditions, v.areas_treated, v.target_pests,
         r.required_cert_categories, r.pack_version, r.confirmed_at
  from public.visits v
    join public.accounts ac on ac.id = v.account_id
    join public.properties p on p.id = v.property_id
    join public.service_types st on st.id = v.service_type_id
    left join public.agreements a on a.id = v.agreement_id
    left join public.service_type_state_rules r on r.service_type_id = st.id and r.state_code = p.state_code`;

async function captures(tx: Sql, tenantId: string, visitId: string): Promise<RouteVisit["captured"] & { crew: RouteCrewMember[] }> {
  const products = await tx<CapturedProduct[]>`
    select vp.id, vp.product_id, pr.name as product_name, pr.epa_reg_no, vp.applied_by, vp.site_treated, vp.location_description, vp.amount::text, vp.amount_unit,
           vp.carrier_amount::text, vp.carrier_unit, vp.target_pests, vp.label_check, vp.recorded_at
    from public.visit_products vp join public.products pr on pr.id = vp.product_id
    where vp.tenant_id = ${tenantId} and vp.visit_id = ${visitId} order by vp.recorded_at`;
  const notes = await tx<CapturedNote[]>`select id, kind, content, recorded_at from public.visit_notes where tenant_id = ${tenantId} and visit_id = ${visitId} order by recorded_at`;
  const photos = await tx<CapturedPhoto[]>`select id, file_id, kind, caption, taken_at from public.visit_photos where tenant_id = ${tenantId} and visit_id = ${visitId} order by taken_at`;
  const [signature] = await tx<{ signer_name: string; signed_at: string; file_id: string }[]>`
    select signer_name, signed_at, file_id from public.visit_signatures where tenant_id = ${tenantId} and visit_id = ${visitId}`;
  return { arrived_at: null, departed_at: null, completed_at: null, conditions: null, areas_treated: [], target_pests: [], products, notes, photos, signature: signature ?? null, crew: [] };
}

async function crewFor(tx: Sql, tenantId: string, visitId: string, stateCode: string, names: Map<string, string>): Promise<RouteCrewMember[]> {
  const rows = await tx<{ user_id: string; role: CrewRole; cert_number: string | null; trainee_registered_on: string | null; cert_expires_on: string | null; has_credential: boolean }[]>`
    select c.user_id, c.role, cr.cert_number, cr.trainee_registered_on, cr.cert_expires_on, (cr.id is not null) as has_credential
    from public.visit_crew c
      left join public.applicator_credentials cr on cr.tenant_id = c.tenant_id and cr.user_id = c.user_id and cr.state_code = ${stateCode} and cr.archived_at is null
    where c.tenant_id = ${tenantId} and c.visit_id = ${visitId}
    order by case c.role when 'lead' then 0 when 'applicator' then 1 when 'supervisor' then 2 else 3 end`;
  return rows.map((r) => ({
    user_id: r.user_id,
    name: names.get(r.user_id) ?? "Crew member",
    role: r.role,
    credential: r.has_credential ? { cert_number: r.cert_number, trainee: r.trainee_registered_on !== null, cert_expires_on: r.cert_expires_on } : null,
  }));
}

function toRouteVisit(row: VisitRow, crew: RouteCrewMember[], captured: RouteVisit["captured"]): RouteVisit {
  return {
    id: row.id,
    sequence: row.sequence,
    status: row.status,
    kind: row.kind,
    job_kind: row.job_kind,
    treatment_areas: row.treatment_areas,
    due_start: row.due_start,
    due_end: row.due_end,
    scheduled_for: row.scheduled_for,
    route_position: row.route_position,
    arrival_window: row.arrival_window,
    interior_only: row.interior_only,
    reservice_reason: row.reservice_reason,
    dispatch_notes: row.dispatch_notes,
    price_cents: Number(row.price_cents),
    billing_mode: row.billing_mode,
    agreement_number: row.agreement_number,
    account: { id: row.account_id, name: row.account_name, phone: row.account_phone },
    property: { id: row.property_id, address: row.address, city: row.city, state: row.state_code, lat: row.lat, lng: row.lng, access_notes: row.access_notes },
    service_type: { id: row.service_type_id, name: row.service_type_name },
    crew,
    state_rule: row.required_cert_categories ? { required_cert_categories: row.required_cert_categories, pack_version: row.pack_version, confirmed_at: row.confirmed_at } : null,
    required_fields: requiredRecordFields(row.job_kind, getStatePack(row.state_code)),
    captured: {
      ...captured,
      arrived_at: row.arrived_at ? new Date(row.arrived_at).toISOString() : null,
      departed_at: row.departed_at ? new Date(row.departed_at).toISOString() : null,
      completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      conditions: row.conditions,
      areas_treated: row.areas_treated ?? [],
      target_pests: row.target_pests ?? [],
    },
  };
}

/** One visit with its crew and captures, for the sync endpoint's completion gate and the office pages. */
export async function loadRouteVisit(tx: Sql, tenantId: string, visitId: string): Promise<RouteVisit | null> {
  const [row] = await tx<VisitRow[]>`${VISIT_SELECT(tx)} where v.id = ${visitId} and v.tenant_id = ${tenantId}`;
  if (!row) return null;
  const names = new Map((await listMembers(tx, tenantId)).map((m) => [m.user_id, m.name]));
  const crew = await crewFor(tx, tenantId, visitId, row.state_code, names);
  const captured = await captures(tx, tenantId, visitId);
  return toRouteVisit(row, crew, captured);
}

export async function enabledProducts(tx: Sql, tenantId: string): Promise<RouteProduct[]> {
  return tx<RouteProduct[]>`
    select p.id, p.name, p.manufacturer, p.epa_reg_no, p.restricted_use, p.signal_word, p.label_rates, tp.unit, p.upc
    from public.tenant_products tp join public.products p on p.id = tp.product_id
    where tp.tenant_id = ${tenantId} and tp.enabled and p.archived_at is null order by p.name`;
}

/** The technician's stops for a day: every visit they lead or are crew on. */
export async function loadRoute(
  tx: Sql,
  tenant: { id: string; name: string; timezone: string },
  technician: { user_id: string; locale: string },
  date: string,
): Promise<RoutePayload> {
  const rows = await tx<VisitRow[]>`
    ${VISIT_SELECT(tx)}
    where v.tenant_id = ${tenant.id} and v.scheduled_for = ${date}
      and v.status in ('scheduled', 'en_route', 'in_progress', 'completed')
      and (v.technician_id = ${technician.user_id} or exists (select 1 from public.visit_crew c where c.visit_id = v.id and c.user_id = ${technician.user_id}))
    order by v.route_position nulls last, v.sequence`;
  const names = new Map((await listMembers(tx, tenant.id)).map((m) => [m.user_id, m.name]));
  const visits: RouteVisit[] = [];
  for (const row of rows) {
    const crew = await crewFor(tx, tenant.id, row.id, row.state_code, names);
    visits.push(toRouteVisit(row, crew, await captures(tx, tenant.id, row.id)));
  }
  return {
    date,
    loaded_at: new Date().toISOString(),
    tenant,
    technician: { user_id: technician.user_id, name: names.get(technician.user_id) ?? "Technician", locale: technician.locale },
    visits,
    products: await enabledProducts(tx, tenant.id),
  };
}
