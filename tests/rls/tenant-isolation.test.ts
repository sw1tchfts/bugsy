// Tenant isolation lives in Postgres row level security. This suite discovers every table in the public
// schema and proves, signed in as a Northwind user, that Lakeshore rows cannot be selected, inserted, updated
// or deleted. New tables are covered automatically; a table missing row level security fails the suite.
// It also covers the spec's business rules that live in the database: helper function properties, platform
// admin boundaries, invitations, the last-owner rule and the audit trail.

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInvoice, voidInvoice } from "../../lib/billing/db";
import { refreshNoticeTasks } from "../../lib/compliance/db";
import { sweep } from "../../lib/ledger/db";
import { PG_TYPES } from "../../lib/pg-types";
import { buildQuery } from "../../lib/reports/builder";
import { arAging, salesBySource, technicianReport } from "../../lib/reports/db";
import { DATASETS, datasetFor } from "../../lib/reports/datasets";
import { CROSS_TENANT_USER, PLATFORM_ADMIN_EMAIL, ROLE_KEYS, SEED_TENANTS, seedUserEmail } from "../../scripts/seed-data";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set; see docs/dev-setup.md");

const admin = postgres(databaseUrl, { max: 2, prepare: false, onnotice: () => {}, types: PG_TYPES });

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
      // Copy real Lakeshore rows as they are, id included, without their generated columns, so the only thing wrong
      // with the insert is the tenant (a trigger that sums a row's siblings excludes the row itself by id, so a copy
      // under a fresh id would be refused for double counting before the policy ever ran). Some rows are rejected by
      // business-rule triggers before the policy runs (a won lead, for example),
      // so several samples are tried: none may succeed, and at least one must fail on row level security itself.
      // Oldest rows first: the seed's first rows are the plain ones (a planned visit, an open lead), later rows carry
      // states that insert triggers refuse.
      const samples = await admin<{ row: Record<string, unknown> }[]>`
        select to_jsonb(x) as row from public.${admin(t.name)} x where tenant_id = ${lakeshoreId} order by created_at limit 12`;
      const generated = await admin<{ column_name: string }[]>`
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = ${t.name} and (is_generated = 'ALWAYS' or is_identity = 'YES')`;
      let blockedByRls = false;
      const otherErrors: string[] = [];
      for (const sample of samples) {
        const copy = { ...sample.row };
        for (const key of ["token", "created_at", "updated_at", ...generated.map((g) => g.column_name)]) delete copy[key];
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

    // Spec 03 rule 10: products a company added are catalog definitions awaiting approval, not customer data,
    // and platform admins read them in order to approve them. Spec 13: support_grants rows are the admin's own requests
    // (who asked, why, when), shown in the console. Every other tenant table stays closed.
    for (const t of tenantTables().filter((t) => t.name !== "tenants" && t.name !== "products" && t.name !== "support_grants")) {
      const rows = await asUser(adminId, PLATFORM_ADMIN_EMAIL, (tx) =>
        tx`select 1 from public.${tx(t.name)} where tenant_id in (${northwindId}, ${lakeshoreId})
           ${t.name === "audit_log" ? tx`and table_name <> 'tenants'` : tx``}`,
      );
      expect(rows.length, `${t.name}: platform admin can read tenant data`).toBe(0);
    }
  });

  it("invites only into a company that has no members yet (spec 13 rule 1)", async () => {
    const adminId = await userId(PLATFORM_ADMIN_EMAIL);
    const [owner] = await admin<{ id: string }[]>`select id from public.roles where tenant_id is null and key = 'owner'`;
    await expect(
      asUser(adminId, PLATFORM_ADMIN_EMAIL, (tx) => tx`insert into public.invitations (tenant_id, email, role_id) values (${lakeshoreId}, ${PLATFORM_ADMIN_EMAIL}, ${owner.id})`),
    ).rejects.toThrow(RLS_ERROR);
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

describe("spec 02 rules enforced in the database", () => {
  const owner = () => [lakeshoreOwner, seedUserEmail(lakeshore, "owner")] as const;

  async function sourceId(): Promise<string> {
    const [row] = await admin<{ id: string }[]>`select id from public.lead_sources where tenant_id = ${lakeshoreId} and key = 'phone'`;
    return row.id;
  }

  async function accountId(): Promise<string> {
    const [row] = await admin<{ id: string }[]>`select id from public.accounts where tenant_id = ${lakeshoreId} and archived_at is null order by created_at limit 1`;
    return row.id;
  }

  async function newQuote(): Promise<string> {
    const account = await accountId();
    const [row] = await asUser(...owner(), (tx) => tx<{ id: string }[]>`insert into public.quotes (tenant_id, account_id) values (${lakeshoreId}, ${account}) returning id`);
    return row.id;
  }

  async function newOption(quoteId: string, position: number): Promise<string> {
    const [row] = await asUser(
      ...owner(),
      (tx) => tx<{ id: string }[]>`insert into public.quote_options (tenant_id, quote_id, position, name) values (${lakeshoreId}, ${quoteId}, ${position}, ${`Option ${position}`}) returning id`,
    );
    return row.id;
  }

  async function newLine(optionId: string, quantity: string, unitPriceCents: number): Promise<string> {
    const [row] = await asUser(
      ...owner(),
      (tx) => tx<{ id: string }[]>`insert into public.quote_lines (tenant_id, option_id, description, kind, quantity, unit_price_cents)
                                    values (${lakeshoreId}, ${optionId}, 'test line', 'recurring', ${quantity}::numeric, ${unitPriceCents}) returning id`,
    );
    return row.id;
  }

  async function setStatus(quoteId: string, status: string) {
    return asUser(...owner(), (tx) => tx`update public.quotes set status = ${status} where id = ${quoteId}`);
  }

  it("creates the default lead sources for a new tenant (rule 12)", async () => {
    // Inside a transaction that is rolled back, so no test tenant is left behind.
    const found: string[] = [];
    await admin
      .begin(async (tx) => {
        const [tenant] = await tx<{ id: string }[]>`insert into public.tenants (name, timezone) values ('Rule test tenant', 'America/Chicago') returning id`;
        const keys = await tx<{ key: string }[]>`select key from public.lead_sources where tenant_id = ${tenant.id} order by key`;
        found.push(...keys.map((k) => k.key));
        throw new Error("rollback");
      })
      .catch((err: Error) => {
        if (err.message !== "rollback") throw err;
      });
    expect(found).toEqual(["ads", "door_to_door", "online_directory", "other", "phone", "referral", "website"]);
  });

  it("refuses to delete a lead source in use but lets it be deactivated (rule 12)", async () => {
    const [used] = await admin<{ source_id: string }[]>`select source_id from public.leads where tenant_id = ${lakeshoreId} limit 1`;
    await expect(asUser(...owner(), (tx) => tx`delete from public.lead_sources where id = ${used.source_id}`)).rejects.toThrow(/in use/);
    await asUser(...owner(), (tx) => tx`update public.lead_sources set active = false where id = ${used.source_id}`);
    const [row] = await admin<{ active: boolean }[]>`select active from public.lead_sources where id = ${used.source_id}`;
    expect(row.active).toBe(false);
    await asUser(...owner(), (tx) => tx`update public.lead_sources set active = true where id = ${used.source_id}`);
  });

  it("enforces the lead stage machine: no won or lost start, forbidden moves, lost needs a reason, won needs a conversion (rule 2)", async () => {
    const source = await sourceId();
    await expect(
      asUser(...owner(), (tx) => tx`insert into public.leads (tenant_id, source_id, name, stage) values (${lakeshoreId}, ${source}, 'Rule test', 'won')`),
    ).rejects.toThrow(/open stage/);
    const [lead] = await asUser(
      ...owner(),
      (tx) => tx<{ id: string }[]>`insert into public.leads (tenant_id, source_id, name, stage, inspection_at) values (${lakeshoreId}, ${source}, 'Rule test', 'inspection_booked', now()) returning id`,
    );
    try {
      await expect(asUser(...owner(), (tx) => tx`update public.leads set stage = 'new' where id = ${lead.id}`)).rejects.toThrow(/cannot move/);
      await expect(asUser(...owner(), (tx) => tx`update public.leads set stage = 'won' where id = ${lead.id}`)).rejects.toThrow(/must be converted/);
      await expect(asUser(...owner(), (tx) => tx`update public.leads set stage = 'lost' where id = ${lead.id}`)).rejects.toThrow(/needs a reason/);
      await asUser(...owner(), (tx) => tx`update public.leads set stage = 'quoted' where id = ${lead.id}`);
      await asUser(...owner(), (tx) => tx`update public.leads set stage = 'lost', lost_reason = 'went with another company' where id = ${lead.id}`);
      const [lost] = await admin<{ lost_at: string | null; inspection_at: string | null }[]>`select lost_at, inspection_at from public.leads where id = ${lead.id}`;
      expect(lost.lost_at).not.toBeNull();
      expect(lost.inspection_at, "a booked inspection survives later stage moves").not.toBeNull();
      await expect(asUser(...owner(), (tx) => tx`update public.leads set stage = 'quoted' where id = ${lead.id}`)).rejects.toThrow(/cannot move/);
      await asUser(...owner(), (tx) => tx`update public.leads set stage = 'new' where id = ${lead.id}`);
      const [reopened] = await admin<{ lost_at: string | null; lost_reason: string | null; stage: string }[]>`select lost_at, lost_reason, stage from public.leads where id = ${lead.id}`;
      expect(reopened).toEqual({ lost_at: null, lost_reason: null, stage: "new" });
    } finally {
      await admin`delete from public.leads where id = ${lead.id}`;
    }
  });

  it("numbers quotes from the tenant's counter, ignoring any supplied number (rule 8)", async () => {
    const account = await accountId();
    const [first] = await asUser(...owner(), (tx) => tx<{ id: string; number: number }[]>`insert into public.quotes (tenant_id, account_id, number) values (${lakeshoreId}, ${account}, 999999) returning id, number`);
    const [second] = await asUser(...owner(), (tx) => tx<{ id: string; number: number }[]>`insert into public.quotes (tenant_id, account_id) values (${lakeshoreId}, ${account}) returning id, number`);
    try {
      expect(first.number).not.toBe(999999);
      expect(second.number).toBe(first.number + 1);
    } finally {
      await admin`delete from public.quotes where id in (${first.id}, ${second.id})`;
    }
  });

  it("does not let a signed-in user draw another tenant's numbers directly (rule 8, isolation)", async () => {
    await expect(asUser(northwindOwner, seedUserEmail(northwind, "owner"), (tx) => tx`select app.next_number(${lakeshoreId}, 'quote')`)).rejects.toThrow(/permission denied/);
    await expect(asUser(...owner(), (tx) => tx`insert into public.counters (tenant_id, key, value) values (${northwindId}, 'quote', 1)`)).rejects.toThrow(RLS_ERROR);
  });

  it("sends a quote only when every option has a line, accepts only with an option, expires only after valid-until (rule 9)", async () => {
    const quoteId = await newQuote();
    try {
      await expect(setStatus(quoteId, "sent")).rejects.toThrow(/at least one option/);
      await expect(setStatus(quoteId, "accepted")).rejects.toThrow(/cannot move/);
      const option1 = await newOption(quoteId, 1);
      await expect(setStatus(quoteId, "sent")).rejects.toThrow(/every option .* at least one line/);
      await newLine(option1, "1", 22500);
      const option2 = await newOption(quoteId, 2);
      await expect(setStatus(quoteId, "sent")).rejects.toThrow(/every option .* at least one line/);
      await asUser(...owner(), (tx) => tx`delete from public.quote_options where id = ${option2}`);
      await setStatus(quoteId, "sent");
      const [sent] = await admin<{ status: string; sent_at: string | null }[]>`select status, sent_at from public.quotes where id = ${quoteId}`;
      expect(sent.status).toBe("sent");
      expect(sent.sent_at).not.toBeNull();
      await expect(setStatus(quoteId, "accepted")).rejects.toThrow(/accepted option/);
      await expect(setStatus(quoteId, "expired")).rejects.toThrow(/valid-until/);
      await asUser(...owner(), (tx) => tx`update public.quotes set valid_until = current_date - 2 where id = ${quoteId}`);
      await setStatus(quoteId, "expired");
      const [expired] = await admin<{ status: string; decided_at: string | null }[]>`select status, decided_at from public.quotes where id = ${quoteId}`;
      expect(expired.status).toBe("expired");
      expect(expired.decided_at).not.toBeNull();
      await expect(setStatus(quoteId, "sent")).rejects.toThrow(/cannot move/);
    } finally {
      await admin`delete from public.quotes where id = ${quoteId}`;
    }
  });

  it("keeps catalog rules: the master list is read by all and written by platform admins only, private products stay private (spec 03 rules 9 to 11)", async () => {
    const adminId = await userId(PLATFORM_ADMIN_EMAIL);
    const asAdmin = <T,>(fn: (tx: Tx) => Promise<T>) => asUser(adminId, PLATFORM_ADMIN_EMAIL, fn);

    const master = await asUser(...owner(), (tx) => tx<{ id: string; epa_reg_no: string }[]>`select id, epa_reg_no from public.products where tenant_id is null and epa_reg_no <> '25b-exempt'`);
    expect(master.length).toBeGreaterThan(0);
    await expect(asUser(...owner(), (tx) => tx`insert into public.products (tenant_id, name, epa_reg_no) values (null, 'Sneaky master row', '1-1')`)).rejects.toThrow(RLS_ERROR);
    const touched = await asUser(...owner(), async (tx) => (await tx`update public.products set name = name where tenant_id is null`).count);
    expect(touched).toBe(0);

    // A private number already in the master list is refused; a new one is accepted, and only an admin can move it to the master list.
    await expect(
      asUser(...owner(), (tx) => tx`insert into public.products (tenant_id, name, epa_reg_no) values (${lakeshoreId}, 'Duplicate of master', ${master[0].epa_reg_no})`),
    ).rejects.toThrow(/already in the master list/);
    const [adminRow] = await asAdmin((tx) => tx<{ id: string }[]>`insert into public.products (tenant_id, name, epa_reg_no, verified_at) values (null, 'Rule test master', '99997-1', now()) returning id`);
    await admin`delete from public.products where id = ${adminRow.id}`;

    // Two companies add the same unknown product: the first approval wins, the second is refused.
    const [first] = await asUser(...owner(), (tx) => tx<{ id: string }[]>`insert into public.products (tenant_id, name, epa_reg_no) values (${lakeshoreId}, 'Race test', '99996-1') returning id`);
    const [second] = await asUser(northwindOwner, seedUserEmail(northwind, "owner"), (tx) => tx<{ id: string }[]>`insert into public.products (tenant_id, name, epa_reg_no) values (${northwindId}, 'Race test', '99996-1') returning id`);
    try {
      await asAdmin((tx) => tx`update public.products set tenant_id = null, verified_at = now() where id = ${first.id}`);
      await expect(asAdmin((tx) => tx`update public.products set tenant_id = null, verified_at = now() where id = ${second.id}`)).rejects.toThrow(/reached the master list first/);
    } finally {
      await admin`delete from public.products where id in (${first.id}, ${second.id})`;
    }

    // Minimum-risk products have no number, so name and manufacturer carry the same rule.
    await expect(
      asUser(...owner(), (tx) => tx`insert into public.products (tenant_id, name, manufacturer, epa_reg_no) values (${lakeshoreId}, 'Essentria IC3', 'Zoecon', '25b-exempt')`),
    ).rejects.toThrow(/duplicate key/);

    const [mine] = await asUser(...owner(), (tx) => tx<{ id: string }[]>`insert into public.products (tenant_id, name, epa_reg_no) values (${lakeshoreId}, 'Rule test private', '99998-1') returning id`);
    try {
      const seenByOther = await asUser(northwindOwner, seedUserEmail(northwind, "owner"), (tx) => tx`select id from public.products where id = ${mine.id}`);
      expect(seenByOther.length).toBe(0);
      await expect(
        asUser(northwindOwner, seedUserEmail(northwind, "owner"), (tx) => tx`insert into public.tenant_products (tenant_id, product_id) values (${northwindId}, ${mine.id})`),
      ).rejects.toThrow(/another company/);
      await expect(asUser(...owner(), (tx) => tx`update public.products set tenant_id = null where id = ${mine.id}`)).rejects.toThrow(RLS_ERROR);
      await asAdmin((tx) => tx`update public.products set tenant_id = null, verified_at = now(), verified_by = auth.uid() where id = ${mine.id}`);
      const [after] = await admin<{ tenant_id: string | null; verified_at: string | null }[]>`select tenant_id, verified_at from public.products where id = ${mine.id}`;
      expect(after.tenant_id).toBeNull();
      expect(after.verified_at).not.toBeNull();
      const editedAfter = await asUser(...owner(), async (tx) => (await tx`update public.products set name = 'changed' where id = ${mine.id}`).count);
      expect(editedAfter).toBe(0);
      const nowVisible = await asUser(northwindOwner, seedUserEmail(northwind, "owner"), (tx) => tx`select id from public.products where id = ${mine.id}`);
      expect(nowVisible.length).toBe(1);
    } finally {
      await admin`delete from public.tenant_products where product_id = ${mine.id}`;
      await admin`delete from public.products where id = ${mine.id}`;
    }
  });

  it("never lets a tenant loosen the pack's categories and rejects overlapping price bands (spec 03 rules 3 and 5)", async () => {
    const [rule] = await admin<{ id: string }[]>`select id from public.service_type_state_rules where tenant_id = ${lakeshoreId} order by created_at limit 1`;
    await admin`update public.service_type_state_rules set pack_cert_categories = '{7A}', required_cert_categories = '{7A,7F}' where id = ${rule.id}`;
    try {
      await expect(asUser(...owner(), (tx) => tx`update public.service_type_state_rules set required_cert_categories = '{7F}' where id = ${rule.id}`)).rejects.toThrow(/never_loosen/);
      await asUser(...owner(), (tx) => tx`update public.service_type_state_rules set required_cert_categories = '{3A,7A,7F}' where id = ${rule.id}`);
    } finally {
      await admin`update public.service_type_state_rules set pack_cert_categories = '{}', required_cert_categories = '{}' where id = ${rule.id}`;
    }

    const [band] = await admin<{ service_type_id: string; name: string }[]>`
      select service_type_id, name from public.price_book_items where tenant_id = ${lakeshoreId} and size_basis = 'size_sqft' and archived_at is null limit 1`;
    await expect(
      asUser(
        ...owner(),
        (tx) => tx`insert into public.price_book_items (tenant_id, service_type_id, name, size_basis, size_min, size_max, initial_price_cents)
                   values (${lakeshoreId}, ${band.service_type_id}, ${band.name}, 'size_sqft', 1500, 2500, 100)`,
      ),
    ).rejects.toThrow(/price_book_no_overlap/);
    const [other] = await asUser(
      ...owner(),
      (tx) => tx<{ id: string }[]>`insert into public.price_book_items (tenant_id, service_type_id, name, size_basis, size_min, size_max, initial_price_cents)
                                   values (${lakeshoreId}, ${band.service_type_id}, ${band.name}, 'lot_sqft', 0, null, 100) returning id`,
    );
    await admin`delete from public.price_book_items where id = ${other.id}`;
  });

  it("keeps each option's total equal to the sum of its lines, in integer cents rounded half up (rule 8)", async () => {
    const quoteId = await newQuote();
    try {
      const option = await newOption(quoteId, 1);
      const total = async () => (await admin<{ total_cents: string | number }[]>`select total_cents from public.quote_options where id = ${option}`)[0].total_cents;
      const lineA = await newLine(option, "2.5", 1999); // 4997.5 rounds to 4998
      expect(Number(await total())).toBe(4998);
      await newLine(option, "1", 100);
      expect(Number(await total())).toBe(5098);
      await asUser(...owner(), (tx) => tx`delete from public.quote_lines where id = ${lineA}`);
      expect(Number(await total())).toBe(100);
    } finally {
      await admin`delete from public.quotes where id = ${quoteId}`;
    }
  });
});

describe("spec 04 rules enforced in the database", () => {
  const owner = () => [lakeshoreOwner, seedUserEmail(lakeshore, "owner")] as const;

  async function target() {
    const [row] = await admin<{ account_id: string; property_id: string; service_type_id: string; other_property_id: string }[]>`
      select a.id as account_id, p.id as property_id,
             (select id from public.service_types where tenant_id = ${lakeshoreId} and name = 'General pest plan' and archived_at is null) as service_type_id,
             (select id from public.properties where tenant_id = ${lakeshoreId} and account_id <> a.id limit 1) as other_property_id
      from public.accounts a join public.properties p on p.account_id = a.id
      where a.tenant_id = ${lakeshoreId} and a.name = 'Maria Lopez' order by p.created_at limit 1`;
    return row;
  }

  async function newAgreement(): Promise<string> {
    const t = await target();
    const [row] = await asUser(
      ...owner(),
      (tx) => tx<{ id: string }[]>`
        insert into public.agreements (tenant_id, account_id, property_id, service_type_id, cadence, billing_mode, term_months, starts_on, initial_price_cents, recurring_price_cents)
        values (${lakeshoreId}, ${t.account_id}, ${t.property_id}, ${t.service_type_id}, 'quarterly', 'flat_monthly', 12, '2027-01-01', 18000, 12000) returning id`,
    );
    return row.id;
  }

  const sign = (id: string) => asUser(...owner(), (tx) => tx`update public.agreements set status = 'active', signed_at = now(), signed_name = 'Maria Lopez' where id = ${id}`);

  it("numbers agreements, derives the term end, and keeps a property with its account (rules 1 and 12)", async () => {
    const t = await target();
    await expect(
      asUser(
        ...owner(),
        (tx) => tx`insert into public.agreements (tenant_id, account_id, property_id, service_type_id, cadence, billing_mode, term_months, starts_on)
                   values (${lakeshoreId}, ${t.account_id}, ${t.other_property_id}, ${t.service_type_id}, 'quarterly', 'per_visit', 12, '2027-01-01')`,
      ),
    ).rejects.toThrow(/does not belong/);
    const id = await newAgreement();
    try {
      const [row] = await admin<{ number: number; ends_on: string; first_visit_on: string }[]>`select number, ends_on, first_visit_on from public.agreements where id = ${id}`;
      expect(row.number).toBeGreaterThan(0);
      expect(row.ends_on).toBe("2027-12-31");
      expect(row.first_visit_on).toBe("2027-01-01");
      await asUser(...owner(), (tx) => tx`update public.agreements set term_months = 24 where id = ${id}`);
      const [after] = await admin<{ ends_on: string }[]>`select ends_on from public.agreements where id = ${id}`;
      expect(after.ends_on).toBe("2028-12-31");
    } finally {
      await admin`delete from public.agreements where id = ${id}`;
    }
  });

  it("activates only by signing, then locks what it is for and follows the status machine (rules 2, 3, 10, 12)", async () => {
    const id = await newAgreement();
    try {
      await expect(asUser(...owner(), (tx) => tx`update public.agreements set status = 'active' where id = ${id}`)).rejects.toThrow(/activated by signing/);
      await sign(id);
      const [other] = await admin<{ id: string }[]>`select id from public.service_types where tenant_id = ${lakeshoreId} and name = 'Rodent control program'`;
      await expect(asUser(...owner(), (tx) => tx`update public.agreements set service_type_id = ${other.id} where id = ${id}`)).rejects.toThrow(/keeps its account, property and service type/);
      await expect(asUser(...owner(), (tx) => tx`update public.agreements set status = 'draft' where id = ${id}`)).rejects.toThrow(/cannot move/);
      await expect(asUser(...owner(), (tx) => tx`update public.agreements set status = 'cancelled' where id = ${id}`)).rejects.toThrow(/needs a reason/);
      const [reason] = await admin<{ id: string }[]>`select id from public.cancel_reasons where tenant_id = ${lakeshoreId} and key = 'moved'`;
      await asUser(...owner(), (tx) => tx`update public.agreements set status = 'on_hold' where id = ${id}`);
      await asUser(...owner(), (tx) => tx`update public.agreements set status = 'cancelled', cancel_reason_id = ${reason.id} where id = ${id}`);
      const [row] = await admin<{ status: string; cancelled_on: string | null }[]>`select status, cancelled_on from public.agreements where id = ${id}`;
      expect(row.status).toBe("cancelled");
      expect(row.cancelled_on).not.toBeNull();
      await expect(asUser(...owner(), (tx) => tx`update public.agreements set status = 'active' where id = ${id}`)).rejects.toThrow(/cannot move/);
    } finally {
      await admin`delete from public.agreements where id = ${id}`;
    }
  });

  it("keeps re-services free and visits inside their machine (rules 7 and 14)", async () => {
    const id = await newAgreement();
    await sign(id);
    const t = await target();
    const insertVisit = (kind: string, status: string, price: number) =>
      asUser(
        ...owner(),
        (tx) => tx<{ id: string }[]>`insert into public.visits (tenant_id, agreement_id, account_id, property_id, service_type_id, kind, due_start, due_end, status, price_cents)
                                     values (${lakeshoreId}, ${id}, ${t.account_id}, ${t.property_id}, ${t.service_type_id}, ${kind}, '2027-02-01', '2027-02-07', ${status}, ${price}) returning id`,
      );
    try {
      await expect(insertVisit("reservice", "planned", 100)).rejects.toThrow(/visits_reservice_is_free/);
      await expect(insertVisit("recurring", "en_route", 12000)).rejects.toThrow(/starts planned or scheduled/);
      const [visit] = await insertVisit("recurring", "planned", 12000);
      await expect(asUser(...owner(), (tx) => tx`update public.visits set status = 'completed' where id = ${visit.id}`)).rejects.toThrow(/cannot move/);
      await asUser(...owner(), (tx) => tx`update public.visits set status = 'scheduled', scheduled_for = '2027-02-03', technician_id = ${lakeshoreOwner} where id = ${visit.id}`);
      await asUser(...owner(), (tx) => tx`update public.visits set status = 'completed' where id = ${visit.id}`);
      const [done] = await admin<{ completed_at: string | null }[]>`select completed_at from public.visits where id = ${visit.id}`;
      expect(done.completed_at).not.toBeNull();
      await expect(asUser(...owner(), (tx) => tx`update public.visits set status = 'planned' where id = ${visit.id}`)).rejects.toThrow(/cannot move/);
      const [free] = await insertVisit("reservice", "planned", 0);
      expect(free.id).toBeTruthy();
    } finally {
      await admin`delete from public.agreements where id = ${id}`;
    }
  });

  it("keeps visit status changes with dispatch and technicians, and a scheduled visit with a date and lead (rule 11, spec 05)", async () => {
    const officeId = await userId(seedUserEmail(lakeshore, "office"));
    const [scheduled] = await admin<{ id: string }[]>`select id from public.visits where tenant_id = ${lakeshoreId} and status = 'scheduled' limit 1`;
    expect(scheduled, "the seed schedules at least one Lakeshore visit").toBeTruthy();
    await expect(asUser(officeId, seedUserEmail(lakeshore, "office"), (tx) => tx`update public.visits set status = 'completed' where id = ${scheduled.id}`)).rejects.toThrow(/only dispatch or a technician/);
    const [planned] = await admin<{ id: string }[]>`select id from public.visits where tenant_id = ${lakeshoreId} and status = 'planned' limit 1`;
    await expect(asUser(...owner(), (tx) => tx`update public.visits set status = 'scheduled' where id = ${planned.id}`)).rejects.toThrow(/needs a date and a lead technician/);
  });

  it("keeps credentials readable by their owner, dispatch and compliance, and writable by compliance only (spec 05 rule 11)", async () => {
    const techEmail = seedUserEmail(lakeshore, "technician");
    const tech = await userId(techEmail);
    const own = await asUser(tech, techEmail, (tx) => tx<{ user_id: string }[]>`select user_id from public.applicator_credentials where tenant_id = ${lakeshoreId}`);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((r) => r.user_id === tech)).toBe(true);
    const dispatcherEmail = seedUserEmail(lakeshore, "dispatcher");
    const dispatcher = await userId(dispatcherEmail);
    const all = await asUser(dispatcher, dispatcherEmail, (tx) => tx`select id from public.applicator_credentials where tenant_id = ${lakeshoreId}`);
    expect(all.length).toBeGreaterThan(own.length);
    await expect(
      asUser(dispatcher, dispatcherEmail, (tx) => tx`insert into public.applicator_credentials (tenant_id, user_id, state_code, cert_number) values (${lakeshoreId}, ${dispatcher}, 'ZZ', 'X-1')`),
    ).rejects.toThrow(RLS_ERROR);
    const managerEmail = seedUserEmail(lakeshore, "compliance_manager");
    const manager = await userId(managerEmail);
    await expect(
      asUser(manager, managerEmail, (tx) => tx`insert into public.applicator_credentials (tenant_id, user_id, state_code, cert_number) values (${lakeshoreId}, ${northwindOwner}, 'ZZ', 'X-1')`),
    ).rejects.toThrow(/member of the company/);
    const [created] = await asUser(manager, managerEmail, (tx) => tx<{ id: string }[]>`insert into public.applicator_credentials (tenant_id, user_id, state_code, cert_number, categories) values (${lakeshoreId}, ${lakeshoreOwner}, 'ZZ', 'X-1', '{7A}') returning id`);
    try {
      const seenByOther = await asUser(northwindOwner, seedUserEmail(northwind, "owner"), (tx) => tx`select id from public.applicator_credentials where id = ${created.id}`);
      expect(seenByOther.length).toBe(0);
    } finally {
      await admin`delete from public.applicator_credentials where id = ${created.id}`;
    }
  });

  it("seeds cancel reasons for every tenant and protects ones in use (rule 10)", async () => {
    const reasons = await asUser(...owner(), (tx) => tx<{ key: string }[]>`select key from public.cancel_reasons where tenant_id = ${lakeshoreId}`);
    expect(reasons.map((r) => r.key)).toEqual(expect.arrayContaining(["price", "moved", "competitor", "other"]));
    const [used] = await admin<{ cancel_reason_id: string }[]>`select cancel_reason_id from public.agreements where tenant_id = ${lakeshoreId} and status = 'cancelled' and cancel_reason_id is not null limit 1`;
    await expect(asUser(...owner(), (tx) => tx`delete from public.cancel_reasons where id = ${used.cancel_reason_id}`)).rejects.toThrow(/in use/);
  });
});

describe("spec 06 rules enforced in the database", () => {
  const techEmail = seedUserEmail(lakeshore, "technician");
  const officeEmail = seedUserEmail(lakeshore, "office");
  let tech = "";
  let office = "";
  let visitId = "";

  beforeAll(async () => {
    tech = await userId(techEmail);
    office = await userId(officeEmail);
    const [visit] = await admin<{ id: string }[]>`
      select id from public.visits where tenant_id = ${lakeshoreId} and technician_id = ${tech} and status = 'in_progress' order by scheduled_for limit 1`;
    if (!visit) throw new Error("the seed starts one Lakeshore visit for the technician; run npm run seed");
    visitId = visit.id;
  });

  const masterProduct = async (epa: string) => (await admin<{ id: string }[]>`select id from public.products where tenant_id is null and epa_reg_no = ${epa}`)[0].id;

  it("lets the crew record at the stop and nobody else (rules 6 and 11)", async () => {
    const [note] = await asUser(tech, techEmail, (tx) => tx<{ id: string }[]>`insert into public.visit_notes (tenant_id, visit_id, kind, content) values (${lakeshoreId}, ${visitId}, 'note', 'rls suite') returning id`);
    try {
      expect(note.id).toBeTruthy();
      await expect(asUser(office, officeEmail, (tx) => tx`insert into public.visit_notes (tenant_id, visit_id, kind, content) values (${lakeshoreId}, ${visitId}, 'note', 'office')`)).rejects.toThrow(
        /row-level security|crew records at the stop/,
      );
      const otherTech = await userId(seedUserEmail(northwind, "technician"));
      await expect(asUser(otherTech, seedUserEmail(northwind, "technician"), (tx) => tx`insert into public.visit_notes (tenant_id, visit_id, kind, content) values (${lakeshoreId}, ${visitId}, 'note', 'x')`)).rejects.toThrow(RLS_ERROR);
    } finally {
      await admin`delete from public.visit_notes where id = ${note.id}`;
    }
  });

  it("refuses a product the company did not enable and a restricted-use product from a trainee (rules 2 and 3)", async () => {
    const line = (productId: string) =>
      asUser(tech, techEmail, (tx) => tx<{ id: string }[]>`
        insert into public.visit_products (tenant_id, visit_id, product_id, applied_by, site_treated, amount, amount_unit, target_pests)
        values (${lakeshoreId}, ${visitId}, ${productId}, ${tech}, 'perimeter', 1, 'fl_oz', '{ants}') returning id`);

    await expect(line(await masterProduct("432-763"))).rejects.toThrow(/not enabled for the company/);

    const [enabled] = await line(await masterProduct("100-1066"));
    await admin`delete from public.visit_products where id = ${enabled.id}`;

    const rup = await masterProduct("62719-4");
    const [{ had }] = await admin<{ had: boolean }[]>`select exists (select 1 from public.tenant_products where tenant_id = ${lakeshoreId} and product_id = ${rup}) as had`;
    await admin`insert into public.tenant_products (tenant_id, product_id, enabled, unit, unit_cost_cents) values (${lakeshoreId}, ${rup}, true, 'lb', 0) on conflict (tenant_id, product_id) do update set enabled = true`;
    await admin`update public.applicator_credentials set trainee_registered_on = current_date where tenant_id = ${lakeshoreId} and user_id = ${tech} and archived_at is null`;
    try {
      await expect(line(rup)).rejects.toThrow(/trainee cannot apply/);
    } finally {
      await admin`update public.applicator_credentials set trainee_registered_on = null where tenant_id = ${lakeshoreId} and user_id = ${tech} and archived_at is null`;
      if (!had) await admin`delete from public.tenant_products where tenant_id = ${lakeshoreId} and product_id = ${rup}`;
    }
  });

  it("keeps files inside their company (rule 8)", async () => {
    const [file] = await admin<{ id: string }[]>`select id from public.files where tenant_id = ${lakeshoreId} limit 1`;
    expect(file, "the seed stores a Lakeshore photo and signature").toBeTruthy();
    const own = await asUser(tech, techEmail, (tx) => tx`select id from public.files where id = ${file.id}`);
    expect(own.length).toBe(1);
    const otherTech = await userId(seedUserEmail(northwind, "technician"));
    const seenByOther = await asUser(otherTech, seedUserEmail(northwind, "technician"), (tx) => tx`select id from public.files where id = ${file.id}`);
    expect(seenByOther.length).toBe(0);
  });

  it("keeps a started visit with its technician: the office cannot move it and it never goes backwards (rules 1 and 6)", async () => {
    await expect(asUser(office, officeEmail, (tx) => tx`update public.visits set status = 'completed' where id = ${visitId}`)).rejects.toThrow(/only dispatch or a technician/);
    await expect(asUser(tech, techEmail, (tx) => tx`update public.visits set status = 'scheduled' where id = ${visitId}`)).rejects.toThrow(/cannot move from in_progress to scheduled/);
  });

  it("moves a visit forward only at the crew's hands, shows a crewmate the lead's credential, and refuses an expired applicator's restricted-use line (rules 1, 3 and 4)", async () => {
    const dispatcherEmail = seedUserEmail(lakeshore, "dispatcher");
    const dispatcher = await userId(dispatcherEmail);
    await expect(asUser(dispatcher, dispatcherEmail, (tx) => tx`update public.visits set status = 'completed' where id = ${visitId}`)).rejects.toThrow(/only the visit's crew/);

    // The office member cannot read the technician's credential until they share a crew with them.
    const before = await asUser(office, officeEmail, (tx) => tx`select id from public.applicator_credentials where tenant_id = ${lakeshoreId} and user_id = ${tech}`);
    expect(before.length).toBe(0);
    await admin`insert into public.visit_crew (tenant_id, visit_id, user_id, role) values (${lakeshoreId}, ${visitId}, ${office}, 'helper')`;
    try {
      const shared = await asUser(office, officeEmail, (tx) => tx<{ cert_number: string | null }[]>`select cert_number from public.applicator_credentials where tenant_id = ${lakeshoreId} and user_id = ${tech}`);
      expect(shared.length).toBe(1);
      expect(shared[0].cert_number).toBeTruthy();
    } finally {
      await admin`delete from public.visit_crew where visit_id = ${visitId} and user_id = ${office}`;
    }

    // A certification that lapsed before the visit date refuses a restricted-use line at sync.
    const rup = await masterProduct("62719-4");
    const [{ had }] = await admin<{ had: boolean }[]>`select exists (select 1 from public.tenant_products where tenant_id = ${lakeshoreId} and product_id = ${rup}) as had`;
    await admin`insert into public.tenant_products (tenant_id, product_id, enabled, unit, unit_cost_cents) values (${lakeshoreId}, ${rup}, true, 'lb', 0) on conflict (tenant_id, product_id) do update set enabled = true`;
    const [credential] = await admin<{ cert_expires_on: string | null }[]>`select cert_expires_on from public.applicator_credentials where tenant_id = ${lakeshoreId} and user_id = ${tech} and archived_at is null`;
    await admin`update public.applicator_credentials set cert_expires_on = (select scheduled_for - 1 from public.visits where id = ${visitId}) where tenant_id = ${lakeshoreId} and user_id = ${tech} and archived_at is null`;
    try {
      await expect(
        asUser(tech, techEmail, (tx) => tx`insert into public.visit_products (tenant_id, visit_id, product_id, applied_by, site_treated, amount, amount_unit, target_pests)
          values (${lakeshoreId}, ${visitId}, ${rup}, ${tech}, 'perimeter', 1, 'lb', '{termites}')`),
      ).rejects.toThrow(/is expired/);
    } finally {
      await admin`update public.applicator_credentials set cert_expires_on = ${credential.cert_expires_on} where tenant_id = ${lakeshoreId} and user_id = ${tech} and archived_at is null`;
      if (!had) await admin`delete from public.tenant_products where tenant_id = ${lakeshoreId} and product_id = ${rup}`;
    }

    // Every product line names a target pest (rule 2).
    const demand = await masterProduct("100-1066");
    await expect(
      asUser(tech, techEmail, (tx) => tx`insert into public.visit_products (tenant_id, visit_id, product_id, applied_by, site_treated, amount, amount_unit, target_pests)
        values (${lakeshoreId}, ${visitId}, ${demand}, ${tech}, 'perimeter', 0.5, 'fl_oz', '{}')`),
    ).rejects.toThrow(/visit_products_target_pests/);
  });
});

describe("spec 07 rules enforced in the database", () => {
  const managerEmail = seedUserEmail(lakeshore, "compliance_manager");
  const officeEmail = seedUserEmail(lakeshore, "office");
  const techEmail = seedUserEmail(lakeshore, "technician");
  let manager = "";
  let office = "";
  let tech = "";
  let recordId = "";
  let visitId = "";

  beforeAll(async () => {
    manager = await userId(managerEmail);
    office = await userId(officeEmail);
    tech = await userId(techEmail);
    const [record] = await admin<{ id: string; visit_id: string }[]>`
      select r.id, r.visit_id from public.application_records r join public.visits v on v.id = r.visit_id
      where r.tenant_id = ${lakeshoreId} and r.status = 'locked' and r.complete and v.technician_id = ${tech} order by r.business_date limit 1`;
    if (!record) throw new Error("the seed locks one complete Lakeshore record for the technician; run npm run seed");
    recordId = record.id;
    visitId = record.visit_id;
  });

  it("never changes a locked record (rule 3)", async () => {
    await expect(asUser(manager, managerEmail, (tx) => tx`update public.application_records set complete = false where id = ${recordId}`)).rejects.toThrow(/locked records change only by amendment/);
    await expect(admin`delete from public.application_records where id = ${recordId}`).rejects.toThrow(/locked records change only by amendment/);
  });

  it("takes amendments only from compliance.write, with a reason, and never edits them (rule 4)", async () => {
    const insert = (who: string, email: string, reason: string) =>
      asUser(who, email, (tx) => tx<{ id: string }[]>`insert into public.application_record_amendments (tenant_id, record_id, changed_fields, reason, author_id)
        values (${lakeshoreId}, ${recordId}, ${tx.json({ "conditions.sky": { from: "clear", to: "overcast" } })}, ${reason}, ${who}) returning id`);
    await expect(insert(office, officeEmail, "office tried")).rejects.toThrow(RLS_ERROR);
    await expect(insert(manager, managerEmail, " ")).rejects.toThrow(/reason|check constraint/);
    const [made] = await insert(manager, managerEmail, "rls suite");
    try {
      // No update policy exists, so a member's update touches nothing; the trigger refuses even the superuser.
      const touched = await asUser(manager, managerEmail, (tx) => tx`update public.application_record_amendments set reason = 'changed' where id = ${made.id}`);
      expect(touched.count).toBe(0);
      await expect(admin`update public.application_record_amendments set reason = 'changed' where id = ${made.id}`).rejects.toThrow(/append only/);
      await expect(admin`delete from public.application_record_amendments where id = ${made.id}`).rejects.toThrow(/append only/);
      const [row] = await admin<{ author_id: string }[]>`select author_id from public.application_record_amendments where id = ${made.id}`;
      expect(row.author_id).toBe(manager);
    } finally {
      await admin`alter table public.application_record_amendments disable trigger amendments_check`;
      await admin`delete from public.application_record_amendments where id = ${made.id}`;
      await admin`alter table public.application_record_amendments enable trigger amendments_check`;
    }
  });

  it("keeps a sent notice's proof, and keeps proof writes with compliance and dispatch (rules 8 and 11)", async () => {
    const [sent] = await admin<{ id: string }[]>`select id from public.notices where tenant_id = ${lakeshoreId} and status = 'sent' limit 1`;
    expect(sent, "the seed prints one Lakeshore notice").toBeTruthy();
    await expect(asUser(manager, managerEmail, (tx) => tx`update public.notices set proof = '{}'::jsonb where id = ${sent.id}`)).rejects.toThrow(/kept as proof/);
    await expect(asUser(manager, managerEmail, (tx) => tx`update public.notices set status = 'waived', waived_reason = 'x' where id = ${sent.id}`)).rejects.toThrow(/kept as proof/);
    // The office (agreements.read) reads notices but cannot write proof: its update touches nothing.
    // The messaging job sends the seed's electronic and mailed notices, so the test makes a printed one of its own.
    const [due] = await admin<{ id: string }[]>`
      insert into public.notices (tenant_id, kind, rule_key, required, dedupe_key, property_id, recipient_name, channel, status)
      select tenant_id, 'other', 'default', false, ${`rls:due:${Date.now()}`}, property_id, recipient_name, 'print', 'due' from public.notices where id = ${sent.id}
      returning id`;
    expect(due, "a due Lakeshore notice").toBeTruthy();
    const seen = await asUser(office, officeEmail, (tx) => tx`select id from public.notices where id = ${due.id}`);
    expect(seen.length).toBe(1);
    const byOffice = await asUser(office, officeEmail, (tx) => tx`update public.notices set status = 'sent', sent_at = now() where id = ${due.id}`);
    expect(byOffice.count).toBe(0);
  });

  it("shows a technician the records of their own visits and nothing else (rule 11)", async () => {
    const own = await asUser(tech, techEmail, (tx) => tx`select id from public.application_records where id = ${recordId}`);
    expect(own.length).toBe(1);
    const otherTech = await userId(seedUserEmail(northwind, "technician"));
    const notMine = await asUser(otherTech, seedUserEmail(northwind, "technician"), (tx) => tx`select id from public.application_records where id = ${recordId}`);
    expect(notMine.length).toBe(0);
    const [other] = await admin<{ id: string }[]>`select id from public.application_records where tenant_id = ${lakeshoreId} and visit_id <> ${visitId} and not exists (select 1 from public.visit_crew c where c.visit_id = application_records.visit_id and c.user_id = ${tech}) limit 1`;
    if (other) {
      const notOnCrew = await asUser(tech, techEmail, (tx) => tx`select id from public.application_records where id = ${other.id}`);
      expect(notOnCrew.length).toBe(0);
    }
    const foreignRegistry = await asUser(await userId(seedUserEmail(northwind, "office")), seedUserEmail(northwind, "office"), (tx) => tx`select id from public.notification_registries where tenant_id = ${lakeshoreId}`);
    expect(foreignRegistry.length).toBe(0);
  });

  it("matches properties to the registry on save and on re-match (rule 9)", async () => {
    const [entry] = await admin<{ normalized_address: string; state_code: string; registry_kind: string; id: string }[]>`select id, normalized_address, state_code, registry_kind from public.notification_registries where tenant_id = ${lakeshoreId} limit 1`;
    expect(entry, "the seed imports one Lakeshore registry row").toBeTruthy();
    const [property] = await admin<{ id: string; registry_matches: Record<string, string[]> }[]>`select id, registry_matches from public.properties where tenant_id = ${lakeshoreId} and normalized_address = ${entry.normalized_address} and state_code = ${entry.state_code} limit 1`;
    expect(property.registry_matches[entry.registry_kind]).toContain(entry.id);
    // Saving a property with a different address clears the match; saving it back restores it.
    await admin`update public.properties set normalized_address = ${`${entry.normalized_address} X`} where id = ${property.id}`;
    try {
      const [moved] = await admin<{ registry_matches: Record<string, string[]> }[]>`select registry_matches from public.properties where id = ${property.id}`;
      expect(moved.registry_matches).toEqual({});
    } finally {
      await admin`update public.properties set normalized_address = ${entry.normalized_address} where id = ${property.id}`;
    }
    const [back] = await admin<{ registry_matches: Record<string, string[]> }[]>`select registry_matches from public.properties where id = ${property.id}`;
    expect(back.registry_matches[entry.registry_kind]).toContain(entry.id);
    await expect(asUser(office, officeEmail, (tx) => tx`select app.rematch_registry_state(${lakeshoreId}, ${entry.state_code})`)).rejects.toThrow(/compliance.write/);
  });

  it("runs the compliance job twice without creating anything the second time (rule 1, rule 10)", async () => {
    const { runCompliance } = await import("../../lib/compliance/db");
    const [tenant] = await admin<{ timezone: string }[]>`select timezone from public.tenants where id = ${lakeshoreId}`;
    await admin.begin((tx) => runCompliance(tx, lakeshoreId, tenant.timezone));
    const again = await admin.begin((tx) => runCompliance(tx, lakeshoreId, tenant.timezone));
    expect(again).toEqual({ records: 0, locked: 0, notices: 0, tasks: 0 });
  });
});

describe("spec 08 rules enforced in the database", () => {
  const officeEmail = seedUserEmail(lakeshore, "office");
  const bookkeeperEmail = seedUserEmail(lakeshore, "bookkeeper");
  const techEmail = seedUserEmail(lakeshore, "technician");
  let office = "";
  let bookkeeper = "";
  let tech = "";
  let issuedId = "";
  let paidId = "";

  beforeAll(async () => {
    office = await userId(officeEmail);
    bookkeeper = await userId(bookkeeperEmail);
    tech = await userId(techEmail);
    const [issued] = await admin<{ id: string }[]>`select id from public.invoices where tenant_id = ${lakeshoreId} and status <> 'draft' and status <> 'void' order by issued_on limit 1`;
    const [paid] = await admin<{ id: string }[]>`select i.id from public.invoices i where i.tenant_id = ${lakeshoreId} and i.status = 'paid' and exists (select 1 from public.payment_allocations a where a.invoice_id = i.id) limit 1`;
    if (!issued || !paid) throw new Error("the seed issues and pays Lakeshore invoices; run npm run seed");
    issuedId = issued.id;
    paidId = paid.id;
  });

  it("never changes an issued invoice's number, lines, totals or source (rule 1)", async () => {
    await expect(asUser(office, officeEmail, (tx) => tx`update public.invoices set total_cents = total_cents + 1 where id = ${issuedId}`)).rejects.toThrow(/never changes/);
    await expect(asUser(office, officeEmail, (tx) => tx`update public.invoices set number = 999999 where id = ${issuedId}`)).rejects.toThrow(/never changes/);
    await expect(asUser(office, officeEmail, (tx) => tx`insert into public.invoice_lines (tenant_id, invoice_id, position, description, amount_cents) values (${lakeshoreId}, ${issuedId}, 99, 'late line', 100)`)).rejects.toThrow(/draft invoice/);
    await expect(admin`delete from public.invoices where id = ${issuedId}`).rejects.toThrow(/never deleted/);
    await expect(asUser(office, officeEmail, (tx) => tx`update public.invoices set status = 'draft' where id = ${issuedId}`)).rejects.toThrow(/cannot go back to draft/);
  });

  it("refuses to void a paid invoice and refuses allocations beyond the payment or the invoice (rules 7 and 9)", async () => {
    await expect(asUser(office, officeEmail, (tx) => tx`update public.invoices set status = 'void', void_reason = 'rls suite' where id = ${paidId}`)).rejects.toThrow(/cannot be voided/);
    const [paidInvoice] = await admin<{ account_id: string }[]>`select account_id from public.invoices where id = ${paidId}`;
    const [payment] = await asUser(office, officeEmail, (tx) => tx<{ id: string }[]>`insert into public.payments (tenant_id, account_id, method, amount_cents, recorded_by) values (${lakeshoreId}, ${paidInvoice.account_id}, 'cash', 100, ${office}) returning id`);
    try {
      await expect(asUser(office, officeEmail, (tx) => tx`insert into public.payment_allocations (tenant_id, payment_id, invoice_id, amount_cents) values (${lakeshoreId}, ${payment.id}, ${paidId}, 200)`)).rejects.toThrow(/exceed the payment/);
      await expect(asUser(office, officeEmail, (tx) => tx`insert into public.payment_allocations (tenant_id, payment_id, invoice_id, amount_cents) values (${lakeshoreId}, ${payment.id}, ${paidId}, 1)`)).rejects.toThrow(/exceed the invoice/);
    } finally {
      await admin`delete from public.payments where id = ${payment.id}`;
    }
  });

  it("keeps the crew to the invoice of their own stop, and lets the office void a draft (rules 9 and 15)", async () => {
    const [mine] = await admin<{ id: string; account_id: string; property_id: string }[]>`
      select v.id, v.account_id, v.property_id from public.visits v join public.visit_crew c on c.visit_id = v.id where v.tenant_id = ${lakeshoreId} and c.user_id = ${tech} limit 1`;
    expect(mine, "the seed gives the technician a crew visit").toBeTruthy();
    // A one-off charge is the office's to write, not the crew's.
    await expect(
      asUser(tech, techEmail, (tx) => tx`insert into public.payments (tenant_id, account_id, method, amount_cents, recorded_by) values (${lakeshoreId}, ${mine.account_id}, 'cash', 100, ${tech})`),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(tech, techEmail, (tx) => tx`insert into public.invoices (tenant_id, account_id, property_id, source, source_key, issued_on) values (${lakeshoreId}, ${mine.account_id}, ${mine.property_id}, 'manual', ${`rls:${Date.now()}`}, current_date)`),
    ).rejects.toThrow(/row-level security/);
    // A draft voids with a reason, number or not.
    const [draft] = await asUser(office, officeEmail, (tx) => tx<{ id: string }[]>`
      insert into public.invoices (tenant_id, account_id, property_id, source, source_key, issued_on) values (${lakeshoreId}, ${mine.account_id}, ${mine.property_id}, 'manual', ${`rls-draft:${Date.now()}`}, current_date) returning id`);
    // The void row stays: a void invoice is never deleted, by the same trigger that protects issued ones.
    await asUser(office, officeEmail, (tx) => tx`update public.invoices set status = 'void', void_reason = 'typed twice' where id = ${draft.id}`);
    const [after] = await admin<{ status: string; number: number | null }[]>`select status, number from public.invoices where id = ${draft.id}`;
    expect(after).toEqual({ status: "void", number: null });
  });

  it("tells the crew a stop's billing mode without opening the agreement (rule 15)", async () => {
    const [mine] = await admin<{ id: string; billing_mode: string }[]>`
      select v.id, a.billing_mode from public.visits v join public.agreements a on a.id = v.agreement_id join public.visit_crew c on c.visit_id = v.id
      where v.tenant_id = ${lakeshoreId} and c.user_id = ${tech} limit 1`;
    const [theirs] = await admin<{ id: string }[]>`
      select v.id from public.visits v where v.tenant_id = ${lakeshoreId} and v.agreement_id is not null
        and not exists (select 1 from public.visit_crew c where c.visit_id = v.id and c.user_id = ${tech}) limit 1`;
    expect(mine && theirs, "the seed gives the technician a crew visit on an agreement and leaves others").toBeTruthy();
    const seen = await asUser(tech, techEmail, (tx) => tx<{ billing_mode: string }[]>`select billing_mode from app.visit_agreement(${mine.id})`);
    expect(seen.map((r) => r.billing_mode)).toEqual([mine.billing_mode]);
    const hidden = await asUser(tech, techEmail, (tx) => tx`select billing_mode from app.visit_agreement(${theirs.id})`);
    expect(hidden.length).toBe(0);
    const agreements = await asUser(tech, techEmail, (tx) => tx`select id from public.agreements where tenant_id = ${lakeshoreId}`);
    expect(agreements.length, "the technician still reads no agreement rows").toBe(0);
  });

  it("lets the crew record cash for their own visit and nobody else's, and keeps the bookkeeper reading only (rule 15)", async () => {
    const [mine] = await admin<{ id: string; account_id: string }[]>`
      select v.id, v.account_id from public.visits v join public.visit_crew c on c.visit_id = v.id where v.tenant_id = ${lakeshoreId} and c.user_id = ${tech} limit 1`;
    const [theirs] = await admin<{ id: string; account_id: string }[]>`
      select v.id, v.account_id from public.visits v where v.tenant_id = ${lakeshoreId} and not exists (select 1 from public.visit_crew c where c.visit_id = v.id and c.user_id = ${tech}) limit 1`;
    expect(mine && theirs, "the seed gives the technician a crew visit and leaves others").toBeTruthy();
    const [cash] = await asUser(tech, techEmail, (tx) => tx<{ id: string }[]>`insert into public.payments (tenant_id, account_id, method, amount_cents, visit_id, recorded_by) values (${lakeshoreId}, ${mine.account_id}, 'cash', 2500, ${mine.id}, ${tech}) returning id`);
    try {
      expect(cash.id).toBeTruthy();
      await expect(asUser(tech, techEmail, (tx) => tx`insert into public.payments (tenant_id, account_id, method, amount_cents, visit_id, recorded_by) values (${lakeshoreId}, ${theirs.account_id}, 'cash', 2500, ${theirs.id}, ${tech})`)).rejects.toThrow(/only billing staff|row-level security/);
      await expect(asUser(tech, techEmail, (tx) => tx`insert into public.payments (tenant_id, account_id, method, amount_cents, recorded_by) values (${lakeshoreId}, ${mine.account_id}, 'cash', 2500, ${tech})`)).rejects.toThrow(/only billing staff|row-level security/);
    } finally {
      await admin`delete from public.payments where id = ${cash.id}`;
    }
    const read = await asUser(bookkeeper, bookkeeperEmail, (tx) => tx`select id from public.invoices where tenant_id = ${lakeshoreId}`);
    expect(read.length).toBeGreaterThan(0);
    await expect(asUser(bookkeeper, bookkeeperEmail, (tx) => tx`insert into public.invoices (tenant_id, account_id, source, source_key) values (${lakeshoreId}, ${mine.account_id}, 'manual', 'manual:rls')`)).rejects.toThrow(RLS_ERROR);
    await expect(asUser(office, officeEmail, (tx) => tx`insert into public.tax_rates (state_code, postal_code, jurisdiction_kind, jurisdiction_name, rate, effective_from, source) values ('ZZ', '99999', 'state', 'RLS', 0.01, '2026-01-01', 'rls suite')`)).rejects.toThrow(RLS_ERROR);
    const foreign = await asUser(northwindOwner, seedUserEmail(northwind, "owner"), (tx) => tx`select id from public.invoices where tenant_id = ${lakeshoreId}`);
    expect(foreign.length).toBe(0);
  });

  it("runs the billing job twice without creating anything the second time (rules 2 to 4, 8, 11)", async () => {
    const { runBilling } = await import("../../lib/billing/db");
    const [tenant] = await admin<{ timezone: string }[]>`select timezone from public.tenants where id = ${lakeshoreId}`;
    await admin.begin((tx) => runBilling(tx, lakeshoreId, tenant.timezone));
    const again = await admin.begin((tx) => runBilling(tx, lakeshoreId, tenant.timezone));
    expect(again).toMatchObject({ visits: 0, installments: 0, prepayments: 0, charged: 0, failed: 0, skipped: 0, late_fees: 0, allocated_cents: 0 });
  });
});

describe("spec 09 rules enforced in the database", () => {
  const bookkeeperEmail = seedUserEmail(lakeshore, "bookkeeper");
  const officeEmail = seedUserEmail(lakeshore, "office");
  const ownerEmail = seedUserEmail(lakeshore, "owner");
  let bookkeeper = "";
  let office = "";
  let owner = "";
  let vehicle = "";
  let foreignBank = "";
  const today = new Date().toISOString().slice(0, 10);
  const entry = (key: string, extra: Record<string, unknown> = {}) => ({ source_type: "manual", source_key: key, posted_on: today, memo: "rls", ...extra });
  const balanced = [
    { account_key: "vehicle_expense", debit_cents: 1250 },
    { account_key: "operating_bank", credit_cents: 1250 },
  ];


  beforeAll(async () => {
    bookkeeper = await userId(bookkeeperEmail);
    office = await userId(officeEmail);
    owner = await userId(ownerEmail);
    const rows = await admin<{ key: string; id: string; tenant_id: string }[]>`
      select key, id, tenant_id from public.gl_accounts where key in ('operating_bank', 'vehicle_expense') and tenant_id in (${lakeshoreId}, ${northwindId})`;
    vehicle = rows.find((r) => r.key === "vehicle_expense" && r.tenant_id === lakeshoreId)?.id ?? "";
    foreignBank = rows.find((r) => r.key === "operating_bank" && r.tenant_id === northwindId)?.id ?? "";
    if (!vehicle || !foreignBank) throw new Error("the seed creates the chart of accounts for both companies; run npm run seed");
  });

  it("refuses an entry that does not balance or has no lines (rule 1)", async () => {
    const key = `rls:unbalanced:${Date.now()}`;
    await expect(
      asUser(bookkeeper, bookkeeperEmail, (tx) => tx`select app.post_entry(${lakeshoreId}, ${tx.json(entry(key))}, ${tx.json([{ account_key: "vehicle_expense", debit_cents: 100 }, { account_key: "operating_bank", credit_cents: 90 }])})`),
    ).rejects.toThrow(/does not balance/);
    await expect(asUser(bookkeeper, bookkeeperEmail, (tx) => tx`select app.post_entry(${lakeshoreId}, ${tx.json(entry(key))}, ${tx.json([])})`)).rejects.toThrow(/needs lines/);
  });

  it("lets the bookkeeper post once per source key and the office not at all, and keeps the entry as posted (rules 11, 12 and 17)", async () => {
    const key = `rls:manual:${Date.now()}`;
    await expect(asUser(office, officeEmail, (tx) => tx`select app.post_entry(${lakeshoreId}, ${tx.json(entry(key))}, ${tx.json(balanced)})`)).rejects.toThrow(/gl\.write/);
    const [{ id }] = await asUser(bookkeeper, bookkeeperEmail, (tx) => tx<{ id: string }[]>`select app.post_entry(${lakeshoreId}, ${tx.json(entry(key))}, ${tx.json(balanced)}) as id`);
    expect(id).toBeTruthy();
    const [{ id: again }] = await asUser(bookkeeper, bookkeeperEmail, (tx) => tx<{ id: string }[]>`select app.post_entry(${lakeshoreId}, ${tx.json(entry(key))}, ${tx.json(balanced)}) as id`);
    expect(again).toBe(id);
    const lines = await asUser(bookkeeper, bookkeeperEmail, (tx) => tx<{ debit_cents: string; credit_cents: string }[]>`select debit_cents::text, credit_cents::text from public.journal_lines where entry_id = ${id} order by position`);
    expect(lines).toEqual([
      { debit_cents: "1250", credit_cents: "0" },
      { debit_cents: "0", credit_cents: "1250" },
    ]);
    // Nobody writes the journal directly: an update finds nothing it may touch, a line insert is refused, and a line
    // smuggled in under the posting flag onto an old entry is refused by the seal.
    const updated = await asUser(bookkeeper, bookkeeperEmail, (tx) => tx`update public.journal_entries set memo = 'changed' where id = ${id}`);
    expect(updated.count).toBe(0);
    await expect(
      asUser(bookkeeper, bookkeeperEmail, (tx) => tx`insert into public.journal_lines (tenant_id, entry_id, position, gl_account_id, debit_cents) values (${lakeshoreId}, ${id}, 9, ${vehicle}, 1)`),
    ).rejects.toThrow(/row-level security/);
    await expect(
      admin.begin(async (tx) => {
        await tx`select set_config('app.posting_entry', ${id}, true)`;
        await tx`insert into public.journal_lines (tenant_id, entry_id, position, gl_account_id, debit_cents) values (${lakeshoreId}, ${id}, 9, ${vehicle}, 1)`;
      }),
    ).rejects.toThrow(/through app\.post_entry/);
    await expect(admin`update public.journal_entries set memo = 'changed' where id = ${id}`).rejects.toThrow(/never change/);
    const [kept] = await admin<{ memo: string }[]>`select memo from public.journal_entries where id = ${id}`;
    expect(kept.memo).toBe("rls");
    const deleted = await asUser(bookkeeper, bookkeeperEmail, (tx) => tx`delete from public.journal_lines where entry_id = ${id}`);
    expect(deleted.count).toBe(0);
    const hidden = await asUser(office, officeEmail, (tx) => tx`select id from public.journal_entries where id = ${id}`);
    expect(hidden.length).toBe(0);
  });

  it("refuses a line on another company's account (rule 17)", async () => {
    const key = `rls:foreign:${Date.now()}`;
    await expect(
      asUser(bookkeeper, bookkeeperEmail, (tx) => tx`select app.post_entry(${lakeshoreId}, ${tx.json(entry(key))}, ${tx.json([{ gl_account_id: foreignBank, debit_cents: 100 }, { account_key: "operating_bank", credit_cents: 100 }])})`),
    ).rejects.toThrow(/another company/);
  });

  it("closes a period as the bookkeeper, refuses postings into it, and reopens it only as the owner (rules 9 and 10)", async () => {
    const period = "2099-01";
    await asUser(bookkeeper, bookkeeperEmail, (tx) => tx`insert into public.period_closes (tenant_id, period) values (${lakeshoreId}, ${period}) on conflict (tenant_id, period) do update set status = 'closed'`);
    await expect(
      asUser(bookkeeper, bookkeeperEmail, (tx) => tx`select app.post_entry(${lakeshoreId}, ${tx.json(entry(`rls:closed:${Date.now()}`, { posted_on: "2099-01-15" }))}, ${tx.json(balanced)})`),
    ).rejects.toThrow(/is closed/);
    // An event dated in the closed month, posted by someone who cannot read the closes, lands on the first open day.
    const [payment] = await admin<{ id: string }[]>`select id from public.payments where tenant_id = ${lakeshoreId} and kind = 'payment' and status = 'succeeded' limit 1`;
    const key = `rls:late-event:${Date.now()}`;
    const [{ id: lateId }] = await asUser(office, officeEmail, (tx) =>
      tx<{ id: string }[]>`select app.post_entry(${lakeshoreId}, ${tx.json({ source_type: "payment", source_id: payment.id, source_key: key, posted_on: "2099-01-20", memo: "late" })}, ${tx.json([{ account_key: "operating_bank", debit_cents: 1 }, { account_key: "accounts_receivable", credit_cents: 1 }])}) as id`,
    );
    const [moved] = await admin<{ posted_on: string; memo: string }[]>`select posted_on::text, memo from public.journal_entries where id = ${lateId}`;
    expect(moved.posted_on).toBe("2099-02-01");
    expect(moved.memo).toContain("dated 2099-01-20");
    await expect(
      asUser(bookkeeper, bookkeeperEmail, (tx) => tx`update public.period_closes set status = 'reopened', reopen_reason = 'rls' where tenant_id = ${lakeshoreId} and period = ${period}`),
    ).rejects.toThrow(/only an owner/);
    await asUser(owner, ownerEmail, (tx) => tx`update public.period_closes set status = 'reopened', reopen_reason = 'rls: the owner may' where tenant_id = ${lakeshoreId} and period = ${period}`);
    const [row] = await admin<{ id: string; status: string; reopened_by: string | null }[]>`select id, status, reopened_by from public.period_closes where tenant_id = ${lakeshoreId} and period = ${period}`;
    expect(row).toMatchObject({ status: "reopened", reopened_by: owner });
    const [{ n }] = await admin<{ n: number }[]>`select count(*)::int as n from public.audit_log where table_name = 'period_closes' and row_id = ${row.id}`;
    expect(n).toBeGreaterThan(0);
  });

  it("posts the office's void inline although the office cannot read the journal (review fix)", async () => {
    const [account] = await admin<{ id: string }[]>`select id from public.accounts where tenant_id = ${lakeshoreId} order by created_at limit 1`;
    const key = `rls-void:${Date.now()}`;
    const inv = await asUser(office, officeEmail, async (tx) => {
      const made = await createInvoice(tx, lakeshoreId, { account_id: account.id, property_id: null, source: "manual", source_key: key, issued_on: new Date().toISOString().slice(0, 10), lines: [{ description: "rls void", amount_cents: 700 }], issue: true });
      await voidInvoice(tx, lakeshoreId, made.id, "rls: entered twice", office);
      return made;
    });
    const entries = await admin<{ source_type: string; reverses: string | null }[]>`select source_type, reverses from public.journal_entries where tenant_id = ${lakeshoreId} and source_id = ${inv.id} order by number`;
    expect(entries.map((e) => e.source_type)).toEqual(["invoice", "void"]);
    expect(entries[1].reverses).toBeTruthy();
  });

  it("refuses reversing the reclass, a backdated reversal, a deferred revenue line with no agreement, and deactivating a template account (review fixes)", async () => {
    const [reclass] = await admin<{ id: string }[]>`select id from public.journal_entries where tenant_id = ${lakeshoreId} and source_type = 'reclass' and reversed_by is null limit 1`;
    expect(reclass, "the seed posts a period-end reclass").toBeTruthy();
    await expect(
      asUser(bookkeeper, bookkeeperEmail, (tx) => tx`select app.reverse_entry(${lakeshoreId}, ${reclass.id}, ${tx.json({ source_type: "reversal", source_key: `rls:rev-reclass:${Date.now()}`, posted_on: "2099-12-31", memo: "x" })})`),
    ).rejects.toThrow(/adjusted by the job/);
    const key = `rls:to-reverse:${Date.now()}`;
    const [{ id }] = await asUser(bookkeeper, bookkeeperEmail, (tx) => tx<{ id: string }[]>`select app.post_entry(${lakeshoreId}, ${tx.json(entry(key))}, ${tx.json(balanced)}) as id`);
    await expect(
      asUser(bookkeeper, bookkeeperEmail, (tx) => tx`select app.reverse_entry(${lakeshoreId}, ${id}, ${tx.json({ source_type: "reversal", source_key: `${key}:rev`, posted_on: "2020-01-01", memo: "x" })})`),
    ).rejects.toThrow(/dated today or later/);
    await expect(
      asUser(office, officeEmail, (tx) => tx`select app.reverse_entry(${lakeshoreId}, ${id}, ${tx.json({ source_type: "reversal", source_key: `${key}:rev2`, posted_on: "2099-12-31", memo: "x" })})`),
    ).rejects.toThrow(/gl\.write/);
    await expect(
      asUser(bookkeeper, bookkeeperEmail, (tx) => tx`select app.post_entry(${lakeshoreId}, ${tx.json(entry(`rls:cl:${Date.now()}`))}, ${tx.json([{ account_key: "contract_liability", debit_cents: 100 }, { account_key: "operating_bank", credit_cents: 100 }])})`),
    ).rejects.toThrow(/names its agreement/);
    await expect(asUser(bookkeeper, bookkeeperEmail, (tx) => tx`update public.gl_accounts set active = false where id = ${vehicle}`)).rejects.toThrow(/stay active/);
  });

  it("sweeps nothing the second time (rule 12)", async () => {
    const counts = await admin.begin((tx) => sweep(tx, lakeshoreId, lakeshore.timezone));
    expect(counts).toMatchObject({ invoices: 0, voids: 0, visits: 0, product_uses: 0, payments: 0, refunds: 0, payouts: 0 });
  });
});

describe("spec 10 rules enforced in the database", () => {
  const officeEmail = seedUserEmail(lakeshore, "office");
  const ownerEmail = seedUserEmail(lakeshore, "owner");
  const managerEmail = seedUserEmail(lakeshore, "compliance_manager");
  let office = "";
  let owner = "";
  let manager = "";

  beforeAll(async () => {
    office = await userId(officeEmail);
    owner = await userId(ownerEmail);
    manager = await userId(managerEmail);
  });

  it("lets only data.import write batches, and the licensed manager read the history files (rules 13 and 14)", async () => {
    await expect(
      asUser(office, officeEmail, (tx) => tx`insert into public.import_batches (tenant_id, status, cutover_on) values (${lakeshoreId}, 'dry_run', current_date)`),
    ).rejects.toThrow(/row-level security/);
    const [mine] = await asUser(owner, ownerEmail, (tx) => tx<{ id: string }[]>`insert into public.import_batches (tenant_id, status, cutover_on) values (${lakeshoreId}, 'dry_run', current_date) returning id`);
    expect(mine.id).toBeTruthy();
    await expect(admin`update public.import_batches set status = 'committed' where id = ${mine.id}`).rejects.toThrow(/never change/);
    const officeSees = await asUser(office, officeEmail, (tx) => tx`select id from public.import_batches where tenant_id = ${lakeshoreId}`);
    expect(officeSees.length).toBe(0);
    const history = await asUser(manager, managerEmail, (tx) => tx<{ kind: string }[]>`select kind from public.import_files where tenant_id = ${lakeshoreId}`);
    expect(history.length).toBeGreaterThan(0);
    expect(new Set(history.map((h) => h.kind))).toEqual(new Set(["history"]));
  });

  it("keeps a visit done before Bugsy as it was imported (rule 12)", async () => {
    const [visit] = await admin<{ id: string }[]>`select id from public.visits where tenant_id = ${lakeshoreId} and imported limit 1`;
    expect(visit, "the seed imports visits done before Bugsy").toBeTruthy();
    await expect(asUser(owner, ownerEmail, (tx) => tx`update public.visits set status = 'scheduled', scheduled_for = current_date, technician_id = ${owner} where id = ${visit.id}`)).rejects.toThrow(/stays as imported/);
    const [row] = await admin<{ completed_at: Date | null; departed_at: Date | null }[]>`select completed_at, departed_at from public.visits where id = ${visit.id}`;
    expect(row).toEqual({ completed_at: null, departed_at: null });
    await expect(
      asUser(owner, ownerEmail, (tx) => tx`insert into public.visits (tenant_id, account_id, property_id, service_type_id, kind, due_start, due_end, status) select tenant_id, account_id, property_id, service_type_id, 'one_time', current_date, current_date, 'completed' from public.visits where id = ${visit.id}`),
    ).rejects.toThrow(/completed when imported/);
  });

  it("shows a company its own old-system ids and never the other company's", async () => {
    const theirs = await asUser(owner, ownerEmail, (tx) => tx<{ tenant_id: string }[]>`select tenant_id from public.accounts where external_id = 'A-1001'`);
    expect(theirs.map((r) => r.tenant_id)).toEqual([lakeshoreId]);
  });
});

describe("spec 10 import outcomes on the seeded go-live", () => {
  const lakeshoreTz = () => SEED_TENANTS[1].timezone;
  class Rollback extends Error {}
  const rolledBack = async <T,>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> => {
    let out: T | undefined;
    await admin
      .begin(async (tx) => {
        out = await fn(tx);
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
    return out as T;
  };
  const agreement = async (ext: string) => (await admin<{ id: string }[]>`select id from public.agreements where tenant_id = ${lakeshoreId} and external_id = ${ext}`)[0];

  it("never bills what the old system billed: no installment or prepay before the cutover, no invoice for an imported visit (rule 8)", async () => {
    const early = await admin<{ n: number }[]>`
      select count(*)::int as n from public.invoices i join public.agreements a on a.id = i.agreement_id
      where i.tenant_id = ${lakeshoreId} and a.cutover_on is not null and i.source in ('installment', 'prepay') and i.issued_on < a.cutover_on`;
    expect(early[0].n).toBe(0);
    const g2 = await agreement("G-2");
    const prepay = await admin<{ n: number }[]>`select count(*)::int as n from public.invoices where agreement_id = ${g2.id} and source = 'prepay'`;
    expect(prepay[0].n).toBe(0);
    const visitInvoices = await admin<{ n: number }[]>`select count(*)::int as n from public.invoices i join public.visits v on v.id = i.visit_id where v.imported`;
    expect(visitInvoices[0].n).toBe(0);
  });

  it("keeps imported visits out of records, notices and revenue (rule 12)", async () => {
    const counts = await admin<{ records: number; notices: number; postings: number }[]>`
      select (select count(*)::int from public.application_records r join public.visits v on v.id = r.visit_id where v.imported) as records,
             (select count(*)::int from public.notices n join public.visits v on v.id = n.visit_id where v.imported) as notices,
             (select count(*)::int from public.journal_entries e join public.visits v on v.id = e.source_id where v.imported) as postings`;
    expect(counts[0]).toEqual({ records: 0, notices: 0, postings: 0 });
  });

  it("issues opening balances as they were: PO-required accounts too, the old due date, and never a late fee (rule 11)", async () => {
    const rows = await admin<{ external_id: string; status: string; due_on: string; po_required: boolean }[]>`
      select a.external_id, i.status, i.due_on::text, a.po_required from public.invoices i join public.accounts a on a.id = i.account_id
      where i.tenant_id = ${lakeshoreId} and i.source = 'opening' order by a.external_id`;
    expect(rows.find((r) => r.external_id === "A-1002")).toMatchObject({ po_required: true, due_on: "2026-10-30" });
    expect(rows.every((r) => r.status !== "draft")).toBe(true);
    const fees = await rolledBack(async (tx) => {
      await tx`update public.billing_settings set late_fee_cents = 1500 where tenant_id = ${lakeshoreId}`;
      const { applyLateFees, ensureSettings } = await import("../../lib/billing/db");
      const settings = await ensureSettings(tx, lakeshoreId);
      await applyLateFees(tx, lakeshoreId, settings, "2027-01-15");
      return tx<{ n: number }[]>`select count(*)::int as n from public.invoices f join public.invoices o on f.source_key = 'late_fee:' || o.id where o.tenant_id = ${lakeshoreId} and o.source = 'opening'`;
    });
    expect(fees[0].n).toBe(0);
  });

  it("settles an imported agreement on the old system's billing plus Bugsy's own, through a renewal (rule 10)", async () => {
    const { settlementFor, renewAgreement } = await import("../../lib/agreements/db");
    const g1 = await agreement("G-1");
    const s1 = await admin.begin((tx) => settlementFor(tx, lakeshoreId, g1.id, "2026-10-15"));
    // 40500 before go-live plus October's 4500; three visits (42000) were done before Bugsy.
    expect({ billed: s1.billedCents, recognized: s1.recognizedCents }).toEqual({ billed: 45000, recognized: 42000 });
    const g2 = await agreement("G-2");
    const renewed = await rolledBack(async (tx) => {
      await renewAgreement(tx, lakeshoreId, g2.id);
      const termTwo = await tx<{ cents: string }[]>`select coalesce(sum(price_cents), 0)::text as cents from public.visits where agreement_id = ${g2.id} and due_start >= '2027-03-01'`;
      return { settlement: await settlementFor(tx, lakeshoreId, g2.id, "2027-04-15"), termTwo: Number(termTwo[0].cents) };
    });
    expect(renewed.termTwo).toBeGreaterThan(0);
    expect(renewed.settlement.billedCents).toBe(45000 + renewed.termTwo);
  });

  it("imports an agreement whose term ended as ended, two balances for one account, and posts into the first open day after a closed cutover", async () => {
    const { runImport } = await import("../../lib/import/db");
    const { stubProvider } = await import("../../lib/geo/stub");
    const result = await rolledBack(async (tx) => {
      await tx`insert into public.period_closes (tenant_id, period) values (${lakeshoreId}, '2099-04') on conflict (tenant_id, period) do update set status = 'closed'`;
      const report = await runImport(tx, lakeshoreId, {
        cutoverOn: "2099-04-10",
        timeZone: lakeshoreTz(),
        batchId: crypto.randomUUID(),
        geocoder: stubProvider,
        files: {
          accounts: "external_id,name\nRLS-A,Edge Case Co\n",
          properties: "external_id,account_external_id,line1,city,state,postal_code,property_type\nRLS-P,RLS-A,9 Edge St,Columbus,OH,43215,house\n",
          agreements:
            "external_id,account_external_id,property_external_id,service_type,cadence,billing_mode,starts_on,initial_price,recurring_price,last_service_on\n" +
            "RLS-OLD,RLS-A,RLS-P,General pest plan,quarterly,flat_monthly,2097-01-01,100,100,2097-12-20\n" +
            "RLS-NOW,RLS-A,RLS-P,General pest plan,quarterly,flat_monthly,2099-01-01,180,120,2099-04-05\n",
          balances: "account_external_id,amount,as_of,reference\nRLS-A,10.00,2099-03-01,OLD-1\nRLS-A,20.00,2099-03-15,OLD-2\n",
        },
      });
      const ended = await tx<{ external_id: string; status: string }[]>`select external_id, status from public.agreements where tenant_id = ${lakeshoreId} and external_id like 'RLS-%' order by external_id`;
      const openings = await tx<{ posted_on: string }[]>`
        select e.posted_on::text from public.journal_entries e join public.agreements a on a.id = e.source_id where a.external_id = 'RLS-NOW' and e.source_type = 'opening'`;
      const invoices = await tx<{ n: number }[]>`select count(*)::int as n from public.invoices i join public.accounts a on a.id = i.account_id where a.external_id = 'RLS-A' and i.source = 'opening'`;
      return { report, ended, openings, invoices: invoices[0].n };
    });
    expect(result.report.errors).toEqual([]);
    expect(result.ended).toEqual([
      { external_id: "RLS-NOW", status: "active" },
      { external_id: "RLS-OLD", status: "ended" },
    ]);
    expect(result.openings).toEqual([{ posted_on: "2099-05-01" }]);
    expect(result.invoices).toBe(2);
    expect(result.report.warnings.map((w) => w.message).join(" ")).toMatch(/imported as ended.*|closed for 2099-04/);
  });

  it("lets no member mark a visit done before Bugsy outside an import (rules 12 and 14)", async () => {
    const techEmail = seedUserEmail(lakeshore, "technician");
    const tech = await userId(techEmail);
    const [visit] = await admin<{ id: string }[]>`select v.id from public.visits v join public.visit_crew c on c.visit_id = v.id where v.tenant_id = ${lakeshoreId} and c.user_id = ${tech} and not v.imported limit 1`;
    await expect(asUser(tech, techEmail, (tx) => tx`update public.visits set imported = true where id = ${visit.id}`)).rejects.toThrow(/only an import/);
    const dispatcherEmail = seedUserEmail(lakeshore, "dispatcher");
    const dispatcher = await userId(dispatcherEmail);
    await expect(
      asUser(dispatcher, dispatcherEmail, (tx) => tx`insert into public.visits (tenant_id, account_id, property_id, service_type_id, kind, due_start, due_end, status, imported) select tenant_id, account_id, property_id, service_type_id, 'one_time', current_date, current_date, 'completed', true from public.visits where id = ${visit.id}`),
    ).rejects.toThrow(/only an import/);
  });
});

describe("spec 11 rules enforced in the database", () => {
  const techEmail = seedUserEmail(lakeshore, "technician");
  const officeEmail = seedUserEmail(lakeshore, "office");
  let tech = "";
  let office = "";
  const message = (purpose: string, extra: Record<string, unknown> = {}) => ({ channel: "sms", purpose, to_address: "+16145550100", body: "rls", dedupe_key: `rls:${purpose}:${Date.now()}:${Math.random()}`, ...extra });

  beforeAll(async () => {
    tech = await userId(techEmail);
    office = await userId(officeEmail);
  });

  it("lets automations queue only what their event allows: the crew's on-the-way text, not a one-off message or a campaign (rule 14)", async () => {
    const [visit] = await admin<{ id: string; phone: string }[]>`
      select v.id, c.phone from public.visits v join public.visit_crew vc on vc.visit_id = v.id
        join public.contacts c on c.tenant_id = v.tenant_id and (c.account_id = v.account_id or c.property_id = v.property_id) and c.phone_digits is not null and c.archived_at is null
      where v.tenant_id = ${lakeshoreId} and vc.user_id = ${tech} limit 1`;
    const [other] = await admin<{ id: string }[]>`
      select v.id from public.visits v where v.tenant_id = ${lakeshoreId} and not exists (select 1 from public.visit_crew vc where vc.visit_id = v.id and vc.user_id = ${tech}) limit 1`;
    const own = (extra: Record<string, unknown> = {}) => message("on_the_way", { visit_id: visit.id, to_address: visit.phone, ...extra });
    const [{ id }] = await asUser(tech, techEmail, (tx) => tx<{ id: string }[]>`select app.queue_message(${lakeshoreId}, ${tx.json(own())}) as id`);
    expect(id).toBeTruthy();
    // Not a stop of theirs, and not someone at their stop: the crew sends only to their own customers.
    await expect(asUser(tech, techEmail, (tx) => tx`select app.queue_message(${lakeshoreId}, ${tx.json(own({ visit_id: other.id }))})`)).rejects.toThrow(/messages\.send/);
    await expect(asUser(tech, techEmail, (tx) => tx`select app.queue_message(${lakeshoreId}, ${tx.json(own({ to_address: "+16145550199" }))})`)).rejects.toThrow(/messages\.send/);
    await expect(asUser(tech, techEmail, (tx) => tx`select app.queue_message(${lakeshoreId}, ${tx.json(message("summary", { visit_id: other.id, to_address: visit.phone }))})`)).rejects.toThrow(/messages\.send/);
    await expect(asUser(tech, techEmail, (tx) => tx`select app.queue_message(${lakeshoreId}, ${tx.json(message("other"))})`)).rejects.toThrow(/messages\.send/);
    await expect(asUser(tech, techEmail, (tx) => tx`select app.queue_message(${northwindId}, ${tx.json(own())})`)).rejects.toThrow(/not a member/);
    const [{ id: officeId }] = await asUser(office, officeEmail, (tx) => tx<{ id: string }[]>`select app.queue_message(${lakeshoreId}, ${tx.json(message("other"))}) as id`);
    expect(officeId).toBeTruthy();
    await expect(asUser(office, officeEmail, (tx) => tx`insert into public.messages (tenant_id, direction, channel, purpose, to_address, body, status) values (${lakeshoreId}, 'outbound', 'sms', 'other', '+16145550100', 'direct', 'delivered')`)).rejects.toThrow(/row-level security/);
  });

  it("keeps a sent message as it was sent and moves its status only forward (rule 1)", async () => {
    const [sent] = await admin<{ id: string }[]>`select id from public.messages where tenant_id = ${lakeshoreId} and status = 'delivered' limit 1`;
    await expect(admin`update public.messages set body = 'changed' where id = ${sent.id}`).rejects.toThrow(/keeps what it said/);
    await expect(admin`update public.messages set status = 'queued' where id = ${sent.id}`).rejects.toThrow(/cannot move/);
    await expect(admin`delete from public.messages where id = ${sent.id}`).rejects.toThrow(/never deleted/);
  });

  it("marks a notice sent with the message that carried it as proof (rule 9)", async () => {
    const [n] = await admin<{ status: string; proof: { method?: string; message_id?: string } }[]>`select status, proof from public.notices where tenant_id = ${lakeshoreId} and channel = 'mail' limit 1`;
    expect(n.status).toBe("sent");
    const [m] = await admin<{ notice_id: string | null }[]>`select notice_id from public.messages where id = ${n.proof.message_id ?? null}`;
    expect(n.proof.method).toBe("mail");
    expect(m.notice_id).toBeTruthy();
  });

  it("keeps a sent notice's proof through a later receipt or bounce, and puts a bounce and a failed notice on the task list (rule 9)", async () => {
    const [base] = await admin<{ id: string; property_id: string; visit_id: string | null }[]>`select id, property_id, visit_id from public.notices where tenant_id = ${lakeshoreId} limit 1`;
    const notice = async (status: string) =>
      (
        await admin<{ id: string }[]>`
          insert into public.notices (tenant_id, kind, rule_key, required, dedupe_key, property_id, visit_id, recipient_name, channel, status)
          values (${lakeshoreId}, 'post_application', 'default', true, ${`rls:${status}:${Date.now()}:${Math.random()}`}, ${base.property_id}, ${base.visit_id}, 'RLS Resident', 'email', ${status})
          returning id`
      )[0].id;
    const carry = async (noticeId: string) =>
      (await admin<{ id: string }[]>`select app.queue_message(${lakeshoreId}, ${admin.json(message("notice", { channel: "email", to_address: "rls@example.com", notice_id: noticeId }))}) as id`)[0].id;
    const status = async (messageId: string, s: string, error: string | null = null) => admin`select app.record_message_status(${lakeshoreId}, ${messageId}, ${s}, 'postmark', ${`pm-${messageId}`}, ${error}, null)`;

    // Handed off: the notice is sent; the delivery receipt later changes the message only.
    const sentNotice = await notice("due");
    const m1 = await carry(sentNotice);
    await status(m1, "sent");
    await status(m1, "delivered");
    const [n1] = await admin<{ status: string; proof: { message_id: string } }[]>`select status, proof from public.notices where id = ${sentNotice}`;
    expect(n1.status).toBe("sent");
    expect(n1.proof.message_id).toBe(m1);
    const [d1] = await admin<{ status: string }[]>`select status from public.messages where id = ${m1}`;
    expect(d1.status).toBe("delivered");

    // A bounce after the hand-off keeps the proof and opens a task.
    const bounced = await notice("due");
    const m2 = await carry(bounced);
    await status(m2, "sent");
    await status(m2, "failed", "hard bounce");
    const [n2] = await admin<{ status: string }[]>`select status from public.notices where id = ${bounced}`;
    expect(n2.status).toBe("sent");
    const tasks = await admin<{ title: string }[]>`select title from public.compliance_tasks where subject_id = ${bounced} and kind = 'notice_undelivered' and status = 'open'`;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toMatch(/not delivered \(hard bounce\)/);

    // Proof recorded by hand first: the message that goes out later leaves it alone instead of failing the run.
    const manual = await notice("due");
    const m3 = await carry(manual);
    await admin`update public.notices set status = 'sent', proof = '{"method": "phone"}'::jsonb where id = ${manual}`;
    await status(m3, "sent");
    const [n3] = await admin<{ proof: { method: string } }[]>`select proof from public.notices where id = ${manual}`;
    expect(n3.proof.method).toBe("phone");

    // Refused before the hand-off: the notice fails and the compliance job lists it at once, before it is even due.
    const failed = await notice("due");
    const m4 = await carry(failed);
    await status(m4, "failed", "inactive recipient");
    const created = await admin.begin((tx) => refreshNoticeTasks(tx, lakeshoreId, lakeshore.timezone, new Date()));
    expect(created).toBeGreaterThan(0);
    const [t4] = await admin<{ title: string; status: string }[]>`select title, status from public.compliance_tasks where subject_id = ${failed} and kind = 'notice_overdue'`;
    expect(t4.status).toBe("open");
    expect(t4.title).toMatch(/could not be sent \(inactive recipient\)/);
  });

  it("opts a number out for its own company only, and shows the public page by token alone (rules 3 and 13)", async () => {
    const theirs = await asUser(office, officeEmail, (tx) => tx<{ tenant_id: string }[]>`select tenant_id from public.message_opt_outs`);
    expect(new Set(theirs.map((r) => r.tenant_id))).toEqual(new Set([lakeshoreId]));
    const [m] = await admin<{ token: string }[]>`select token from public.messages where tenant_id = ${lakeshoreId} and channel = 'email' and status = 'delivered' limit 1`;
    const view = await admin.begin(async (tx) => {
      await tx.unsafe("set local role anon");
      const page = await tx<{ company_name: string }[]>`select company_name from app.message_view(${m.token})`;
      const none = await tx`select 1 from app.message_view('00000000000000000000000000000000000000000000')`;
      const table = await tx`select 1 from public.messages limit 1`.catch(() => "refused");
      return { page, none: none.length, table };
    });
    expect(view.page[0].company_name).toBeTruthy();
    expect(view.none).toBe(0);
    expect(view.table === "refused" || (Array.isArray(view.table) && view.table.length === 0)).toBe(true);
  });
});

describe("spec 12 rules enforced in the database", () => {
  const officeEmail = seedUserEmail(lakeshore, "office");
  const dispatcherEmail = seedUserEmail(lakeshore, "dispatcher");
  let office = "";
  let dispatcher = "";
  const all = (key: string) => {
    const d = datasetFor(key);
    if (!d) throw new Error(`no dataset ${key}`);
    return d;
  };
  const run = (tx: Tx, key: string, tenantId: string) => {
    const d = all(key);
    const q = buildQuery({ columns: d.columns.map((c) => c.name), filters: [], group_by: [], aggregates: [] }, d, tenantId, 100_000);
    return tx.unsafe(q.text, q.params as never[]);
  };

  beforeAll(async () => {
    office = await userId(officeEmail);
    dispatcher = await userId(dispatcherEmail);
  });

  it("keeps a private report with its author and shows a shared one to every reports member (rule 11)", async () => {
    const seen = await asUser(dispatcher, dispatcherEmail, (tx) => tx<{ name: string; shared: boolean }[]>`select name, shared from public.saved_reports order by name`);
    expect(seen).toEqual([{ name: "Completed visits by technician", shared: true }]);
    const mine = await asUser(office, officeEmail, (tx) => tx<{ name: string }[]>`select name from public.saved_reports where not shared`);
    expect(mine.map((r) => r.name)).toEqual(["Open invoices by due date"]);
    // The owner's shared report is read-only to the office, and nobody saves a report in someone else's name.
    const changed = await asUser(office, officeEmail, (tx) => tx`update public.saved_reports set name = 'mine now' where shared returning id`);
    expect(changed).toHaveLength(0);
    await expect(
      asUser(office, officeEmail, (tx) => tx`insert into public.saved_reports (tenant_id, name, dataset, definition, created_by) values (${lakeshoreId}, 'forged', 'visits', '{}'::jsonb, ${lakeshoreOwner})`),
    ).rejects.toThrow(RLS_ERROR);
    // An owner may delete a report someone else shared.
    const [{ id }] = await asUser(office, officeEmail, (tx) => tx<{ id: string }[]>`insert into public.saved_reports (tenant_id, name, dataset, definition, shared) values (${lakeshoreId}, 'rls shared', 'visits', '{}'::jsonb, true) returning id`);
    const gone = await asUser(lakeshoreOwner, seedUserEmail(lakeshore, "owner"), (tx) => tx`delete from public.saved_reports where id = ${id} returning id`);
    expect(gone).toHaveLength(1);
  });

  it("lets an owner delete only their own and shared reports, even with no filter (rule 11)", async () => {
    const owner = seedUserEmail(lakeshore, "owner");
    const removed = await admin.begin(async (tx) => {
      await tx.unsafe("set local role authenticated");
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: lakeshoreOwner, email: owner, role: "authenticated" })}, true)`;
      const rows = await tx<{ name: string }[]>`delete from public.saved_reports returning name`;
      throw Object.assign(new Error("rollback"), { rows });
    }).catch((e: { rows?: { name: string }[] }) => e.rows ?? []);
    expect(removed.map((r) => r.name)).toEqual(["Completed visits by technician"]);
  });

  it("runs a report under the member's own permissions: the office sees no journal lines (rule 10)", async () => {
    const [{ n }] = await admin<{ n: number }[]>`select count(*)::int as n from public.journal_lines where tenant_id = ${lakeshoreId}`;
    expect(n).toBeGreaterThan(0);
    const lines = await asUser(office, officeEmail, (tx) => run(tx, "journal_lines", lakeshoreId));
    expect(lines).toHaveLength(0);
    const invoices = await asUser(office, officeEmail, (tx) => run(tx, "invoices", lakeshoreId));
    expect(invoices.length).toBeGreaterThan(0);
  });

  it("returns nothing from another company in any dataset, even when asked for it by id (rule 10)", async () => {
    const owner = seedUserEmail(northwind, "owner");
    for (const d of DATASETS) {
      const theirs = await asUser(northwindOwner, owner, (tx) => run(tx, d.key, lakeshoreId));
      expect(theirs, d.key).toHaveLength(0);
      const ours = await asUser(northwindOwner, owner, (tx) => run(tx, d.key, northwindId));
      expect(ours.length, d.key).toBeGreaterThan(0);
    }
  });
});

describe("spec 12 report queries", () => {
  const ROLLBACK = "rollback: fixture only";

  /** Runs `fn` over fixture rows written with triggers off, then throws so nothing stays. */
  async function withFixture<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    let out: T | undefined;
    await admin
      .begin(async (tx) => {
        await tx.unsafe("set local session_replication_role = replica");
        out = await fn(tx);
        throw new Error(ROLLBACK);
      })
      .catch((e: Error) => {
        if (e.message !== ROLLBACK) throw e;
      });
    return out as T;
  }

  it("counts a technician's stops, days, revenue, time on site, re-service rate and net product cost, leaving imported visits out (rule 5)", async () => {
    const tz = northwind.timezone;
    const tech = await userId(seedUserEmail(northwind, "technician"));
    const result = await withFixture(async (tx) => {
      const [g] = await tx<{ id: string; account_id: string; property_id: string; service_type_id: string }[]>`
        select id, account_id, property_id, service_type_id from public.agreements where tenant_id = ${northwindId} and status = 'active' limit 1`;
      const visit = async (v: { kind: string; agreement: boolean; price: number; completed: string; arrived?: string; departed?: string; imported?: boolean; created?: string }) =>
        (
          await tx<{ id: string }[]>`
            insert into public.visits (tenant_id, account_id, property_id, service_type_id, agreement_id, kind, due_start, due_end, status, technician_id, price_cents,
                                       completed_at, arrived_at, departed_at, imported, created_at)
            values (${northwindId}, ${g.account_id}, ${g.property_id}, ${g.service_type_id}, ${v.agreement ? g.id : null}, ${v.kind}, '2099-02-01', '2099-02-28', 'completed', ${tech}, ${v.price},
                    ${v.completed}, ${v.arrived ?? null}, ${v.departed ?? null}, ${v.imported ?? false}, ${v.created ?? v.completed})
            returning id`
        )[0].id;
      const v1 = await visit({ kind: "recurring", agreement: true, price: 10000, completed: "2099-02-01T10:00:00-05:00", arrived: "2099-02-01T09:00:00-05:00", departed: "2099-02-01T09:45:00-05:00" });
      await visit({ kind: "one_time", agreement: false, price: 5000, completed: "2099-02-01T14:00:00-05:00" });
      await visit({ kind: "reservice", agreement: true, price: 0, completed: "2099-02-02T11:00:00-05:00", arrived: "2099-02-02T10:00:00-05:00", departed: "2099-02-02T10:30:00-05:00", created: "2099-02-01T16:00:00-05:00" });
      await visit({ kind: "recurring", agreement: true, price: 9900, completed: "2099-02-03T10:00:00-05:00", imported: true });
      // 12.50 of product on v1, then reversed in the ledger and posted again at 8.00: the net cost is 8.00.
      const [vp] = await tx<{ id: string }[]>`
        insert into public.visit_products (tenant_id, visit_id, product_id, applied_by, site_treated, amount, amount_unit, target_pests)
        select tenant_id, ${v1}, product_id, applied_by, site_treated, amount, amount_unit, target_pests from public.visit_products where tenant_id = ${northwindId} limit 1 returning id`;
      const [cost] = await tx<{ id: string }[]>`select id from public.gl_accounts where tenant_id = ${northwindId} and key = 'chemical_cost'`;
      const entry = async (key: string, debit: number, credit: number, reverses: string | null, source: string) => {
        const [e] = await tx<{ id: string }[]>`
          insert into public.journal_entries (tenant_id, posted_on, source_type, source_id, source_key, reverses)
          values (${northwindId}, '2099-02-01', ${source}, ${source === "product_use" ? vp.id : null}, ${key}, ${reverses}) returning id`;
        await tx`insert into public.journal_lines (tenant_id, entry_id, position, gl_account_id, debit_cents, credit_cents) values (${northwindId}, ${e.id}, 1, ${cost.id}, ${debit}, ${credit})`;
        return e.id;
      };
      const first = await entry(`rls:use:${Date.now()}`, 1250, 0, null, "product_use");
      await entry(`rls:rev:${Date.now()}`, 0, 1250, first, "reversal");
      await entry(`rls:use2:${Date.now()}`, 800, 0, null, "product_use");
      return {
        withLedger: await technicianReport(tx, northwindId, tz, "2099-02-01", "2099-02-28", ["*"]),
        without: await technicianReport(tx, northwindId, tz, "2099-02-01", "2099-02-28", ["visits.read", "reports.read"]),
      };
    });
    expect(result.withLedger).toHaveLength(1);
    expect(result.withLedger[0]).toMatchObject({ stops: 3, working_days: 2, stops_per_day: 1.5, revenue_cents: 15000, minutes_on_site: 38, base: 2, reserviced: 1, reservice_rate: 0.5, product_cost_cents: 800 });
    expect(result.without[0].product_cost_cents).toBeNull();
  });

  it("ages receivables as they stood on the day: paid later still open, voided by then gone (rule 7)", async () => {
    const tz = lakeshore.timezone;
    const result = await withFixture(async (tx) => {
      const [a] = await tx<{ id: string }[]>`insert into public.accounts (tenant_id, type, name) values (${lakeshoreId}, 'residential', 'RLS Aging') returning id`;
      const invoice = async (key: string, issued: string, due: string, total: number, status: string, voided: string | null = null) =>
        (
          await tx<{ id: string }[]>`
            insert into public.invoices (tenant_id, account_id, source, source_key, kind, status, number, issued_on, due_on, total_cents, paid_cents, voided_at, void_reason)
            values (${lakeshoreId}, ${a.id}, 'manual', ${key}, 'invoice', ${status}, ${900000 + Math.floor(Math.random() * 99999)}, ${issued}, ${due}, ${total}, ${status === "paid" ? total : 0}, ${voided},
                    ${voided ? "billed in error" : null}) returning id`
        )[0].id;
      const paid = await invoice(`rls:aging:paid:${Date.now()}`, "2099-01-01", "2099-01-31", 10000, "paid");
      await invoice(`rls:aging:open:${Date.now()}`, "2099-03-01", "2099-03-31", 5000, "issued");
      await invoice(`rls:aging:void:${Date.now()}`, "2099-01-05", "2099-01-20", 7000, "void", "2099-02-10T12:00:00-06:00");
      const [p] = await tx<{ id: string }[]>`
        insert into public.payments (tenant_id, account_id, method, amount_cents, received_at) values (${lakeshoreId}, ${a.id}, 'check', 10000, '2099-03-15T12:00:00-05:00') returning id`;
      await tx`insert into public.payment_allocations (tenant_id, payment_id, invoice_id, amount_cents) values (${lakeshoreId}, ${p.id}, ${paid}, 10000)`;
      const mine = async (day: string) => (await arAging(tx, lakeshoreId, tz, day)).rows.find((r) => r.account_id === a.id)?.buckets ?? null;
      return { jan: await mine("2099-01-25"), mar1: await mine("2099-03-01"), mar20: await mine("2099-03-20") };
    });
    expect(result.jan).toMatchObject({ current: 10000, "1 to 30": 7000 });
    expect(result.mar1).toMatchObject({ current: 5000, "1 to 30": 10000, "31 to 60": 0 });
    expect(result.mar20).toMatchObject({ current: 5000, "1 to 30": 0 });
  });

  it("closes won over won plus lost by source, counting open leads but not in the rate (rule 8)", async () => {
    const result = await withFixture(async (tx) => {
      const [src] = await tx<{ id: string; name: string }[]>`select id, name from public.lead_sources where tenant_id = ${lakeshoreId} order by name limit 1`;
      for (const stage of ["won", "won", "lost", "new"]) {
        await tx`insert into public.leads (tenant_id, source_id, name, stage, created_at) values (${lakeshoreId}, ${src.id}, ${`RLS ${stage}`}, ${stage}, '2099-02-10T12:00:00-06:00')`;
      }
      return { src: src.name, report: await salesBySource(tx, lakeshoreId, lakeshore.timezone, "2099-02-01", "2099-02-28") };
    });
    expect(result.report.rows).toEqual([{ source: result.src, leads: 4, won: 2, lost: 1, open: 1, rate: 2 / 3 }]);
    expect(result.report.total).toMatchObject({ leads: 4, won: 2, lost: 1, open: 1 });
  });
});

describe("spec 13 rules enforced in the database", () => {
  const ownerEmail = seedUserEmail(lakeshore, "owner");
  const officeEmail = seedUserEmail(lakeshore, "office");
  let adminId = "";
  let office = "";
  const ROLLBACK = "rollback: spec 13";

  /** Runs `fn` in one transaction that is always rolled back; `as` switches the session to a user inside it. */
  async function rolledBack<T>(fn: (tx: Tx, as: (id: string, email: string) => Promise<void>) => Promise<T>): Promise<T> {
    let out: T | undefined;
    await admin
      .begin(async (tx) => {
        const as = async (id: string, email: string) => {
          await tx.unsafe("set local role authenticated");
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: id, email, role: "authenticated" })}, true)`;
        };
        out = await fn(tx, as);
        throw new Error(ROLLBACK);
      })
      .catch((e: Error) => {
        if (e.message !== ROLLBACK) throw e;
      });
    return out as T;
  }

  beforeAll(async () => {
    adminId = await userId(PLATFORM_ADMIN_EMAIL);
    office = await userId(officeEmail);
  });

  it("puts the write guard on every tenant table but the audit trail and the support tables", async () => {
    const guarded = new Set((await admin<{ name: string }[]>`select c.relname as name from pg_trigger g join pg_class c on c.oid = g.tgrelid where g.tgname = 'tenant_write_guard'`).map((r) => r.name));
    const missing = tenantTables().filter((t) => !["audit_log", "support_grants", "support_access_log"].includes(t.name) && !guarded.has(t.name)).map((t) => t.name);
    expect(missing).toEqual([]);
  });

  it("shows a company's data to support only while an owner's approval is live, read only, and logs it (rules 1 to 5)", async () => {
    const asAdmin = <T>(fn: (tx: Tx) => Promise<T>) => asUser(adminId, PLATFORM_ADMIN_EMAIL, fn);
    const accounts = (tenant: string) => asAdmin((tx) => tx`select id from public.accounts where tenant_id = ${tenant}`);
    const [{ id: grant }] = await asAdmin((tx) => tx<{ id: string }[]>`select app.request_support(${lakeshoreId}, 'read', 2, 'Checking a statement footer') as id`);
    try {
      expect(await accounts(lakeshoreId)).toHaveLength(0);
      await expect(asAdmin((tx) => tx`select app.request_support(${lakeshoreId}, 'read', 2, 'A second request at once')`)).rejects.toThrow(/already open/);
      await expect(asAdmin((tx) => tx`select app.request_support(${northwindId}, 'read', 2, 'short')`)).rejects.toThrow(/check constraint/);
      await expect(asAdmin((tx) => tx`select app.request_support(${northwindId}, 'read', 73, 'Too many hours asked')`)).rejects.toThrow(/check constraint/);
      await expect(asUser(office, officeEmail, (tx) => tx`select app.decide_support(${grant}, true)`)).rejects.toThrow(/only an owner/);
      await asUser(lakeshoreOwner, ownerEmail, (tx) => tx`select app.decide_support(${grant}, true)`);

      expect((await accounts(lakeshoreId)).length).toBeGreaterThan(0);
      expect(await accounts(northwindId)).toHaveLength(0);
      // Read only: write policies match no row, and anything a policy would let through meets the write guard.
      expect((await asAdmin((tx) => tx`update public.accounts set name = name where tenant_id = ${lakeshoreId}`)).count).toBe(0);
      await expect(asAdmin((tx) => tx`insert into public.accounts (tenant_id, type, name) values (${lakeshoreId}, 'residential', 'By support')`)).rejects.toThrow(/read only|row-level security/);
      // sync_log lets any member write their own rows; under a read grant the write guard is what refuses it.
      await expect(
        asAdmin((tx) => tx`insert into public.sync_log (tenant_id, user_id, client_change_id, kind, result) values (${lakeshoreId}, ${adminId}, ${crypto.randomUUID()}, 'note', 'applied')`),
      ).rejects.toThrow(/support access to this company is read only/);
      const [{ owner }] = await asAdmin((tx) => tx<{ owner: boolean }[]>`select app.is_owner(${lakeshoreId}) as owner`);
      expect(owner).toBe(false);

      await asAdmin((tx) => tx`select app.log_support_access(${lakeshoreId}, '/customers', 'GET')`);
      const seenByOwner = await asUser(lakeshoreOwner, ownerEmail, (tx) => tx<{ path: string }[]>`select path from public.support_access_log where grant_id = ${grant}`);
      expect(seenByOwner.map((r) => r.path)).toEqual(["/customers"]);
      const seenByOffice = await asUser(office, officeEmail, (tx) => tx`select 1 from public.support_access_log`);
      expect(seenByOffice).toHaveLength(0);
      // A member is never logged as support.
      await asUser(lakeshoreOwner, ownerEmail, (tx) => tx`select app.log_support_access(${lakeshoreId}, '/owner-page', 'GET')`);
      const [{ n }] = await admin<{ n: number }[]>`select count(*)::int as n from public.support_access_log where path = '/owner-page'`;
      expect(n).toBe(0);
    } finally {
      await asUser(lakeshoreOwner, ownerEmail, (tx) => tx`select app.revoke_support(${grant})`).catch(() => undefined);
    }
    expect(await accounts(lakeshoreId)).toHaveLength(0);
    await asAdmin((tx) => tx`select app.log_support_access(${lakeshoreId}, '/after', 'GET')`);
    const [{ after }] = await admin<{ after: number }[]>`select count(*)::int as after from public.support_access_log where path = '/after'`;
    expect(after).toBe(0);
  });

  it("lets a write grant change data but never people or settings, and ends it on the clock (rule 4)", async () => {
    const result = await rolledBack(async (tx, as) => {
      await tx`insert into public.support_grants (tenant_id, user_id, user_email, access, reason, hours, approved, decided_at, decided_by, expires_at)
               values (${lakeshoreId}, ${adminId}, ${PLATFORM_ADMIN_EMAIL}, 'write', 'Fixing an import mapping', 1, true, now(), ${lakeshoreOwner}, now() + interval '1 hour')`;
      await as(adminId, PLATFORM_ADMIN_EMAIL);
      const updated = (await tx`update public.accounts set name = name where tenant_id = ${lakeshoreId}`).count;
      const [role] = await tx<{ id: string }[]>`select id from public.roles where tenant_id is null and key = 'office'`;
      const invite = await tx.savepoint((sp) => sp`insert into public.invitations (tenant_id, email, role_id) values (${lakeshoreId}, 'support-made@example.com', ${role.id})`).then(() => "inserted", (e: Error) => e.message);
      const [{ settings }] = await tx<{ settings: boolean }[]>`select app.has_permission(${lakeshoreId}, 'settings.write') as settings`;
      return { updated, invite, settings };
    });
    expect(result.updated).toBeGreaterThan(0);
    expect(result.invite).toMatch(/row-level security/);
    expect(result.settings).toBe(false);
    const expired = await rolledBack(async (tx, as) => {
      await tx`insert into public.support_grants (tenant_id, user_id, user_email, access, reason, hours, approved, decided_at, decided_by, expires_at)
               values (${lakeshoreId}, ${adminId}, ${PLATFORM_ADMIN_EMAIL}, 'write', 'An old grant, now over', 1, true, now() - interval '2 hours', ${lakeshoreOwner}, now() - interval '1 hour')`;
      await as(adminId, PLATFORM_ADMIN_EMAIL);
      return (await tx`select 1 from public.accounts where tenant_id = ${lakeshoreId}`).length;
    });
    expect(expired).toBe(0);
  });

  it("makes a suspended company read only to its own owner, and keeps its status with platform staff (rule 7)", async () => {
    const result = await rolledBack(async (tx, as) => {
      await tx`update public.tenants set status = 'suspended', status_reason = 'rls' where id = ${lakeshoreId}`;
      await as(lakeshoreOwner, ownerEmail);
      const read = (await tx`select 1 from public.accounts where tenant_id = ${lakeshoreId}`).length;
      const write = await tx.savepoint((sp) => sp`update public.accounts set name = name where tenant_id = ${lakeshoreId}`).then(() => "written", (e: Error) => e.message);
      const reopen = await tx.savepoint((sp) => sp`update public.tenants set status = 'active' where id = ${lakeshoreId}`).then(() => "reopened", (e: Error) => e.message);
      return { read, write, reopen };
    });
    expect(result.read).toBeGreaterThan(0);
    expect(result.write).toMatch(/suspended and read only/);
    expect(result.reopen).toMatch(/read only/);
    await expect(asUser(lakeshoreOwner, ownerEmail, (tx) => tx`update public.tenants set status = 'archived' where id = ${lakeshoreId}`)).rejects.toThrow(/only platform staff/);
  });

  it("purges only an archived company past 90 days whose records are past retention (rule 8)", async () => {
    const purge = (tenant: string) => asUser(adminId, PLATFORM_ADMIN_EMAIL, (tx) => tx`select app.purge_tenant(${tenant})`);
    await expect(purge(lakeshoreId)).rejects.toThrow(/only an archived company/);
    const underRetention = await rolledBack(async (tx, as) => {
      await tx`update public.tenants set status = 'archived' where id = ${lakeshoreId}`;
      await tx`update public.tenants set archived_at = now() - interval '100 days' where id = ${lakeshoreId}`;
      await as(adminId, PLATFORM_ADMIN_EMAIL);
      return tx`select app.purge_tenant(${lakeshoreId})`.then(() => "purged", (e: Error) => e.message);
    });
    expect(underRetention).toMatch(/still under retention/);
    await expect(asUser(lakeshoreOwner, ownerEmail, (tx) => tx`select app.purge_tenant(${lakeshoreId})`)).rejects.toThrow(/only platform staff/);

    const [gone] = await admin<{ id: string }[]>`insert into public.tenants (name, timezone) values (${`RLS purge ${Date.now()}`}, 'America/Chicago') returning id`;
    await admin`insert into public.branches (tenant_id, name, address, state_code) values (${gone.id}, 'Only branch', '1 Main St, Springfield, IL 62701', 'IL')`;
    await admin`insert into public.accounts (tenant_id, type, name) values (${gone.id}, 'residential', 'Left with the company')`;
    await admin`update public.tenants set status = 'archived' where id = ${gone.id}`;
    await expect(purge(gone.id)).rejects.toThrow(/archived less than 90 days ago/);
    await admin`update public.tenants set archived_at = now() - interval '91 days' where id = ${gone.id}`;
    await purge(gone.id);
    const [{ left }] = await admin<{ left: number }[]>`
      select (select count(*) from public.tenants where id = ${gone.id}) + (select count(*) from public.accounts where tenant_id = ${gone.id}) + (select count(*) from public.branches where tenant_id = ${gone.id}) as left`;
    expect(Number(left)).toBe(0);
    const [record] = await admin<{ row_counts: Record<string, number> }[]>`select row_counts from public.tenant_purges where former_tenant_id = ${gone.id}`;
    expect(record.row_counts).toMatchObject({ accounts: 1, branches: 1 });
  });

  it("works out the setup checklist from the data, for settings readers and platform staff only (rule 9)", async () => {
    const [{ status }] = await asUser(lakeshoreOwner, ownerEmail, (tx) => tx<{ status: Record<string, boolean> }[]>`select app.onboarding_status(${lakeshoreId}) as status`);
    expect(status).toMatchObject({ branch: true, service_types: true, customers: true, team: true });
    const tech = seedUserEmail(lakeshore, "technician");
    await expect(asUser(await userId(tech), tech, (tx) => tx`select app.onboarding_status(${lakeshoreId})`)).rejects.toThrow(/settings\.read/);
    const overview = await asUser(adminId, PLATFORM_ADMIN_EMAIL, (tx) => tx<{ tenant_id: string; accounts: number }[]>`select tenant_id, accounts from app.platform_overview()`);
    expect(overview.find((o) => o.tenant_id === lakeshoreId)?.accounts).toBeGreaterThan(0);
    await expect(asUser(lakeshoreOwner, ownerEmail, (tx) => tx`select * from app.platform_overview()`)).rejects.toThrow(/platform staff/);
  });
});
