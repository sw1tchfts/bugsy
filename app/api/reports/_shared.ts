import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;
type Active = NonNullable<Awaited<ReturnType<typeof resolveActiveTenant>>["active"]>;

/** The signed-in member with reports.read (and any further permissions named), or the response that says why not. */
export async function reportsReader(...also: string[]): Promise<{ session: Session; active: Active } | NextResponse> {
  const session = await getSession();
  if (!session) return new NextResponse("sign in", { status: 401 });
  const { active } = await resolveActiveTenant(session);
  if (!active) return new NextResponse("no company", { status: 403 });
  for (const p of ["reports.read", ...also]) if (!can(active.permissions, p)) return new NextResponse(`${p} needed`, { status: 403 });
  return { session, active };
}
