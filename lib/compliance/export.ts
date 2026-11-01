// The inspector export (spec 07 rule 13): every record, amendment, notice and license for a date range and state, as
// CSV files plus a printable binder, zipped into one file. Columns are fixed; a state pack's own report format is
// added beside them when a state ships one.
import { strToU8, zipSync } from "fflate";
import type postgres from "postgres";
import { type Amendment, applyAmendments, type RecordSnapshot } from "@/lib/compliance/records";
import { listMembers } from "@/lib/dispatch/db";

type Sql = postgres.Sql | postgres.TransactionSql;

export type ExportRange = { from: string; to: string; state: string | null };
export type ExportFile = { name: string; bytes: Uint8Array };

/** One CSV cell: quoted when it holds a comma, a quote or a line break; arrays joined with "; ". */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) ? value.join("; ") : value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n") + "\r\n";
}

type RecordRow = {
  id: string;
  visit_id: string;
  state_code: string;
  pack_version: string | null;
  job_kind: string;
  business_date: string;
  status: string;
  locked_at: string | null;
  complete: boolean;
  missing_fields: string[];
  retention_until: string | null;
  snapshot: RecordSnapshot;
};

type AmendmentRow = { record_id: string; created_at: string; author_id: string; reason: string; changed_fields: Record<string, { from: unknown; to: unknown }> };

type NoticeRow = {
  id: string;
  kind: string;
  required: boolean;
  rule_key: string;
  visit_id: string | null;
  recipient_name: string;
  recipient_address: string | null;
  channel: string;
  due_by: string | null;
  status: string;
  sent_at: string | null;
  proof: Record<string, unknown>;
  waived_reason: string | null;
  created_at: string;
};

type CredentialRow = {
  user_id: string;
  state_code: string;
  cert_number: string | null;
  categories: string[];
  cert_expires_on: string | null;
  license_number: string | null;
  license_expires_on: string | null;
  license_year: number | null;
  trainee_registered_on: string | null;
  supervisor_id: string | null;
  archived_at: string | null;
};

type BranchRow = { name: string; state_code: string; business_license_number: string | null; license_year: number | null; license_expires_on: string | null };

export const EXPORT_FILES = ["records.csv", "record_products.csv", "amendments.csv", "notices.csv", "credentials.csv", "branch_licenses.csv", "binder.html"] as const;

