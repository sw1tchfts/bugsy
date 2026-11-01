import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { recordProviderStatus } from "@/lib/messaging/db";
import { type PostmarkEvent, postmarkOutcome } from "@/lib/messaging/postmark";

export const dynamic = "force-dynamic";

/**
 * Postmark's delivery, bounce and complaint webhook (spec 11 rules 1 and 5), authenticated by a secret in the URL that
 * Postmark is configured with. A hard bounce or a complaint suppresses the address for the company that sent to it.
 */
export async function POST(request: Request) {
  const secret = process.env.POSTMARK_WEBHOOK_SECRET;
  if (!secret || new URL(request.url).searchParams.get("secret") !== secret) return new NextResponse("forbidden", { status: 403 });
  const event = (await request.json().catch(() => ({}))) as PostmarkEvent;
  if (!event.MessageID) return NextResponse.json({ ok: true, ignored: true });
  const outcome = postmarkOutcome(event);
  await sql.begin(async (tx) => {
    const tenantId = outcome.status
      ? await recordProviderStatus(tx, "postmark", event.MessageID as string, outcome.status, event.Description ?? null)
      : ((await tx<{ tenant_id: string }[]>`select tenant_id from public.messages where provider = 'postmark' and provider_message_id = ${event.MessageID as string}`)[0]?.tenant_id ?? null);
    if (tenantId && outcome.suppress && outcome.address) {
      await tx`insert into public.message_opt_outs (tenant_id, channel, address, reason, created_by) values (${tenantId}, 'email', ${outcome.address}, ${outcome.suppress}, null) on conflict (tenant_id, channel, address) do nothing`;
    }
  });
  return NextResponse.json({ ok: true });
}
