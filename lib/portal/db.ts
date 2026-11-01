// What the customer portal shows (spec 16), read under the portal identity's session: each table's row level security
// limits it to the identity's account and properties. Every query names its columns; nothing internal is selected.
import type postgres from "postgres";
import { type Amendment, type RecordSnapshot, applyAmendments } from "@/lib/compliance/records";
import { todayInZone } from "@/lib/dates";
import type { PortalIdentity } from "./session";

type Sql = postgres.Sql | postgres.TransactionSql;

export type PortalVisit = {
  id: string;
  property_id: string;
  address: string;
  service: string;
  kind: string;
  status: string;
  due_start: string;
  due_end: string;
  scheduled_for: string | null;
  arrival_window: string;
  completed_at: Date | null;
  step_label: string | null;
};
export type PortalInvoice = { id: string; number: number | null; status: string; issued_on: string | null; due_on: string | null; total_cents: number; paid_cents: number; property_id: string | null };
export type PortalMethod = { id: string; kind: string; brand: string | null; last4: string; exp_month: number | null; exp_year: number | null; autopay: boolean; is_default: boolean };
export type PortalNotice = { id: string; kind: string; channel: string | null; status: string; sent_at: Date | null; created_at: Date; property_id: string | null };
export type PortalRequest = { id: string; kind: string; status: string; property_id: string; details: string | null; preferred_date: string | null; response: string | null; created_at: Date; service: string | null };
export type PortalProperty = { id: string; name: string | null; address: string; has_site: boolean; agreement_id: string | null; agreement_number: number | null };
export type PortalSettings = { allow_reschedule: boolean; reschedule_notice_hours: number; max_stops_per_day: number; allow_requests: boolean; requestable: { id: string; name: string }[] };

export type Overview = {
  properties: PortalProperty[];
  upcoming: PortalVisit[];
  recent: PortalVisit[];
  open: PortalInvoice[];
  paid: PortalInvoice[];
  balance_cents: number;
  methods: PortalMethod[];
  notices: PortalNotice[];
  requests: PortalRequest[];
  settings: PortalSettings;
};

const VISIT_COLUMNS = (tx: Sql) => tx`
  select v.id, v.property_id, p.normalized_address as address, st.name as service, v.kind, v.status, v.due_start::text, v.due_end::text, v.scheduled_for::text,
         v.arrival_window, v.completed_at, v.step_label
  from public.visits v join public.properties p on p.id = v.property_id join public.service_types st on st.id = v.service_type_id`;

export async function portalSettings(tx: Sql, tenantId: string): Promise<PortalSettings> {
  const [s] = await tx<{ allow_reschedule: boolean; reschedule_notice_hours: number; max_stops_per_day: number; allow_requests: boolean; requestable_service_type_ids: string[] }[]>`
    select allow_reschedule, reschedule_notice_hours, max_stops_per_day, allow_requests, requestable_service_type_ids from public.portal_settings where tenant_id = ${tenantId}`;
  const ids = s?.requestable_service_type_ids ?? [];
  const requestable = ids.length
    ? await tx<{ id: string; name: string }[]>`select id, name from public.service_types where tenant_id = ${tenantId} and id = any(${ids}::uuid[]) and archived_at is null order by name`
    : [];
  return {
    allow_reschedule: s?.allow_reschedule ?? false,
    reschedule_notice_hours: s?.reschedule_notice_hours ?? 24,
    max_stops_per_day: s?.max_stops_per_day ?? 18,
    allow_requests: s?.allow_requests ?? true,
    requestable,
  };
}

export async function portalProperties(tx: Sql, identity: PortalIdentity): Promise<PortalProperty[]> {
  return tx<PortalProperty[]>`
    select p.id, p.name, p.normalized_address as address,
           (exists (select 1 from public.site_maps m where m.property_id = p.id and m.archived_at is null) or exists (select 1 from public.devices d where d.property_id = p.id and d.status = 'active')) as has_site,
           g.id as agreement_id, g.number as agreement_number
    from public.properties p
      left join lateral (select a.id, a.number from public.agreements a where a.property_id = p.id and a.status = 'active' order by a.starts_on desc limit 1) g on true
    where p.tenant_id = ${identity.tenant_id} and p.account_id = ${identity.account_id} and p.archived_at is null
      and (${identity.property_ids}::uuid[] is null or p.id = any(${identity.property_ids}::uuid[]))
    order by p.created_at`;
}

