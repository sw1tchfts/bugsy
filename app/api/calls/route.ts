import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { dbAs, getSession } from "@/lib/auth/session";
import { errorCode } from "@/lib/db";
import { logOutboundCall } from "@/lib/phone/db";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Spec 20: a click to call from a contact's page, logged on the account before the person's phone dials it. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const { active } = await resolveActiveTenant(session);
  if (!active || !can(active.permissions, "customers.read")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body: { to?: unknown; account_id?: unknown; contact_id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const to = typeof body.to === "string" ? body.to.slice(0, 40) : "";
  const id = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);
  if (!/\d{7}/.test(to.replace(/\D/g, ""))) return NextResponse.json({ error: "a number to call" }, { status: 400 });
  try {
    const call = await dbAs(session, (tx) => logOutboundCall(tx, active.tenantId, session.userId, { to, account_id: id(body.account_id), contact_id: id(body.contact_id) }));
    return NextResponse.json({ id: call });
  } catch (err) {
    return NextResponse.json({ error: errorCode(err) }, { status: 409 });
  }
}
