// Loading a visit's WDI report with what the page and the print view need (spec 15 rule 7), under the caller's session.
import type postgres from "postgres";
import { dateInZone } from "@/lib/dates";
import { wdiFor, wdiInspector, type WdiRow } from "./db";
import type { WdiContext } from "./wdi";

type Sql = postgres.Sql | postgres.TransactionSql;

export type WdiVisit = {
  id: string;
  tenant_id: string;
  status: string;
  job_kind: string;
  agreement_id: string | null;
  account_name: string;
  property_id: string;
  address: string;
  state_code: string;
  completed_at: Date | null;
  scheduled_for: string | null;
};

export const WDI_JOB_KINDS = ["inspection", "wdi_report"] as const;

export async function loadWdi(tx: Sql, tenantId: string, visitId: string, timeZone: string): Promise<{ visit: WdiVisit; report: WdiRow | null; ctx: WdiContext } | null> {
  const [visit] = await tx<WdiVisit[]>`
    select v.id, v.tenant_id, v.status, st.job_kind, v.agreement_id, ac.name as account_name, p.id as property_id, p.normalized_address as address, p.state_code,
           v.completed_at, v.scheduled_for::text
    from public.visits v join public.service_types st on st.id = v.service_type_id join public.properties p on p.id = v.property_id join public.accounts ac on ac.id = v.account_id
    where v.id = ${visitId} and v.tenant_id = ${tenantId}`;
  if (!visit) return null;
  const report = await wdiFor(tx, tenantId, visitId);
  const inspector = await wdiInspector(tx, tenantId, visitId);
  const [company] = await tx<{ name: string; legal_name: string | null }[]>`select name, legal_name from public.tenants where id = ${tenantId}`;
  const [license] = await tx<{ number: string | null }[]>`
    select business_license_number as number from public.branches where tenant_id = ${tenantId} and archived_at is null and state_code = ${visit.state_code}
    order by business_license_number nulls last, name limit 1`;
  // An issued report prints what the database captured at issue, never what is true today (rule 7).
  const snap = report?.status === "issued" ? report.issued_snapshot : null;
  if (snap) {
    return {
      visit,
      report,
      ctx: { company: snap.company, property: snap.property, inspected_on: snap.inspected_on, issued_on: snap.issued_on, inspector: snap.inspector },
    };
  }
  return {
    visit,
    report,
    ctx: {
      company: { name: company.name, legal_name: company.legal_name, license: license?.number ?? null },
      property: { address: visit.address, state: visit.state_code },
      inspected_on: visit.completed_at ? dateInZone(visit.completed_at, timeZone) : visit.scheduled_for,
      issued_on: report?.issued_at ? dateInZone(report.issued_at, timeZone) : null,
      inspector: inspector ? { name: inspector.name, cert_number: inspector.cert_number, license_number: inspector.license_number, cert_expires_on: inspector.cert_expires_on } : null,
    },
  };
}
