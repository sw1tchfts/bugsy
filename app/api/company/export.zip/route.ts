import { zipSync } from "fflate";
import { NextResponse } from "next/server";
import { isOwnerRole } from "@/lib/auth/permissions";
import { dbAs, getSession } from "@/lib/auth/session";
import { todayInZone } from "@/lib/dates";
import { exportCompany } from "@/lib/platform/db";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";

export const dynamic = "force-dynamic";

/** Everything the company holds, for its owners, while active, suspended or archived (spec 13 rule 11). */
export async function GET() {
  const session = await getSession();
  if (!session) return new NextResponse("sign in", { status: 401 });
  const { active } = await resolveActiveTenant(session);
  if (!active) return new NextResponse("no company", { status: 403 });
  if (active.support || !isOwnerRole(active.permissions)) return new NextResponse("the full export is for the company's owners", { status: 403 });
  const files = await dbAs(session, (tx) => exportCompany(tx, active.tenantId, active.tenantName));
  const zip = zipSync(files, { level: 6 });
  const slug = active.tenantName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "company";
  return new NextResponse(Buffer.from(zip), {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${slug}-${todayInZone(active.tenantTimezone)}.zip"`, "cache-control": "private, no-store" },
  });
}
