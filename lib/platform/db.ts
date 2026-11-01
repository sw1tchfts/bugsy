// Platform operations (spec 13): support grants and their log, the setup checklist, the console's overview and state
// coverage, and the full company export. Every query runs on the caller's connection, so a member sees their own
// company's grants and log, and platform staff see only what the definer functions give them.
import { strToU8 } from "fflate";
import type postgres from "postgres";
import { csvCell } from "@/lib/compliance/export";
import type { OnboardingStatus } from "./onboarding";
import { type GrantAccess, type GrantState, grantState } from "./support";

type Sql = postgres.Sql | postgres.TransactionSql;

export type Grant = {
  id: string;
  tenant_id: string;
  tenant_name: string;
  user_email: string;
  access: GrantAccess;
  reason: string;
  hours: number;
  requested_at: Date;
  approved: boolean | null;
  decided_at: Date | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  state: GrantState;
};

async function grants(tx: Sql, where: "tenant" | "mine", id: string | null): Promise<Grant[]> {
  const rows = await tx<Omit<Grant, "state">[]>`
    select g.id, g.tenant_id, t.name as tenant_name, g.user_email, g.access, g.reason, g.hours, g.requested_at, g.approved, g.decided_at, g.expires_at, g.revoked_at
    from public.support_grants g join public.tenants t on t.id = g.tenant_id
    where ${where === "tenant" ? tx`g.tenant_id = ${id}` : tx`g.user_id = auth.uid()`}
    order by g.requested_at desc limit 200`;
  const now = new Date();
  return rows.map((r) => ({ ...r, state: grantState(r, now) }));
}

/** A company's grants, newest first (its owners and audit.read members; row level security decides). */
export function grantsFor(tx: Sql, tenantId: string): Promise<Grant[]> {
  return grants(tx, "tenant", tenantId);
}

/** The signed-in platform admin's own requests and grants across companies. */
export function myGrants(tx: Sql): Promise<Grant[]> {
  return grants(tx, "mine", null);
}

export type AccessLogRow = { at: Date; user_email: string; path: string; method: string; access: GrantAccess };

export async function accessLog(tx: Sql, tenantId: string, limit = 200): Promise<AccessLogRow[]> {
  return tx<AccessLogRow[]>`
    select l.created_at as at, g.user_email, l.path, l.method, g.access from public.support_access_log l join public.support_grants g on g.id = l.grant_id
    where l.tenant_id = ${tenantId} order by l.created_at desc limit ${limit}`;
}

export async function requestSupport(tx: Sql, tenantId: string, access: GrantAccess, hours: number, reason: string): Promise<string> {
  const [row] = await tx<{ id: string }[]>`select app.request_support(${tenantId}, ${access}, ${hours}, ${reason}) as id`;
  return row.id;
}

export async function decideSupport(tx: Sql, grantId: string, approve: boolean): Promise<void> {
  await tx`select app.decide_support(${grantId}, ${approve})`;
}

export async function revokeSupport(tx: Sql, grantId: string): Promise<void> {
  await tx`select app.revoke_support(${grantId})`;
}

export async function onboardingStatus(tx: Sql, tenantId: string): Promise<OnboardingStatus> {
  const [row] = await tx<{ status: OnboardingStatus }[]>`select app.onboarding_status(${tenantId}) as status`;
  return row.status;
}

export type OverviewRow = {
  tenant_id: string;
  name: string;
  status: string;
  status_reason: string | null;
  created_at: Date;
  archived_at: Date | null;
  members: number;
  accounts: number;
  active_agreements: number;
  visits_30: number;
  last_activity: Date | null;
  onboarding: OnboardingStatus;
  imported_on: Date | null;
  first_route_on: Date | null;
  open_support: number;
};

export function platformOverview(tx: Sql): Promise<OverviewRow[]> {
  return tx<OverviewRow[]>`select * from app.platform_overview()`;
}

export function stateCoverage(tx: Sql): Promise<{ state_code: string; companies: number; properties: number }[]> {
  return tx<{ state_code: string; companies: number; properties: number }[]>`select * from app.state_coverage()`;
}

/** Whole days from the first committed import to the first completed route (the PRD's go-live metric). */
export function daysToFirstRoute(row: Pick<OverviewRow, "imported_on" | "first_route_on">): number | null {
  if (!row.imported_on || !row.first_route_on || row.first_route_on < row.imported_on) return null;
  return Math.floor((row.first_route_on.getTime() - row.imported_on.getTime()) / 86_400_000);
}

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf", "text/csv": "csv", "image/svg+xml": "svg" };

/**
 * Rule 11: everything the company holds, run under the owner's session. Every table with the company's rows as a CSV of
 * its stored columns (file contents aside), each file's bytes under files/, and a README of tables and row counts.
 */
export async function exportCompany(tx: Sql, tenantId: string, companyName: string): Promise<Record<string, Uint8Array>> {
  const tables = await tx<{ table_name: string; columns: string[] }[]>`
    select c.table_name, array_agg(c.column_name::text order by c.ordinal_position) filter (where c.data_type <> 'bytea') as columns
    from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.table_name and k.column_name = 'tenant_id')
    group by c.table_name order by c.table_name`;
  const out: Record<string, Uint8Array> = {};
  const readme = [`${companyName}: full data export`, `Made ${new Date().toISOString()}.`, "", "One CSV per table, every column as stored: money in integer cents, timestamps in UTC, business dates as YYYY-MM-DD.", "Photos, signatures and documents are under files/, named by their id in files.csv.", "", "Tables:"];
  for (const t of tables) {
    const quoted = t.columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ");
    const rows = (await tx.unsafe(`select ${quoted} from public."${t.table_name.replace(/"/g, '""')}" where tenant_id = $1`, [tenantId])) as unknown as Record<string, unknown>[];
    const lines = [t.columns.map(csvCell).join(","), ...rows.map((r) => t.columns.map((c) => csvCell(r[c])).join(","))];
    out[`${t.table_name}.csv`] = strToU8(`${lines.join("\r\n")}\r\n`);
    readme.push(`  ${t.table_name}.csv: ${rows.length} row(s)`);
  }
  const files = await tx<{ id: string; content_type: string; data: Buffer }[]>`select id, content_type, data from public.files where tenant_id = ${tenantId} order by created_at`;
  for (const f of files) out[`files/${f.id}.${EXTENSIONS[f.content_type] ?? "bin"}`] = new Uint8Array(f.data);
  readme.push("", `files/: ${files.length} file(s)`);
  out["README.txt"] = strToU8(`${readme.join("\n")}\n`);
  return out;
}
