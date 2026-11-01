import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { dbAs, getSession } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { runMessaging } from "@/lib/messaging/db";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";

export const dynamic = "force-dynamic";

/**
 * The messaging job (spec 11): reminders, due notices, scheduled campaigns, then every message due goes out with
 * consent, opt-outs and quiet hours checked. Idempotent; meant to run every few minutes. With the job secret it runs
 * for every company on the privileged connection (CLAUDE.md); a member with messages.send runs it for their own.
 */
export async function POST(request: Request) {
  const secret = process.env.MESSAGING_RUN_SECRET ?? process.env.COMPLIANCE_RUN_SECRET;
  const header = request.headers.get("x-messaging-secret") ?? request.headers.get("x-compliance-secret");
  if (secret && header && header === secret) {
    const tenants = await sql<{ id: string; name: string; timezone: string }[]>`select id, name, timezone from public.tenants where status = 'active' order by created_at`;
    const results: Record<string, unknown> = {};
    for (const t of tenants) {
      try {
        results[t.name] = await sql.begin((tx) => runMessaging(tx, t.id, t.timezone));
      } catch (err) {
        console.error("messaging job failed", t.id, err);
        results[t.name] = { error: "failed" };
      }
    }
    return NextResponse.json({ ok: true, tenants: results });
  }
  const session = await getSession();
  if (!session) return new NextResponse("sign in", { status: 401 });
  const { active } = await resolveActiveTenant(session);
  if (!active) return new NextResponse("no company", { status: 403 });
  if (!can(active.permissions, "messages.send")) return new NextResponse("messages.send needed", { status: 403 });
  const counts = await dbAs(session, (tx) => runMessaging(tx, active.tenantId, active.tenantTimezone));
  return NextResponse.json({ ok: true, counts });
}
