// Spec 12 seed: one shared saved report per company (the owner's completed visits by technician) and one private
// report of the office manager's, so the isolation suite has rows to test against. Idempotent. Called from seed.ts.
import type postgres from "postgres";
import type { Definition } from "../lib/reports/builder";
import type { SeedTenant } from "./seed-data";
import { seedUserEmail } from "./seed-data";

type Sql = postgres.Sql;

const BY_TECHNICIAN: Definition = { columns: [], filters: [{ column: "status", op: "eq", value: "completed" }], group_by: ["technician"], aggregates: [{ fn: "count" }, { fn: "sum", column: "price" }], sort: { column: "count", dir: "desc" }, limit: null };
const OPEN_INVOICES: Definition = { columns: ["number", "account", "due_on", "open"], filters: [{ column: "open", op: "gt", value: "0" }], group_by: [], aggregates: [], sort: { column: "due_on", dir: "asc" }, limit: null };

export async function seedReports(sql: Sql, tenant: SeedTenant, tenantId: string): Promise<void> {
  const users = await sql<{ id: string; email: string }[]>`select id, email from auth.users where email in ${sql([seedUserEmail(tenant, "owner"), seedUserEmail(tenant, "office")])}`;
  const owner = users.find((u) => u.email === seedUserEmail(tenant, "owner"));
  const office = users.find((u) => u.email === seedUserEmail(tenant, "office"));
  const rows = [
    { name: "Completed visits by technician", dataset: "visits", definition: BY_TECHNICIAN, shared: true, by: owner?.id },
    { name: "Open invoices by due date", dataset: "invoices", definition: OPEN_INVOICES, shared: false, by: office?.id },
  ];
  for (const r of rows) {
    if (!r.by) continue;
    await sql`
      insert into public.saved_reports (tenant_id, name, dataset, definition, shared, created_by)
      select ${tenantId}, ${r.name}, ${r.dataset}, ${sql.json(r.definition as never)}, ${r.shared}, ${r.by}
      where not exists (select 1 from public.saved_reports where tenant_id = ${tenantId} and name = ${r.name})`;
  }
}