export async function overview(tx: Sql, identity: PortalIdentity): Promise<Overview> {
  const t = identity.tenant_id;
  const today = todayInZone(identity.tenant_timezone);
  const properties = await portalProperties(tx, identity);
  // Row level security already limits a portal identity; these filters keep the page right for a customer who is also staff.
  const ids = properties.map((p) => p.id);
  const upcoming = await tx<PortalVisit[]>`
    ${VISIT_COLUMNS(tx)} where v.tenant_id = ${t} and v.account_id = ${identity.account_id} and v.property_id = any(${ids}::uuid[]) and v.status in ('planned', 'scheduled', 'en_route', 'in_progress') and v.due_end >= ${today}
    order by coalesce(v.scheduled_for, v.due_start), v.sequence limit 12`;
  const recent = await tx<PortalVisit[]>`
    ${VISIT_COLUMNS(tx)} where v.tenant_id = ${t} and v.account_id = ${identity.account_id} and v.property_id = any(${ids}::uuid[]) and v.status = 'completed' and not v.imported
    order by v.completed_at desc limit 12`;
  const invoices = (
    await tx<(Omit<PortalInvoice, "total_cents" | "paid_cents"> & { total_cents: string; paid_cents: string })[]>`
      select id, number, status, issued_on::text, due_on::text, total_cents, paid_cents, property_id from public.invoices
      where tenant_id = ${t} and account_id = ${identity.account_id} and kind = 'invoice' and status not in ('void', 'draft')
        and (property_id is null or property_id = any(${ids}::uuid[]))
      order by issued_on desc nulls last, number desc limit 40`
  ).map((i) => ({ ...i, total_cents: Number(i.total_cents), paid_cents: Number(i.paid_cents) }));
  const open = invoices.filter((i) => ["issued", "partially_paid", "past_due"].includes(i.status) && i.total_cents > i.paid_cents);
  const methods = await tx<PortalMethod[]>`
    select id, kind, brand, last4, exp_month, exp_year, autopay, is_default from public.payment_methods
    where tenant_id = ${t} and account_id = ${identity.account_id} and status = 'active' order by is_default desc, created_at desc`;
  const notices = await tx<PortalNotice[]>`
    select n.id, n.kind, n.channel, n.status, n.sent_at, n.created_at, n.property_id from public.notices n
    where n.tenant_id = ${t} and n.status = 'sent' and n.kind <> 'registry_advance' and n.property_id = any(${ids}::uuid[])
      and (exists (select 1 from public.contacts c where c.id = n.recipient_contact_id and c.account_id = ${identity.account_id})
           or (n.recipient_contact_id is null and n.channel = 'posted'))
    order by coalesce(n.sent_at, n.created_at) desc limit 12`;
  const requests = await tx<PortalRequest[]>`
    select r.id, r.kind, r.status, r.property_id, r.details, r.preferred_date::text, r.response, r.created_at, st.name as service
    from public.service_requests r left join public.service_types st on st.id = r.service_type_id
    where r.tenant_id = ${t} and r.account_id = ${identity.account_id} order by r.created_at desc limit 20`;
  return {
    properties,
    upcoming,
    recent,
    open,
    paid: invoices.filter((i) => i.status === "paid").slice(0, 8),
    balance_cents: open.reduce((s, i) => s + i.total_cents - i.paid_cents, 0),
    methods,
    notices,
    requests,
    settings: await portalSettings(tx, t),
  };
}

export type VisitDetail = PortalVisit & {
  technician: string | null;
  record: RecordSnapshot | null;
  agreement_id: string | null;
  technician_id: string | null;
};

/** One visit with what was applied (the application record as amended, spec 07) and who served it. */
export async function visitDetail(tx: Sql, identity: PortalIdentity, visitId: string): Promise<VisitDetail | null> {
  const [v] = await tx<(PortalVisit & { technician_id: string | null; agreement_id: string | null })[]>`
    ${VISIT_COLUMNS(tx)} where v.id = ${visitId} and v.tenant_id = ${identity.tenant_id} and v.account_id = ${identity.account_id}`;
  if (!v) return null;
  const [rec] = await tx<{ id: string; snapshot: RecordSnapshot }[]>`select id, snapshot from public.application_records where visit_id = ${visitId}`;
  const amendments = rec ? await tx<Amendment[]>`select changed_fields from public.application_record_amendments where record_id = ${rec.id} order by created_at` : [];
  const names = await staffNames(tx, identity.tenant_id);
  const [ids] = await tx<{ technician_id: string | null; agreement_id: string | null }[]>`select technician_id, agreement_id from public.visits where id = ${visitId}`;
  return {
    ...v,
    technician_id: ids?.technician_id ?? null,
    agreement_id: ids?.agreement_id ?? null,
    technician: ids?.technician_id ? (names.get(ids.technician_id) ?? null) : null,
    record: rec ? (applyAmendments(rec.snapshot as unknown as Record<string, unknown>, amendments) as unknown as RecordSnapshot) : null,
  };
}

export async function staffNames(tx: Sql, tenantId: string): Promise<Map<string, string>> {
  const rows = await tx<{ user_id: string; name: string }[]>`select user_id, name from app.portal_staff_names(${tenantId})`;
  return new Map(rows.map((r) => [r.user_id, r.name]));
}

export type InvoiceDetail = PortalInvoice & {
  lines: { description: string; amount_cents: number; tax_cents: number }[];
  payments: { id: string; amount_cents: number; received_at: Date; method: string; status: string }[];
  tax_cents: number;
  memo: string | null;
};

export async function invoiceDetail(tx: Sql, identity: PortalIdentity, invoiceId: string): Promise<InvoiceDetail | null> {
  const [inv] = await tx<(Omit<InvoiceDetail, "lines" | "payments" | "total_cents" | "paid_cents" | "tax_cents"> & { total_cents: string; paid_cents: string; tax_cents: string })[]>`
    select id, number, status, issued_on::text, due_on::text, total_cents, paid_cents, tax_cents, property_id, memo from public.invoices
    where id = ${invoiceId} and tenant_id = ${identity.tenant_id} and account_id = ${identity.account_id} and kind = 'invoice'`;
  if (!inv) return null;
  const lines = await tx<{ description: string; amount_cents: string; tax_cents: string }[]>`
    select description, amount_cents, tax_cents from public.invoice_lines where invoice_id = ${invoiceId} order by position`;
  const payments = await tx<{ id: string; amount_cents: string; received_at: Date; method: string; status: string }[]>`
    select p.id, a.amount_cents, p.received_at, p.method, p.status from public.payment_allocations a join public.payments p on p.id = a.payment_id
    where a.invoice_id = ${invoiceId} order by p.received_at`;
  return {
    ...inv,
    total_cents: Number(inv.total_cents),
    paid_cents: Number(inv.paid_cents),
    tax_cents: Number(inv.tax_cents),
    lines: lines.map((l) => ({ description: l.description, amount_cents: Number(l.amount_cents), tax_cents: Number(l.tax_cents) })),
    payments: payments.map((p) => ({ ...p, amount_cents: Number(p.amount_cents) })),
  };
}
