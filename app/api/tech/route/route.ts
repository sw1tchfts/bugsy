import { NextResponse } from "next/server";
import { dbAs, getSession } from "@/lib/auth/session";
import { isIsoDate, todayInZone } from "@/lib/dates";
import { loadRoute } from "@/lib/tech/route-db";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";

export const dynamic = "force-dynamic";

/** The technician's route for a day, with everything the stop screen needs. Cached on the device for offline use. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const { active } = await resolveActiveTenant(session);
  if (!active) return NextResponse.json({ error: "no company" }, { status: 403 });
  const requested = new URL(request.url).searchParams.get("date");
  const date = requested && isIsoDate(requested) ? requested : todayInZone(active.tenantTimezone);
  const [locale] = await dbAs(session, (tx) => tx<{ locale: string }[]>`select locale from public.memberships where id = ${active.id}`);
  const payload = await dbAs(session, (tx) =>
    loadRoute(tx, { id: active.tenantId, name: active.tenantName, timezone: active.tenantTimezone }, { user_id: session.userId, locale: locale?.locale ?? "en" }, date),
  );
  return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
}
