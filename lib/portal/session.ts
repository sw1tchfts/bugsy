import "server-only";
// The customer portal's identity (spec 16). A person may be a portal user of several accounts or companies; the one
// they work as is a UI choice kept in a cookie, like the active company. The database never trusts the cookie: the
// session claims name the portal identity and app.portal_user_id() honors it only for the signed-in user's own row.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type Session, dbAs, getSession } from "@/lib/auth/session";
import { type Tx, withRls } from "@/lib/db";

export const PORTAL_COOKIE = "bugsy_portal";

export type PortalIdentity = {
  id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_timezone: string;
  /** Spec 13: a suspended company is read only, in the portal too. */
  tenant_status: string;
  account_id: string;
  account_name: string;
  property_ids: string[] | null;
};

export async function portalIdentities(session: Session): Promise<PortalIdentity[]> {
  return dbAs(session, (tx) => tx<PortalIdentity[]>`select * from app.portal_identities()`);
}

export type ActivePortal = { session: Session; identities: PortalIdentity[]; identity: PortalIdentity };

/** The signed-in customer and the identity they are working as; redirects to sign-in or the no-access page. */
export async function requirePortal(): Promise<ActivePortal> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/portal");
  const identities = await portalIdentities(session);
  if (identities.length === 0) redirect("/portal/none");
  const wanted = (await cookies()).get(PORTAL_COOKIE)?.value;
  const identity = identities.find((i) => i.id === wanted) ?? identities[0];
  return { session, identities, identity };
}

/** Runs a query as the customer working as this identity: every table's row level security decides. */
export function portalDb<T>(session: Session, identity: Pick<PortalIdentity, "id">, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withRls({ ...session.claims, portal_user: identity.id }, fn);
}

export async function setPortalCookie(id: string): Promise<void> {
  (await cookies()).set(PORTAL_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
}
