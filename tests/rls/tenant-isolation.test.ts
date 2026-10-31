// Tenant isolation lives in Postgres row level security. This suite discovers every table in the public
// schema and proves, signed in as a Northwind user, that Lakeshore rows cannot be selected, inserted, updated
// or deleted. New tables are covered automatically; a table missing row level security fails the suite.

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLE_KEYS, SEED_TENANTS, seedUserEmail } from "../../scripts/seed-data";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set; see docs/dev-setup.md");

const admin = postgres(databaseUrl, { max: 2, prepare: false, onnotice: () => {} });

type Table = { name: string; hasTenantId: boolean; rls: boolean };

const [northwind, lakeshore] = SEED_TENANTS;
let tables: Table[] = [];
let northwindId = "";
let lakeshoreId = "";
let northwindOwner = "";
let lakeshoreOwner = "";

/** Runs `fn` under row level security as the given user, the way the app and Supabase's API do. */
async function asUser(userId: string, email: string, fn: (tx: postgres.TransactionSql) => Promise<unknown>) {
  return admin.begin(async (tx) => {
    await tx.unsafe("set local role authenticated");
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, email, role: "authenticated" })}, true)`;
    return fn(tx);
  });
}

async function userId(email: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`select id from auth.users where email = ${email}`;
  if (!row) throw new Error(`seed user ${email} is missing; run npm run seed`);
  return row.id;
}

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

  it("seeds at least one Lakeshore row in every tenant table, so the isolation checks are real", async () => {
    for (const t of tables.filter((t) => t.hasTenantId)) {
      const [{ n }] = await admin<{ n: number }[]>`select count(*)::int as n from public.${admin(t.name)} where tenant_id = ${lakeshoreId}`;
      expect(n, `${t.name} has no Lakeshore rows to test against`).toBeGreaterThan(0);
    }
  });
});

describe("as a Northwind owner", () => {
  it("sees Northwind data (sanity check that the session works)", async () => {
    const rows = (await asUser(northwindOwner, seedUserEmail(northwind, "owner"), (tx) =>
      tx<{ id: string }[]>`select id from public.branches where tenant_id = ${northwindId}`,
    )) as { id: string }[];
    expect(rows.length).toBe(northwind.branches.length);
  });

  it("cannot select any Lakeshore row from any tenant table", async () => {
    for (const t of tables.filter((t) => t.hasTenantId)) {
      const rows = (await asUser(northwindOwner, seedUserEmail(northwind, "owner"), (tx) =>
        tx`select 1 from public.${tx(t.name)} where tenant_id = ${lakeshoreId}`,
      )) as unknown[];
      expect(rows.length, `${t.name}: Lakeshore rows leaked`).toBe(0);
    }
  });

  it("cannot see the Lakeshore tenant itself", async () => {
    const rows = (await asUser(northwindOwner, seedUserEmail(northwind, "owner"), (tx) =>
      tx`select id from public.tenants where id = ${lakeshoreId}`,
    )) as unknown[];
    expect(rows.length).toBe(0);
  });

  it("cannot insert a row into another tenant in any tenant table", async () => {
    for (const t of tables.filter((t) => t.hasTenantId)) {
      // Copy a real Lakeshore row with a fresh key, so the only thing wrong with the insert is the tenant.
      const [sample] = await admin<{ row: Record<string, unknown> }[]>`
        select to_jsonb(x) as row from public.${admin(t.name)} x where tenant_id = ${lakeshoreId} limit 1`;
      const copy = { ...sample.row };
      delete copy.id;
      if ("token" in copy) delete copy.token;
      if ("created_at" in copy) delete copy.created_at;
      if ("updated_at" in copy) delete copy.updated_at;
      await expect(
        asUser(northwindOwner, seedUserEmail(northwind, "owner"), (tx) =>
          tx`insert into public.${tx(t.name)} select * from jsonb_populate_record(null::public.${tx(t.name)}, ${JSON.stringify(copy)}::jsonb)`,
        ),
        `${t.name}: insert into Lakeshore succeeded`,
      ).rejects.toThrow();
    }
  });

  it("cannot update or delete Lakeshore rows in any tenant table", async () => {
    for (const t of tables.filter((t) => t.hasTenantId)) {
      const updated = (await asUser(northwindOwner, seedUserEmail(northwind, "owner"), async (tx) => {
        const result = await tx`update public.${tx(t.name)} set tenant_id = tenant_id where tenant_id = ${lakeshoreId}`;
        return result.count;
      })) as number;
      expect(updated, `${t.name}: updated Lakeshore rows`).toBe(0);

      const deleted = (await asUser(northwindOwner, seedUserEmail(northwind, "owner"), async (tx) => {
        const result = await tx`delete from public.${tx(t.name)} where tenant_id = ${lakeshoreId}`;
        return result.count;
      })) as number;
      expect(deleted, `${t.name}: deleted Lakeshore rows`).toBe(0);
    }
  });

  it("cannot read the audit trail of another tenant", async () => {
    const rows = (await asUser(northwindOwner, seedUserEmail(northwind, "owner"), (tx) =>
      tx`select id from public.audit_log where tenant_id = ${lakeshoreId}`,
    )) as unknown[];
    expect(rows.length).toBe(0);
  });
});

describe("roles and ownership", () => {
  it("lets every seeded role see its own tenant and nothing else", async () => {
    for (const key of ROLE_KEYS) {
      const email = seedUserEmail(lakeshore, key);
      const id = await userId(email);
      const visible = (await asUser(id, email, (tx) => tx<{ id: string }[]>`select id from public.tenants`)) as { id: string }[];
      expect(visible.map((t) => t.id), `${key} sees the wrong tenants`).toEqual([lakeshoreId]);
    }
  });

  it("stops the last owner from removing themselves", async () => {
    await expect(
      asUser(lakeshoreOwner, seedUserEmail(lakeshore, "owner"), (tx) =>
        tx`delete from public.memberships where tenant_id = ${lakeshoreId} and user_id = ${lakeshoreOwner}`,
      ),
    ).rejects.toThrow(/at least one owner/);
  });

  it("stops a technician from changing branches", async () => {
    const email = seedUserEmail(lakeshore, "technician");
    const id = await userId(email);
    const updated = (await asUser(id, email, async (tx) => {
      const result = await tx`update public.branches set name = name where tenant_id = ${lakeshoreId}`;
      return result.count;
    })) as number;
    expect(updated).toBe(0);
  });
});