/** Builds the files for the range. The caller logs the export and zips the result. */
export async function buildInspectorExport(tx: Sql, tenantId: string, range: ExportRange, tenantName: string): Promise<ExportFile[]> {
  const names = new Map((await listMembers(tx, tenantId)).map((m) => [m.user_id, m.name]));
  const who = (id: string | null) => (id ? (names.get(id) ?? id) : "");
  const state = range.state;
  const records = await tx<RecordRow[]>`
    select id, visit_id, state_code, pack_version, job_kind, business_date, status, locked_at, complete, missing_fields, retention_until, snapshot
    from public.application_records
    where tenant_id = ${tenantId} and business_date between ${range.from} and ${range.to} and (${state}::text is null or state_code = ${state})
    order by business_date, locked_at`;
  const recordIds = records.map((r) => r.id);
  const amendments = recordIds.length
    ? await tx<AmendmentRow[]>`select record_id, created_at, author_id, reason, changed_fields from public.application_record_amendments where tenant_id = ${tenantId} and record_id = any(${recordIds}::uuid[]) order by created_at`
    : [];
  const byRecord = new Map<string, AmendmentRow[]>();
  for (const a of amendments) byRecord.set(a.record_id, [...(byRecord.get(a.record_id) ?? []), a]);
  const current = new Map(records.map((r) => [r.id, applyAmendments(r.snapshot as unknown as Record<string, unknown>, (byRecord.get(r.id) ?? []) as Amendment[]) as unknown as RecordSnapshot]));

  const notices = await tx<NoticeRow[]>`
    select n.id, n.kind, n.required, n.rule_key, n.visit_id, n.recipient_name, n.recipient_address, n.channel, n.due_by, n.status, n.sent_at, n.proof, n.waived_reason, n.created_at
    from public.notices n join public.properties p on p.id = n.property_id
    where n.tenant_id = ${tenantId} and (n.created_at at time zone 'UTC')::date between ${range.from} and ${range.to} and (${state}::text is null or p.state_code = ${state})
    order by n.created_at`;
  const credentials = await tx<CredentialRow[]>`
    select user_id, state_code, cert_number, categories, cert_expires_on, license_number, license_expires_on, license_year, trainee_registered_on, supervisor_id, archived_at
    from public.applicator_credentials
    where tenant_id = ${tenantId} and (archived_at is null or archived_at >= ${range.from}::date) and (${state}::text is null or state_code = ${state})
    order by state_code, user_id`;
  const branches = await tx<BranchRow[]>`
    select name, state_code, business_license_number, license_year, license_expires_on from public.branches
    where tenant_id = ${tenantId} and archived_at is null and (${state}::text is null or state_code = ${state}) order by name`;

  const recordsCsv = toCsv(
    ["record_id", "visit_id", "business_date", "state", "status", "locked_at", "complete", "missing_fields", "account", "property_address", "service_type", "job_kind", "arrived_at", "departed_at", "crew", "areas_treated", "target_pests", "conditions", "pack_version", "retention_until", "amendments"],
    records.map((r) => {
      const s = current.get(r.id) as RecordSnapshot;
      return [
        r.id, r.visit_id, r.business_date, r.state_code, r.status, r.locked_at, r.complete, r.missing_fields, s.account.name,
        s.property.address, s.service_type.name, r.job_kind, s.arrived_at, s.departed_at,
        s.crew.map((c) => `${c.name} (${c.role}${c.cert_number ? `, ${c.cert_number}` : ""}${c.trainee ? ", trainee" : ""})`), s.areas_treated, s.target_pests, s.conditions, r.pack_version, r.retention_until,
        (byRecord.get(r.id) ?? []).length,
      ];
    }),
  );
  const productsCsv = toCsv(
    ["record_id", "business_date", "product", "epa_reg_no", "amount", "amount_unit", "carrier_amount", "carrier_unit", "site_treated", "location", "target_pests", "label_check", "applied_by", "applied_by_cert"],
    records.flatMap((r) => {
      const s = current.get(r.id) as RecordSnapshot;
      return s.products.map((p) => [r.id, r.business_date, p.product_name, p.epa_reg_no, p.amount, p.amount_unit, p.carrier_amount, p.carrier_unit, p.site_treated, p.location_description, p.target_pests, p.label_check?.status ?? "", p.applied_by.name, p.applied_by.cert_number]);
    }),
  );
  const amendmentsCsv = toCsv(
    ["record_id", "amended_at", "author", "reason", "field", "from", "to"],
    amendments.flatMap((a) => Object.entries(a.changed_fields).map(([field, change]) => [a.record_id, a.created_at, who(a.author_id), a.reason, field, change.from, change.to])),
  );
  const noticesCsv = toCsv(
    ["notice_id", "kind", "required", "rule", "visit_id", "recipient", "recipient_address", "channel", "due_by", "status", "sent_at", "proof", "waived_reason", "created_at"],
    notices.map((n) => [n.id, n.kind, n.required, n.rule_key, n.visit_id, n.recipient_name, n.recipient_address, n.channel, n.due_by, n.status, n.sent_at, n.proof, n.waived_reason, n.created_at]),
  );
  const credentialsCsv = toCsv(
    ["person", "state", "cert_number", "categories", "cert_expires_on", "license_number", "license_expires_on", "license_year", "trainee_registered_on", "supervisor", "archived_at"],
    credentials.map((c) => [who(c.user_id), c.state_code, c.cert_number, c.categories, c.cert_expires_on, c.license_number, c.license_expires_on, c.license_year, c.trainee_registered_on, who(c.supervisor_id), c.archived_at]),
  );
  const branchesCsv = toCsv(["branch", "state", "license_number", "license_year", "license_expires_on"], branches.map((b) => [b.name, b.state_code, b.business_license_number, b.license_year, b.license_expires_on]));

  const esc = (v: unknown) => String(v ?? "").replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch] as string);
  const binder = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Inspection binder ${esc(range.from)} to ${esc(range.to)}</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#1c1917}h1,h2{margin:16px 0 8px}table{border-collapse:collapse;width:100%;font-size:12px;margin-bottom:16px}th,td{border:1px solid #d6d3d1;padding:4px 6px;text-align:left;vertical-align:top}th{background:#f5f5f4}p{margin:4px 0}@media print{h2{page-break-before:always}}</style></head>
