// Spec 13 seed: one past support grant per company, approved by its owner and long expired, with one logged page, so
// the isolation suite has rows to test and the support page has history. Idempotent. Called from seed.ts.
import type postgres from "postgres";
import type { SeedTenant } from "./seed-data";
import { PLATFORM_ADMIN_EMAIL, seedUserEmail } from "./seed-data";

type Sql = postgres.Sql;

export async function seedPlatform(sql: Sql, tenant: SeedTenant, tenantId: string): Promise<void> {
  const [admin] = await sql<{ id: string; email: string }[]>`select id, email from auth.users where email = ${PLATFORM_ADMIN_EMAIL}`;
  const [owner] = await sql<{ id: string }[]>`select id from auth.users where email = ${seedUserEmail(tenant, "owner")}`;
  if (!admin || !owner) return;
  const [existing] = await sql<{ id: string }[]>`select id from public.support_grants where tenant_id = ${tenantId} and reason like 'seed:%' limit 1`;
  if (existing) return;
  const [grant] = await sql<{ id: string }[]>`
    insert into public.support_grants (tenant_id, user_id, user_email, access, reason, hours, requested_at, approved, decided_at, decided_by, expires_at)
    values (${tenantId}, ${admin.id}, ${admin.email}, 'read', 'seed: checking why the April statements printed without a footer', 2,
            now() - interval '30 days', true, now() - interval '30 days' + interval '10 minutes', ${owner.id}, now() - interval '30 days' + interval '130 minutes')
    returning id`;
  await sql`
    insert into public.support_access_log (tenant_id, grant_id, user_id, path, method, created_at)
    values (${tenantId}, ${grant.id}, ${admin.id}, '/billing/settings', 'GET', now() - interval '30 days' + interval '15 minutes')`;
}
