import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { dbAs, getSession } from "@/lib/auth/session";
import { runCompliance } from "@/lib/compliance/db";
import { sql } from "@/lib/db";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";

export const dynamic = "force-dynamic";

/**
 * The compliance job: records for completed visits, locks when due, notices and tasks. Idempotent, so a scheduler may
 * call it every hour. With the job secret it runs for every company (no user: this is the one request path that uses
 * the privileged connection, as CLAUDE.md notes); a signed-in licensed manager runs it for their own company.
 */
export async function POST(request: Request) {
  const secret = process.env.COMPLIANCE_RUN_SECRET;
  const header = request.headers.get("x-compliance-secret");
  if (secret && header && header === secret) {
    const tenants = await sql<{ id: string; name: string; timezone: string }[]>`select id, name, timezone from public.tenants where status = 'active' order by created_at`;
    const results: Record<string, unknown> = {};
    for (const t of tenants) {
      try {
        results[t.name] = await sql.begin((tx) => runCompliance(tx, t.id, t.timezone));
      } catch (err) {
        console.error("compliance job failed", t.id, err);
        results[t.name] = { error: "failed" };
      }
    }
    return NextResponse.json({ ok: true, tenants: results });
  }

  const session = await getSession();
  if (!session) return new NextResponse("sign in", { status: 401 });
  const { active } = await resolveActiveTenant(session);
  if (!active) return new NextResponse("no company", { status: 403 });
  if (!can(active.permissions, "compliance.write")) return new NextResponse("compliance.write needed", { status: 403 });
  const counts = await dbAs(session, (tx) => runCompliance(tx, active.tenantId, active.tenantTimezone));
  return NextResponse.json({ ok: true, counts });
}
