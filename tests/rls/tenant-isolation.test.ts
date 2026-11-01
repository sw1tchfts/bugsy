// Tenant isolation lives in Postgres row level security. This suite discovers every table in the public
// schema and proves, signed in as a Northwind user, that Lakeshore rows cannot be selected, inserted, updated
// or deleted. New tables are covered automatically; a table missing row level security fails the suite.
// It also covers the spec's business rules that live in the database: helper function properties, platform
// admin boundaries, invitations, the last-owner rule and the audit trail.

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_TYPES } from "../../lib/pg-types";
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
    // and platform admins read them in order to approve them. Every other tenant table stays closed.
    for (const t of tenantTables().filter((t) => t.name !== "tenants" && t.name !== "products")) {
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
    const [due] = await admin<{ id: string }[]>`select id from public.notices where tenant_id = ${lakeshoreId} and status = 'due' limit 1`;
    expect(due, "the seed leaves Lakeshore notices due").toBeTruthy();
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
