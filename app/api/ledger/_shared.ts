import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;
type Active = NonNullable<Awaited<ReturnType<typeof resolveActiveTenant>>["active"]>;

/** The signed-in member with gl.read, or the response that says why not. */
export async function ledgerReader(): Promise<{ session: Session; active: Active } | NextResponse> {
  const session = await getSession();
  if (!session) return new NextResponse("sign in", { status: 401 });
  const { active } = await resolveActiveTenant(session);
  if (!active) return new NextResponse("no company", { status: 403 });
  if (!can(active.permissions, "gl.read")) return new NextResponse("gl.read needed", { status: 403 });
  return { session, active };
}

export function csvResponse(csv: string, name: string): NextResponse {
  return new NextResponse(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" },
  });
}
