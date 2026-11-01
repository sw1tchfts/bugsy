import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { dbAs, getSession } from "@/lib/auth/session";
import { ringingCalls } from "@/lib/phone/db";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";

export const dynamic = "force-dynamic";

/** Spec 20 rule 8: the caller pop's poll: inbound calls of the last two minutes with who the number belongs to. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ calls: [] }, { status: 401 });
  const { active } = await resolveActiveTenant(session);
  if (!active || !can(active.permissions, "customers.read")) return NextResponse.json({ calls: [] });
  const calls = await dbAs(session, (tx) => ringingCalls(tx, active.tenantId));
  return NextResponse.json({ calls }, { headers: { "cache-control": "no-store" } });
}
