import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { currentConditions } from "@/lib/weather/provider";

export const dynamic = "force-dynamic";

/** Current conditions at a location, for the one-tap fill on the stop screen. Null when the service is unavailable. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return NextResponse.json({ error: "lat and lng" }, { status: 400 });
  const conditions = await currentConditions(lat, lng);
  return NextResponse.json({ conditions }, { headers: { "cache-control": "no-store" } });
}
