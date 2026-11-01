import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { type Claims, type Tx, withRls } from "@/lib/db";
import { can } from "@/lib/auth/permissions";
import { type GrantAccess, grantPermissions } from "@/lib/platform/support";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type Session = {
  userId: string;
  email: string;
  claims: Claims;
};

export type Membership = {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantTimezone: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
  branchIds: string[] | null;
  /** active, suspended or archived (spec 13): anything but active is read only. */
  tenantStatus: string;
  /** Set when this is platform support working under a live grant rather than a member (spec 13). */
  support: { grantId: string; access: GrantAccess; expiresAt: string } | null;
};

/** The signed-in user, verified with Supabase Auth. Cached per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const email = user.email ?? "";
  return { userId: user.id, email, claims: { sub: user.id, email, role: "authenticated" } };
});

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}

/** Runs a query as the signed-in user, under row level security. */
export function dbAs<T>(session: Session, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withRls(session.claims, fn);
}

type MembershipRow = {
  id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_timezone: string;
  tenant_status: string;
  role_id: string;
  role_key: string;
  role_name: string;
  permissions: string[];
  branch_ids: string[] | null;
};

type GrantRow = { id: string; tenant_id: string; tenant_name: string; tenant_timezone: string; tenant_status: string; access: GrantAccess; expires_at: Date };

/**
 * Every company the user can open: their memberships, archived companies included (read only, spec 13 rule 7), and
 * for platform support each company they hold a live grant on. The database only returns what the user may see.
 */
export const listMemberships = cache(async (session: Session): Promise<Membership[]> => {
  const { rows, grants } = await dbAs(session, async (tx) => ({
    rows: await tx<MembershipRow[]>`
      select m.id, m.tenant_id, t.name as tenant_name, t.timezone as tenant_timezone, t.status as tenant_status,
             r.id as role_id, r.key as role_key, r.name as role_name, r.permissions, m.branch_ids
      from public.memberships m
      join public.tenants t on t.id = m.tenant_id
      join public.roles r on r.id = m.role_id
      where m.user_id = auth.uid()
      order by t.name`,
    grants: await tx<GrantRow[]>`
      select distinct on (g.tenant_id) g.id, g.tenant_id, t.name as tenant_name, t.timezone as tenant_timezone, t.status as tenant_status, g.access, g.expires_at
      from public.support_grants g join public.tenants t on t.id = g.tenant_id
      where g.user_id = auth.uid() and g.approved and g.revoked_at is null and now() < g.expires_at and app.support_access(g.tenant_id) is not null
        and not exists (select 1 from public.memberships m where m.tenant_id = g.tenant_id and m.user_id = auth.uid())
      order by g.tenant_id, (g.access = 'write') desc, g.expires_at desc`,
  }));
  const members = rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name,
    tenantTimezone: r.tenant_timezone,
    roleId: r.role_id,
    roleKey: r.role_key,
    roleName: r.role_name,
    permissions: r.permissions,
    branchIds: r.branch_ids,
    tenantStatus: r.tenant_status,
    support: null,
  }));
  const support = grants.map(
    (g): Membership => ({
      id: g.id,
      tenantId: g.tenant_id,
      tenantName: g.tenant_name,
      tenantTimezone: g.tenant_timezone,
      roleId: "",
      roleKey: "support",
      roleName: g.access === "read" ? "Platform support, read only" : "Platform support",
      permissions: grantPermissions(g.access),
      branchIds: null,
      tenantStatus: g.tenant_status,
      support: { grantId: g.id, access: g.access, expiresAt: g.expires_at.toISOString() },
    }),
  );
  return [...members, ...support].sort((a, b) => a.tenantName.localeCompare(b.tenantName));
});

/**
 * Rule 5 of spec 13: a page, download or action opened under a support grant writes one access-log row, with the path
 * the proxy put on the request. Cached, so a request that resolves the company several times logs once.
 */
export const noteSupportAccess = cache(async (session: Session, tenantId: string): Promise<void> => {
  const h = await headers();
  const path = h.get("x-bugsy-path") ?? "(unknown)";
  const method = h.get("next-action") ? "POST" : (h.get("x-bugsy-method") ?? "GET");
  await dbAs(session, (tx) => tx`select app.log_support_access(${tenantId}, ${path}, ${method})`);
});

/** The user's membership in `tenantId`, or a redirect home when they have none. */
export async function requireMembership(tenantId: string): Promise<{ session: Session; membership: Membership }> {
  const session = await requireSession();
  const membership = (await listMemberships(session)).find((m) => m.tenantId === tenantId);
  if (!membership) redirect("/");
  if (membership.support) await noteSupportAccess(session, tenantId);
  return { session, membership };
}

/** Like requireMembership, and the membership's role must grant `permission`. */
export async function requirePermission(
  tenantId: string,
  permission: string,
): Promise<{ session: Session; membership: Membership }> {
  const result = await requireMembership(tenantId);
  if (!can(result.membership.permissions, permission)) redirect("/?error=forbidden");
  return result;
}

export const isPlatformAdmin = cache(async (session: Session): Promise<boolean> => {
  const [row] = await dbAs(session, (tx) => tx<{ admin: boolean }[]>`select app.is_platform_admin() as admin`);
  return row?.admin ?? false;
});

export async function requirePlatformAdmin(): Promise<Session> {
  const session = await requireSession();
  if (!(await isPlatformAdmin(session))) redirect("/?error=forbidden");
  return session;
}
