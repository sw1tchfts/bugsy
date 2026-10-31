// Tenant isolation lives in Postgres row level security. This suite discovers every table in the public
// schema and proves, signed in as a Northwind user, that Lakeshore rows cannot be selected, inserted, updated
// or deleted. New tables are covered automatically; a table missing row level security fails the suite.
// It also covers the spec's business rules that live in the database: helper function properties, platform
// admin boundaries, invitations, the last-owner rule and the audit trail.

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CROSS_TENANT_USER, PLATFORM_ADMIN_EMAIL, ROLE_KEYS, SEED_TENANTS, seedUserEmail } from "../../scripts/seed-data";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set; see docs/dev-setup.md");

const admin = postgres(databaseUrl, { max: 2, prepare: false, onnotice: () => {} });

type Table = { name: string; hasTenantId: boolean; rls: boolean };
type Tx = postgres.TransactionSql;

const [northwind, lakeshore] = SEED_TENANTS;
const RLS_ERROR = /row-level security/;
let tables: Table[] = [];
let northwindId = "";
let lakeshoreId = "";
let northwindOwner = "";
let lakeshoreOwner = "";

/** Runs `fn` under row level security as the given user, the way the app and Supabase's API do. */
async function asUser<T>(userId: string, email: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const result = await admin.begin(async (tx) => {
    await tx.unsafe("set local role authenticated");
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, email, role: "authenticated" })}, true)`;
    return fn(tx);
  });
  return result as T;
}

async function userId(email: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`select id from auth.users where email = ${email}`;
  if (!row) throw new Error(`seed user ${email} is missing; run npm run seed`);
  return row.id;
}

async function defaultRoleId(key: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`select id from public.roles where tenant_id is null and key = ${key}`;
  return row.id;
}

const tenantTables = () => tables.filter((t) => t.hasTenantId);

beforeAll(async () => {
  tables = (
    await admin<{ name: string; rls: boolean; has_tenant_id: boolean }[]>`
      select c.relname as name, c.relrowsecurity as rls,
             exists (select 1 from information_schema.columns col
                     where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'tenant_id') as has_tenant_id
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`
  ).map((r) => ({ name: r.name, rls: r.rls, hasTenantId: r.has_tenant_id }));

  const ids = await admin<{ id: string; name: string }[]>`select id, name from public.tenants where name in (${northwind.name}, ${lakeshore.name})`;
  northwindId = ids.find((t) => t.name === northwind.name)?.id ?? "";
  lakeshoreId = ids.find((t) => t.name === lakeshore.name)?.id ?? "";
  if (!northwindId || !lakeshoreId) throw new Error("seed tenants are missing; run npm run seed");
  northwindOwner = await userId(seedUserEmail(northwind, "owner"));
  lakeshoreOwner = await userId(seedUserEmail(lakeshore, "owner"));
});

afterAll(async () => {
  await admin.end();
});

describe("schema", () => {
  it("finds the foundation tables", () => {
    const names = tables.map((t) => t.name);
    for (const expected of ["tenants", "branches", "memberships", "roles", "audit_log", "invitations", "platform_admins"]) {
      expect(names).toContain(expected);
    }
  });

  it("enables row level security on every table in public", () => {
    const missing = tables.filter((t) => !t.rls).map((t) => t.name);
    expect(missing, `tables without row level security: ${missing.join(", ")}`).toEqual([]);
  });

  it("has a select policy on every table", async () => {
    const policies = await admin<{ tablename: string }[]>`select distinct tablename from pg_policies where schemaname = 'public' and cmd in ('SELECT', 'ALL')`;
    const covered = new Set(policies.map((p) => p.tablename));
    const missing = tables.filter((t) => !covered.has(t.name)).map((t) => t.name);
    expect(missing, `tables without a select policy: ${missing.join(", ")}`).toEqual([]);
  });

  it("defines the membership helpers as security definer, stable, with a fixed search_path (rule 2)", async () => {
    const fns = await admin<{ proname: string; prosecdef: boolean; provolatile: string; proconfig: string[] | null }[]>`
      select p.proname, p.prosecdef, p.provolatile, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname in ('is_member', 'has_permission', 'is_platform_admin')`;
    expect(fns.map((f) => f.proname).sort()).toEqual(["has_permission", "is_member", "is_platform_admin"]);
    for (const f of fns) {
      expect(f.prosecdef, `${f.proname} must be security definer`).toBe(true);
      expect(f.provolatile, `${f.proname} must be stable`).toBe("s");
      expect(f.proconfig?.some((c) => c.startsWith("search_path=")), `${f.proname} must pin search_path`).toBe(true);
    }
  });

  it("seeds at least one Lakeshore row in every tenant table, so the isolation checks are real", async () => {
    for (const t of tenantTables()) {
      const [{ n }] = await admin<{ n: number }[]>`select count(*)::int as n from public.${admin(t.name)} where tenant_id = ${lakeshoreId}`;
      expect(n, `${t.name} has no Lakeshore rows to test against`).toBeGreaterThan(0);
    }
  });
});

describe("as a Northwind owner", () => {
  const owner = () => [northwindOwner, seedUserEmail(northwind, "owner")] as const;

  it("sees Northwind data (sanity check that the session works)", async () => {
    const rows = await asUser(...owner(), (tx) => tx<{ name: string }[]>`select name from public.branches where tenant_id = ${northwindId}`);
    // Other suites may add branches; the seeded ones must be among them.
    expect(rows.map((r) => r.name)).toEqual(expect.arrayContaining(northwind.branches.map((b) => b.name)));
  });

  it("cannot select any Lakeshore row from any tenant table", async () => {
    for (const t of tenantTables()) {
      const rows = await asUser(...owner(), (tx) => tx`select 1 from public.${tx(t.name)} where tenant_id = ${lakeshoreId}`);
      expect(rows.length, `${t.name}: Lakeshore rows leaked`).toBe(0);
    }
  });

  it("cannot see the Lakeshore tenant itself", async () => {
    const rows = await asUser(...owner(), (tx) => tx`select id from public.tenants where id = ${lakeshoreId}`);
    expect(rows.length).toBe(0);
  });

  it("is stopped by row level security when inserting into another tenant in any tenant table", async () => {
    for (const t of tenantTables()) {
      // Copy real Lakeshore rows without their generated columns, so the only thing wrong with the insert is the
      // tenant. Some rows are rejected by business-rule triggers before the policy runs (a won lead, for example),
      // so several samples are tried: none may succeed, and at least one must fail on row level security itself.
      const samples = await admin<{ row: Record<string, unknown> }[]>`
        select to_jsonb(x) as row from public.${admin(t.name)} x where tenant_id = ${lakeshoreId} limit 8`;
      const generated = await admin<{ column_name: string }[]>`
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = ${t.name} and (is_generated = 'ALWAYS' or is_identity = 'YES')`;
      let blockedByRls = false;
      const otherErrors: string[] = [];
      for (const sample of samples) {
        const copy = { ...sample.row };
        for (const key of ["id", "token", "created_at", "updated_at", ...generated.map((g) => g.column_name)]) delete copy[key];
        try {
          await asUser(...owner(), (tx) => tx`insert into public.${tx(t.name)} ${tx(copy)}`);
          expect.fail(`${t.name}: insert into Lakeshore succeeded`);
        } catch (err) {
          const message = (err as Error).message;
          if (message.includes("succeeded")) throw err;
          if (RLS_ERROR.test(message)) {
            blockedByRls = true;
            break;
          }
          otherErrors.push(message);
        }
      }
      expect(blockedByRls, `${t.name}: no sample reached the row level security check (${otherErrors.join("; ")})`).toBe(true);
    }
  });

  it("cannot update or delete Lakeshore rows in any tenant table", async () => {
    for (const t of tenantTables()) {
      const updated = await asUser(...owner(), async (tx) => (await tx`update public.${tx(t.name)} set tenant_id = tenant_id where tenant_id = ${lakeshoreId}`).count);
      expect(updated, `${t.name}: updated Lakeshore rows`).toBe(0);
      const deleted = await asUser(...owner(), async (tx) => (await tx`delete from public.${tx(t.name)} where tenant_id = ${lakeshoreId}`).count);
      expect(deleted, `${t.name}: deleted Lakeshore rows`).toBe(0);
    }
  });

  it("cannot create a tenant (rule 6: only platform admins create tenants)", async () => {
    await expect(
      asUser(...owner(), (tx) => tx`insert into public.tenants (name, timezone) values ('Rogue Pest', 'America/Chicago')`),
    ).rejects.toThrow(RLS_ERROR);
  });

  it("writes before and after values to the audit log on an update (rule 5)", async () => {
    const [branch] = await admin<{ id: string; name: string }[]>`select id, name from public.branches where tenant_id = ${northwindId} and archived_at is null limit 1`;
    const renamed = `${branch.name} (renamed ${Date.now()})`;
    await asUser(...owner(), (tx) => tx`update public.branches set name = ${renamed} where id = ${branch.id}`);
    const [entry] = await asUser(...owner(), (tx) =>
      tx<{ actor_id: string; before: { name: string }; after: { name: string } }[]>`
        select actor_id, before, after from public.audit_log
        where tenant_id = ${northwindId} and table_name = 'branches' and row_id = ${branch.id} and action = 'update'
        order by created_at desc, id desc limit 1`,
    );
    expect(entry.actor_id).toBe(northwindOwner);
    expect(entry.before.name).toBe(branch.name);
    expect(entry.after.name).toBe(renamed);
    await admin`update public.branches set name = ${branch.name} where id = ${branch.id}`;
  });
});

describe("platform admin", () => {
  it("sees the list of tenants but no tenant data (rule 6)", async () => {
    const adminId = await userId(PLATFORM_ADMIN_EMAIL);
    const visibleTenants = await asUser(adminId, PLATFORM_ADMIN_EMAIL, (tx) => tx<{ id: string }[]>`select id from public.tenants`);
    expect(visibleTenants.map((t) => t.id)).toEqual(expect.arrayContaining([northwindId, lakeshoreId]));

    for (const t of tenantTables().filter((t) => t.name !== "tenants")) {
      const rows = await asUser(adminId, PLATFORM_ADMIN_EMAIL, (tx) =>
        tx`select 1 from public.${tx(t.name)} where tenant_id in (${northwindId}, ${lakeshoreId})
           ${t.name === "audit_log" ? tx`and table_name <> 'tenants'` : tx``}`,
      );
      expect(rows.length, `${t.name}: platform admin can read tenant data`).toBe(0);
    }
  });

  it("is not a member of any tenant", async () => {
    const adminId = await userId(PLATFORM_ADMIN_EMAIL);
    const rows = await asUser(adminId, PLATFORM_ADMIN_EMAIL, (tx) => tx`select 1 from public.memberships where user_id = auth.uid()`);
    expect(rows.length).toBe(0);
  });
});

describe("roles and ownership", () => {
  it("lets every seeded role see its own tenant and nothing else", async () => {
    for (const key of ROLE_KEYS) {
      const email = seedUserEmail(lakeshore, key);
      const id = await userId(email);
      const visible = await asUser(id, email, (tx) => tx<{ id: string }[]>`select id from public.tenants order by name`);
      const expected = email === CROSS_TENANT_USER.email ? [lakeshoreId, northwindId].sort() : [lakeshoreId];
      expect(visible.map((t) => t.id).sort(), `${key} sees the wrong tenants`).toEqual(expected);
    }
  });

  it("gives a user in two tenants both memberships and never mixed data", async () => {
    const id = await userId(CROSS_TENANT_USER.email);
    const branches = await asUser(id, CROSS_TENANT_USER.email, (tx) => tx<{ tenant_id: string }[]>`select tenant_id from public.branches`);
    const byTenant = new Set(branches.map((b) => b.tenant_id));
    expect(byTenant).toEqual(new Set([northwindId, lakeshoreId]));
    const onlyNorthwind = await asUser(id, CROSS_TENANT_USER.email, (tx) => tx<{ tenant_id: string }[]>`select tenant_id from public.branches where tenant_id = ${northwindId}`);
    expect(onlyNorthwind.every((b) => b.tenant_id === northwindId)).toBe(true);
  });

  it("stops the last owner from removing themselves", async () => {
    await expect(
      asUser(lakeshoreOwner, seedUserEmail(lakeshore, "owner"), (tx) =>
        tx`delete from public.memberships where tenant_id = ${lakeshoreId} and user_id = ${lakeshoreOwner}`,
      ),
    ).rejects.toThrow(/at least one owner/);
  });

  it("stops the last owner from downgrading their own role", async () => {
    const technician = await defaultRoleId("technician");
    await expect(
      asUser(lakeshoreOwner, seedUserEmail(lakeshore, "owner"), (tx) =>
        tx`update public.memberships set role_id = ${technician} where tenant_id = ${lakeshoreId} and user_id = ${lakeshoreOwner}`,
      ),
    ).rejects.toThrow(/at least one owner/);
  });

  it("stops a technician from changing branches", async () => {
    const email = seedUserEmail(lakeshore, "technician");
    const id = await userId(email);
    const updated = await asUser(id, email, async (tx) => (await tx`update public.branches set name = name where tenant_id = ${lakeshoreId}`).count);
    expect(updated).toBe(0);
  });

  it("takes a removed membership away on the next query (rule 4)", async () => {
    const email = `temp-${Date.now()}@northwind.test`;
    const [user] = await admin<{ id: string }[]>`
      insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values (gen_random_uuid(), 'authenticated', 'authenticated', ${email}, now(), '{}'::jsonb, '{}'::jsonb, now(), now()) returning id`;
    const technician = await defaultRoleId("technician");
    await admin`insert into public.memberships (tenant_id, user_id, role_id) values (${northwindId}, ${user.id}, ${technician})`;
    const before = await asUser(user.id, email, (tx) => tx`select id from public.branches where tenant_id = ${northwindId}`);
    expect(before.length).toBeGreaterThan(0);
    await admin`delete from public.memberships where tenant_id = ${northwindId} and user_id = ${user.id}`;
    const after = await asUser(user.id, email, (tx) => tx`select id from public.branches where tenant_id = ${northwindId}`);
    expect(after.length).toBe(0);
    await admin`delete from auth.users where id = ${user.id}`;
  });
});

describe("invitations", () => {
  it("joins an existing account to the tenant on accept, without creating a user", async () => {
    const email = seedUserEmail(lakeshore, "dispatcher");
    const id = await userId(email);
    const technician = await defaultRoleId("technician");
    await admin`delete from public.memberships where tenant_id = ${northwindId} and user_id = ${id}`;
    const [invite] = await admin<{ token: string }[]>`
      insert into public.invitations (tenant_id, email, role_id) values (${northwindId}, ${email}, ${technician}) returning token`;
    const [{ n: usersBefore }] = await admin<{ n: number }[]>`select count(*)::int as n from auth.users`;

    const [accepted] = await asUser(id, email, (tx) => tx<{ membership_id: string }[]>`select app.accept_invitation(${invite.token}::uuid) as membership_id`);
    expect(accepted.membership_id).toBeTruthy();

    const [membership] = await admin<{ tenant_id: string; role_id: string }[]>`select tenant_id, role_id from public.memberships where id = ${accepted.membership_id}`;
    expect(membership).toEqual({ tenant_id: northwindId, role_id: technician });
    const [{ n: usersAfter }] = await admin<{ n: number }[]>`select count(*)::int as n from auth.users`;
    expect(usersAfter).toBe(usersBefore);
    const [row] = await admin<{ accepted_at: string | null }[]>`select accepted_at from public.invitations where token = ${invite.token}`;
    expect(row.accepted_at).not.toBeNull();

    await admin`delete from public.memberships where id = ${accepted.membership_id}`;
    await admin`delete from public.invitations where token = ${invite.token}`;
  });

  it("rejects an invitation accepted by a different email address", async () => {
    const [invite] = await admin<{ token: string }[]>`
      insert into public.invitations (tenant_id, email, role_id) values (${northwindId}, 'someone-else@northwind.test', ${await defaultRoleId("technician")}) returning token`;
    await expect(
      asUser(lakeshoreOwner, seedUserEmail(lakeshore, "owner"), (tx) => tx`select app.accept_invitation(${invite.token}::uuid)`),
    ).rejects.toThrow(/different email address/);
    await admin`delete from public.invitations where token = ${invite.token}`;
  });
});
