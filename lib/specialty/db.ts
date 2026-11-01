// Specialty services (spec 15): wildlife authorizations and captures, materials and their invoice, prep checks,
// termite diagram marks and WDI reports. Queries run on the caller's connection: row level security decides.
import type postgres from "postgres";
import { createInvoice } from "@/lib/billing/db";
import { dateInZone } from "@/lib/dates";
import { materialLines } from "./materials";
import { type Findings, type WdiReport } from "./wdi";

type Sql = postgres.Sql | postgres.TransactionSql;

export type Authorization = { id: string; signer_name: string; relationship: string; signed_on: string; scope: string | null; file_id: string | null; created_at: Date };

export function authorizationsFor(tx: Sql, tenantId: string, agreementId: string): Promise<Authorization[]> {
  return tx<Authorization[]>`
    select id, signer_name, relationship, signed_on::text, scope, file_id, created_at from public.job_authorizations
    where tenant_id = ${tenantId} and agreement_id = ${agreementId} order by signed_on desc, created_at desc`;
}

export type Capture = { id: string; visit_id: string; species: string; count: number; disposition: string; location: string | null; notes: string | null; created_at: Date };
export type Material = { id: string; visit_id: string; description: string; quantity: string; unit: string; unit_price_cents: string | number; billable: boolean; created_at: Date };
export type PrepCheck = { visit_id: string; ready: boolean; missing: string[]; notes: string | null; checked_at: Date };

/** What a job's visits recorded: captures, materials and prep checks, for the agreement page. */
export async function jobRecords(tx: Sql, tenantId: string, agreementId: string): Promise<{ captures: Capture[]; materials: Material[]; prep: PrepCheck[] }> {
  const captures = await tx<Capture[]>`
    select c.id, c.visit_id, c.species, c.count, c.disposition, c.location, c.notes, c.created_at from public.wildlife_captures c join public.visits v on v.id = c.visit_id
    where c.tenant_id = ${tenantId} and v.agreement_id = ${agreementId} order by c.created_at`;
  const materials = await tx<Material[]>`
    select m.id, m.visit_id, m.description, m.quantity::text, m.unit, m.unit_price_cents, m.billable, m.created_at from public.visit_materials m join public.visits v on v.id = m.visit_id
    where m.tenant_id = ${tenantId} and v.agreement_id = ${agreementId} order by m.created_at`;
  const prep = await tx<PrepCheck[]>`
    select p.visit_id, p.ready, p.missing, p.notes, p.checked_at from public.prep_checks p join public.visits v on v.id = p.visit_id
    where p.tenant_id = ${tenantId} and v.agreement_id = ${agreementId}`;
  return { captures, materials, prep };
}

/** Rule 5: the billable materials of a completed visit as one invoice, once (source key materials:<visit>). It runs in
 *  the completion's transaction under the technician's session; the crew may write their own visit's materials invoice. */
export async function invoiceMaterials(tx: Sql, tenantId: string, visitId: string, timeZone: string): Promise<string | null> {
  const [v] = await tx<{ account_id: string; property_id: string; agreement_id: string | null; service_type_id: string; service_line: string; completed_at: Date | null; status: string }[]>`
    select v.account_id, v.property_id, v.agreement_id, v.service_type_id, st.service_line, v.completed_at, v.status
    from public.visits v join public.service_types st on st.id = v.service_type_id where v.id = ${visitId} and v.tenant_id = ${tenantId}`;
  if (!v || v.status !== "completed") return null;
  const rows = await tx<{ description: string; quantity: string; unit: string; unit_price_cents: string | number; billable: boolean }[]>`
    select description, quantity::text, unit, unit_price_cents, billable from public.visit_materials where tenant_id = ${tenantId} and visit_id = ${visitId} order by created_at`;
  const lines = materialLines(rows);
  if (lines.length === 0) return null;
  const { id } = await createInvoice(tx, tenantId, {
    account_id: v.account_id,
    property_id: v.property_id,
    visit_id: visitId,
    source: "materials",
    source_key: `materials:${visitId}`,
    issued_on: dateInZone(v.completed_at ?? new Date(), timeZone),
    memo: "Materials used at the visit",
    lines: lines.map((l) => ({ ...l, visit_id: visitId, service_type_id: v.service_type_id, service_line: v.service_line })),
    issue: true,
  });
  return id;
}

export type Mark = { id: string; map_id: string; kind: string; x: number; y: number; label: string };

export async function marksFor(tx: Sql, tenantId: string, propertyId: string): Promise<Mark[]> {
  const rows = await tx<(Omit<Mark, "x" | "y"> & { x: string; y: string })[]>`
    select id, map_id, kind, x::text, y::text, label from public.diagram_marks where tenant_id = ${tenantId} and property_id = ${propertyId} order by created_at`;
  return rows.map((r) => ({ ...r, x: Number(r.x), y: Number(r.y) }));
}

export type WdiRow = WdiReport & { id: string; visit_id: string; inspector_id: string | null };

export async function wdiFor(tx: Sql, tenantId: string, visitId: string): Promise<WdiRow | null> {
  const [row] = await tx<(Omit<WdiRow, "findings"> & { findings: Findings | null })[]>`
    select id, visit_id, number, requested_by, buyer, seller, structures, inspected_areas, inaccessible_areas, findings, treatment_recommended, notes, inspector_id, status, issued_at
    from public.wdi_reports where tenant_id = ${tenantId} and visit_id = ${visitId}`;
  return row ? { ...row, findings: row.findings ?? {} } : null;
}

/** The inspector on the visit's crew (its lead) and their credential for the property's state. */
export async function wdiInspector(tx: Sql, tenantId: string, visitId: string): Promise<{ user_id: string; name: string; cert_number: string | null; license_number: string | null } | null> {
  const [row] = await tx<{ user_id: string; name: string | null; cert_number: string | null; license_number: string | null }[]>`
    select c.user_id, m.display_name as name, cr.cert_number, cr.license_number
    from public.visit_crew c join public.visits v on v.id = c.visit_id join public.properties p on p.id = v.property_id
      left join public.memberships m on m.tenant_id = c.tenant_id and m.user_id = c.user_id
      left join public.applicator_credentials cr on cr.tenant_id = c.tenant_id and cr.user_id = c.user_id and cr.state_code = p.state_code and cr.archived_at is null
    where c.tenant_id = ${tenantId} and c.visit_id = ${visitId}
    order by case c.role when 'lead' then 0 else 1 end limit 1`;
  return row ? { ...row, name: row.name ?? "Member" } : null;
}
