// Seeds two demo tenants with branches, roles and one user per role, plus a platform admin.
// Idempotent: run it again after `supabase db reset` or whenever you want the demo data back.
//
// Users are created through Supabase Auth's admin API when an auth server is reachable (the Supabase local
// stack, hosted Supabase, or a standalone GoTrue), so they can sign in with SEED_PASSWORD. Without an auth
// server the script inserts bare auth.users rows, which is enough for the database tests.

import { config as loadEnv } from "dotenv";
import postgres from "postgres";
import { PG_TYPES } from "../lib/pg-types";
import { seedAgreements } from "./seed-agreements";
import { seedCatalog, seedMasterProducts } from "./seed-catalog";
import { seedDispatch } from "./seed-dispatch";
import { seedCustomers } from "./seed-customers";
import {
  CROSS_TENANT_USER,
  PLATFORM_ADMIN_EMAIL,
  ROLE_KEYS,
  SEED_PASSWORD,
  SEED_TENANTS,
  type SeedTenant,
  seedUserEmail,
} from "./seed-data";

loadEnv({ path: ".env.local" });
loadEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {}, types: PG_TYPES });

/** Master product ids by EPA registration number, filled once before the tenants are seeded. */
let masterProductIds = new Map<string, string>();

const authUrl =
  process.env.SUPABASE_AUTH_INTERNAL_URL ??
  (process.env.NEXT_PUBLIC_SUPABASE_URL ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1` : undefined);
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function authServerReachable(): Promise<boolean> {
  if (!authUrl || !serviceRoleKey) return false;
  try {
    const res = await fetch(`${authUrl}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureUser(email: string, useAuthServer: boolean): Promise<string> {
  const [existing] = await sql<{ id: string }[]>`select id from auth.users where email = ${email}`;
  if (existing) return existing.id;

  if (useAuthServer) {
    const res = await fetch(`${authUrl}/admin/users`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey!,
      },
      body: JSON.stringify({ email, password: SEED_PASSWORD, email_confirm: true }),
    });
    if (!res.ok) throw new Error(`creating ${email} failed: ${res.status} ${await res.text()}`);
    const user = (await res.json()) as { id: string };
    return user.id;
  }

  const [row] = await sql<{ id: string }[]>`
    insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (gen_random_uuid(), 'authenticated', 'authenticated', ${email}, now(),
            '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
    returning id`;
  return row.id;
}

async function seedTenant(tenant: SeedTenant, useAuthServer: boolean) {
  // Tenant names are not unique in the schema, so look the demo company up by name before creating it.
  const [existing] = await sql<{ id: string }[]>`select id from public.tenants where name = ${tenant.name} order by created_at limit 1`;
  const tenantId =
    existing?.id ??
    (
      await sql<{ id: string }[]>`
        insert into public.tenants (name, legal_name, timezone) values (${tenant.name}, ${tenant.legalName}, ${tenant.timezone}) returning id`
    )[0].id;

  for (const b of tenant.branches) {
    await sql`
      insert into public.branches (tenant_id, name, address, state_code)
      values (${tenantId}, ${b.name}, ${b.address}, ${b.stateCode})
      on conflict (tenant_id, name) do update set address = excluded.address, state_code = excluded.state_code`;
  }

  await sql`
    insert into public.roles (tenant_id, key, name, permissions)
    values (${tenantId}, ${tenant.customRole.key}, ${tenant.customRole.name}, ${tenant.customRole.permissions})
    on conflict ((coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)), key) do nothing`;

  const defaultRoles = await sql<{ id: string; key: string }[]>`select id, key from public.roles where tenant_id is null`;
  const roleId = (key: string) => {
    const role = defaultRoles.find((r) => r.key === key);
    if (!role) throw new Error(`default role ${key} is missing; run the migrations first`);
    return role.id;
  };

  for (const key of ROLE_KEYS) {
    const userId = await ensureUser(seedUserEmail(tenant, key), useAuthServer);
    await sql`
      insert into public.memberships (tenant_id, user_id, role_id)
      values (${tenantId}, ${userId}, ${roleId(key)})
      on conflict (tenant_id, user_id) do update set role_id = excluded.role_id`;
  }

  const [pending] = await sql<{ id: string }[]>`
    select id from public.invitations where tenant_id = ${tenantId} and email = ${tenant.pendingInviteEmail} and accepted_at is null`;
  if (!pending) {
    await sql`
      insert into public.invitations (tenant_id, email, role_id)
      values (${tenantId}, ${tenant.pendingInviteEmail}, ${roleId("technician")})`;
  }

  const [ownerUser] = await sql<{ id: string }[]>`select id from auth.users where email = ${seedUserEmail(tenant, "owner")}`;
  await seedCustomers(sql, tenant, tenantId, ownerUser.id);
  await seedCatalog(sql, tenant, tenantId, masterProductIds);
  await seedAgreements(sql, tenant, tenantId, ownerUser.id);
  await seedDispatch(sql, tenant, tenantId, SEED_TENANTS.indexOf(tenant));

  console.log(`seeded ${tenant.name} (${tenantId})`);
}

async function main() {
  const useAuthServer = await authServerReachable();
  console.log(useAuthServer ? `creating users through ${authUrl}` : "no auth server reachable; inserting bare auth.users rows");

  const adminId = await ensureUser(PLATFORM_ADMIN_EMAIL, useAuthServer);
  await sql`insert into public.platform_admins (user_id) values (${adminId}) on conflict do nothing`;

  // The shared product master is seeded once; each tenant then enables its own selection.
  masterProductIds = await seedMasterProducts(sql);
  console.log(`seeded ${masterProductIds.size} master products`);

  for (const tenant of SEED_TENANTS) await seedTenant(tenant, useAuthServer);

  // The outside bookkeeper belongs to both companies, so the tenant switcher has something to switch.
  const crossUserId = await ensureUser(CROSS_TENANT_USER.email, useAuthServer);
  const [second] = await sql<{ id: string }[]>`select id from public.tenants where name = ${CROSS_TENANT_USER.alsoIn}`;
  const [bookkeeper] = await sql<{ id: string }[]>`select id from public.roles where tenant_id is null and key = ${CROSS_TENANT_USER.roleKey}`;
  await sql`
    insert into public.memberships (tenant_id, user_id, role_id)
    values (${second.id}, ${crossUserId}, ${bookkeeper.id})
    on conflict (tenant_id, user_id) do update set role_id = excluded.role_id`;

  console.log(`done. Sign in with any seeded email and the password "${SEED_PASSWORD}".`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
