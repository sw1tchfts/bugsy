import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type Membership, type Session, listMemberships, noteSupportAccess, requireSession } from "@/lib/auth/session";

export const ACTIVE_TENANT_COOKIE = "bugsy_tenant";

export type ActiveTenant = {
  session: Session;
  memberships: Membership[];
  /** Null when the user belongs to no tenant. */
  active: Membership | null;
};

/**
 * The active tenant is a UI choice stored in a cookie. The database never trusts it: every query still runs
 * under the user's own memberships. This only picks which tenant's data the pages show, and falls back to the
 * first membership when the cookie names a tenant the user no longer belongs to.
 */
export async function resolveActiveTenant(session: Session): Promise<ActiveTenant> {
  const memberships = await listMemberships(session);
  const cookieStore = await cookies();
  const wanted = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value;
  // Support opens a company only by choosing it in the console (the cookie); a member falls back to their first company.
  const active = memberships.find((m) => m.tenantId === wanted) ?? memberships.find((m) => !m.support) ?? null;
  if (active?.support) await noteSupportAccess(session, active.tenantId);
  return { session, memberships, active };
}

export async function requireActiveTenant(): Promise<ActiveTenant & { active: Membership }> {
  const session = await requireSession();
  const resolved = await resolveActiveTenant(session);
  if (!resolved.active) redirect("/no-company");
  return resolved as ActiveTenant & { active: Membership };
}

/** Writes the cookie. Callers validate membership first. */
export async function setActiveTenantCookie(tenantId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
