import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { dbAs, getSession } from "@/lib/auth/session";
import { errorCode } from "@/lib/db";
import { seal } from "@/lib/integrations/crypto";
import { quickBooks } from "@/lib/quickbooks/provider";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";

export const dynamic = "force-dynamic";

/**
 * Spec 20 rule 7: Intuit sends the bookkeeper back here with a code. The state must match the cookie set when they
 * started, for the company they started from; the tokens are sealed before they reach the database.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/settings/integrations?${q}`, url.origin));
  const jar = await cookies();
  const [state, tenantId] = (jar.get("qbo_state")?.value ?? "").split(".");
  jar.delete("qbo_state");
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  if (!state || !tenantId || url.searchParams.get("state") !== state || !code || !realmId) return back("error=QuickBooks+did+not+connect%3B+start+again.");
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/sign-in", url.origin));
  const { active } = await resolveActiveTenant(session);
  if (!active || active.tenantId !== tenantId || !can(active.permissions, "gl.write")) return back("error=forbidden");
  try {
    const provider = quickBooks();
    const tokens = await provider.exchange(code, realmId, `${url.origin}/api/integrations/quickbooks/callback`);
    await dbAs(session, async (tx) => {
      await tx`
        insert into public.integration_connections (tenant_id, provider, status, settings) values (${tenantId}, 'quickbooks', 'connected', ${tx.json({ realm_id: realmId, provider: provider.kind })})
        on conflict (tenant_id, provider) do update set status = 'connected', settings = excluded.settings, connected_at = now(), connected_by = auth.uid()`;
      await tx`select app.set_connection_tokens(${tenantId}, 'quickbooks', ${seal(tokens)}, 'connected')`;
    });
  } catch (err) {
    return back(`error=${encodeURIComponent((err as { code?: string }).code === "QBO_AUTH" ? "QuickBooks refused the connection; start again." : errorCode(err))}`);
  }
  return back("note=QuickBooks+connected.+Map+your+accounts+below.");
}
