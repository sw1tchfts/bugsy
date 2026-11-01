import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { dbAs, getSession } from "@/lib/auth/session";
import { runBilling } from "@/lib/billing/db";
import { sql } from "@/lib/db";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";

export const dynamic = "force-dynamic";

/**
 * The billing job: visit invoices missing from completions, installments and prepayments due, credit allocation,
 * autopay and retries, past-due statuses and late fees. Idempotent, so a scheduler may call it every hour. With the
 * job secret it runs for every company (no user: the privileged connection, as CLAUDE.md notes); a signed-in member
 * with billing.write runs it for their own company.
 */
export async function POST(request: Request) {
  const secret = process.env.BILLING_RUN_SECRET ?? process.env.COMPLIANCE_RUN_SECRET;
  const header = request.headers.get("x-billing-secret") ?? request.headers.get("x-compliance-secret");
  if (secret && header && header === secret) {
    const tenants = await sql<{ id: string; name: string; timezone: string }[]>`select id, name, timezone from public.tenants where status = 'active' order by created_at`;
    const results: Record<string, unknown> = {};
    for (const t of tenants) {
      try {
        results[t.name] = await sql.begin((tx) => runBilling(tx, t.id, t.timezone));
      } catch (err) {
        console.error("billing job failed", t.id, err);
        results[t.name] = { error: "failed" };
      }
    }
    return NextResponse.json({ ok: true, tenants: results });
  }

  const session = await getSession();
  if (!session) return new NextResponse("sign in", { status: 401 });
  const { active } = await resolveActiveTenant(session);
  if (!active) return new NextResponse("no company", { status: 403 });
  if (!can(active.permissions, "billing.write")) return new NextResponse("billing.write needed", { status: 403 });
  const counts = await dbAs(session, (tx) => runBilling(tx, active.tenantId, active.tenantTimezone, new Date(), session.userId, { reclass: can(active.permissions, "gl.write"), payouts: true }));
  return NextResponse.json({ ok: true, counts });
}