<body>
<h1>${esc(tenantName)}: pesticide application records, notices and licenses</h1>
<p>Business dates ${esc(range.from)} to ${esc(range.to)}${state ? `, state ${esc(state)}` : ", all states"}. ${records.length} record(s), ${amendments.length} amendment(s), ${notices.length} notice(s), ${credentials.length} credential(s), ${branches.length} branch(es). Files in this export: ${EXPORT_FILES.join(", ")}.</p>
${records.length === 0 ? "<p>No application records have a business date in this range.</p>" : ""}
${records
  .map((r) => {
    const s = current.get(r.id) as RecordSnapshot;
    const changes = byRecord.get(r.id) ?? [];
    return `<h2>Record ${esc(r.business_date)}: ${esc(s.account.name)}, ${esc(s.property.address)}</h2>
<p>${esc(s.service_type.name)} (${esc(r.job_kind)}). ${r.status === "locked" ? `Locked ${esc(r.locked_at)}` : "Draft"}. ${r.complete ? "Complete." : `Missing: ${esc(r.missing_fields.join(", "))}.`} Arrived ${esc(s.arrived_at)}, departed ${esc(s.departed_at)} (${esc(s.time_zone)}). Pack ${esc(r.pack_version ?? "none")}; retained until ${esc(r.retention_until ?? "further notice")}.</p>
<p>Crew: ${esc(s.crew.map((c) => `${c.name}, ${c.role}${c.cert_number ? `, ${c.cert_number}` : ""}${c.trainee ? ", trainee" : ""}`).join("; "))}</p>
<p>Areas: ${esc(s.areas_treated.join(", "))}. Target pests: ${esc(s.target_pests.join(", "))}. Conditions: ${esc(s.conditions ? JSON.stringify(s.conditions) : "none")}.</p>
<table><thead><tr><th>Product</th><th>EPA</th><th>Amount</th><th>Site</th><th>Pests</th><th>Applied by</th><th>Label</th></tr></thead><tbody>
${s.products.map((p) => `<tr><td>${esc(p.product_name)}</td><td>${esc(p.epa_reg_no)}</td><td>${esc(p.amount)} ${esc(p.amount_unit)}${p.carrier_amount ? ` / ${esc(p.carrier_amount)} ${esc(p.carrier_unit)}` : ""}</td><td>${esc(p.site_treated)}${p.location_description ? ` (${esc(p.location_description)})` : ""}</td><td>${esc(p.target_pests.join(", "))}</td><td>${esc(p.applied_by.name)}${p.applied_by.cert_number ? ` (${esc(p.applied_by.cert_number)})` : ""}</td><td>${esc(p.label_check?.status ?? "")}</td></tr>`).join("")}
</tbody></table>
${changes.length ? `<table><thead><tr><th>Amended</th><th>By</th><th>Reason</th><th>Field</th><th>From</th><th>To</th></tr></thead><tbody>${changes.flatMap((a) => Object.entries(a.changed_fields).map(([field, c]) => `<tr><td>${esc(a.created_at)}</td><td>${esc(who(a.author_id))}</td><td>${esc(a.reason)}</td><td>${esc(field)}</td><td>${esc(JSON.stringify(c.from))}</td><td>${esc(JSON.stringify(c.to))}</td></tr>`)).join("")}</tbody></table>` : ""}`;
  })
  .join("\n")}
<h2>Notices</h2>
${notices.length === 0 ? "<p>No notices were created in this range.</p>" : `<table><thead><tr><th>Kind</th><th>Required</th><th>Recipient</th><th>Channel</th><th>Due</th><th>Status</th><th>Sent</th><th>Proof</th></tr></thead><tbody>${notices.map((n) => `<tr><td>${esc(n.kind)}</td><td>${n.required ? "yes" : "best practice"}</td><td>${esc(n.recipient_name)}</td><td>${esc(n.channel)}</td><td>${esc(n.due_by)}</td><td>${esc(n.status)}</td><td>${esc(n.sent_at)}</td><td>${esc(JSON.stringify(n.proof))}</td></tr>`).join("")}</tbody></table>`}
<h2>Credentials and licenses</h2>
<table><thead><tr><th>Person</th><th>State</th><th>Certification</th><th>Categories</th><th>Cert expires</th><th>License</th><th>License expires</th><th>Trainee since</th></tr></thead><tbody>${credentials.map((c) => `<tr><td>${esc(who(c.user_id))}</td><td>${esc(c.state_code)}</td><td>${esc(c.cert_number)}</td><td>${esc(c.categories.join(", "))}</td><td>${esc(c.cert_expires_on)}</td><td>${esc(c.license_number)}</td><td>${esc(c.license_expires_on)}</td><td>${esc(c.trainee_registered_on)}</td></tr>`).join("")}</tbody></table>
<table><thead><tr><th>Branch</th><th>State</th><th>Business license</th><th>License year</th><th>Expires</th></tr></thead><tbody>${branches.map((b) => `<tr><td>${esc(b.name)}</td><td>${esc(b.state_code)}</td><td>${esc(b.business_license_number)}</td><td>${esc(b.license_year)}</td><td>${esc(b.license_expires_on)}</td></tr>`).join("")}</tbody></table>
</body></html>
`;

  return [
    { name: "records.csv", bytes: strToU8(recordsCsv) },
    { name: "record_products.csv", bytes: strToU8(productsCsv) },
    { name: "amendments.csv", bytes: strToU8(amendmentsCsv) },
    { name: "notices.csv", bytes: strToU8(noticesCsv) },
    { name: "credentials.csv", bytes: strToU8(credentialsCsv) },
    { name: "branch_licenses.csv", bytes: strToU8(branchesCsv) },
    { name: "binder.html", bytes: strToU8(binder) },
  ];
}

/** One zip holding every file. */
export function zipFiles(files: readonly ExportFile[]): Uint8Array {
  return zipSync(Object.fromEntries(files.map((f) => [f.name, f.bytes])), { level: 6 });
}
