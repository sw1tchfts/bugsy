import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { type Claims, type Tx, withRls } from "@/lib/db";
import { can } from "@/lib/auth/permissions";
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
  role_id: string;
  role_key: string;
  role_name: string;
  permissions: string[];
  branch_ids: string[] | null;
};

/** Every tenant the user belongs to. The database only returns memberships the user may see. */
export const listMemberships = cache(async (session: Session): Promise<Membership[]> => {
  const rows = await dbAs(session, (tx) =>
    tx<MembershipRow[]>`
      select m.id, m.tenant_id, t.name as tenant_name, t.timezone as tenant_timezone,
             r.id as role_id, r.key as role_key, r.name as role_name, r.permissions, m.branch_ids
      from public.memberships m
      join public.tenants t on t.id = m.tenant_id
      join public.roles r on r.id = m.role_id
      where m.user_id = auth.uid() and t.status <> 'archived'
      order by t.name
    `,
  );
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name,
    tenantTimezone: r.tenant_timezone,
    roleId: r.role_id,
    roleKey: r.role_key,
    roleName: r.role_name,
    permissions: r.permissions,
    branchIds: r.branch_ids,
  }));
});

/** The user's membership in `tenantId`, or a redirect home when they have none. */
export async function requireMembership(tenantId: string): Promise<{ session: Session; membership: Membership }> {
  const session = await requireSession();
  const membership = (await listMemberships(session)).find((m) => m.tenantId === tenantId);
  if (!membership) redirect("/");
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
