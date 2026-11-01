import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import { quickBooks } from "@/lib/quickbooks/provider";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";

export const dynamic = "force-dynamic";

/**
 * Spec 20 rule 7: starts the QuickBooks connection for the signed-in bookkeeper's company. A plain form post, so the
 * browser itself follows Intuit's redirects back to the callback; the state cookie ties the answer to this start.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/sign-in", url.origin), 303);
  const { active } = await resolveActiveTenant(session);
  if (!active || !can(active.permissions, "gl.write")) return NextResponse.redirect(new URL("/settings/integrations?error=forbidden", url.origin), 303);
  const state = randomBytes(16).toString("hex");
  (await cookies()).set("qbo_state", `${state}.${active.tenantId}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  return NextResponse.redirect(quickBooks().authorizeUrl(state, `${url.origin}/api/integrations/quickbooks/callback`), 303);
}
