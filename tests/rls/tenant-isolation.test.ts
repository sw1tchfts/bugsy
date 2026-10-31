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
