import { NextResponse } from "next/server";
import { dbAs, getSession } from "@/lib/auth/session";
import { errorCode } from "@/lib/db";
import { recordPosition } from "@/lib/routing/db";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";

export const dynamic = "force-dynamic";

/** Spec 19 rule 7: the phone's position while the person works. A ping is not a record: one that fails is dropped. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const { active } = await resolveActiveTenant(session);
  if (!active) return NextResponse.json({ error: "no company" }, { status: 403 });
  let body: { lat?: unknown; lng?: unknown; accuracy?: unknown; at?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const accuracy = body.accuracy === null || body.accuracy === undefined ? null : Number(body.accuracy);
  const at = new Date(typeof body.at === "string" ? body.at : Date.now());
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || Number.isNaN(at.getTime())) {
    return NextResponse.json({ error: "a position is a latitude and a longitude" }, { status: 400 });
  }
  try {
    await dbAs(session, (tx) => recordPosition(tx, active.tenantId, session.userId, { lat, lng, accuracy_m: accuracy !== null && Number.isFinite(accuracy) ? accuracy : null, recorded_at: at }));
  } catch (err) {
    return NextResponse.json({ error: errorCode(err) }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
