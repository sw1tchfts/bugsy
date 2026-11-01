import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { appUrl, handleInbound, recordProviderStatus } from "@/lib/messaging/db";
import { twilioStatus, validTwilioSignature } from "@/lib/messaging/twilio";

export const dynamic = "force-dynamic";

const EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/**
 * Twilio's webhook (spec 11 rules 1, 3 and 12): delivery statuses update the message by its id; inbound texts land on
 * the company whose number they were sent to, keywords answered. Signed with the account's auth token. No user signs
 * these requests, so it uses the privileged connection like the payment webhook (CLAUDE.md).
 */
export async function POST(request: Request) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return new NextResponse("twilio is not configured", { status: 404 });
  const form = await request.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const url = `${appUrl()}/api/messaging/twilio`;
  if (!validTwilioSignature(token, url, params, request.headers.get("x-twilio-signature"))) return new NextResponse("bad signature", { status: 403 });
  if (params.MessageStatus && params.MessageSid && !params.Body) {
    const status = twilioStatus(params.MessageStatus);
    if (status) await sql.begin((tx) => recordProviderStatus(tx, "twilio", params.MessageSid, status, params.ErrorCode ? `twilio ${params.ErrorCode}` : null));
    return new NextResponse(EMPTY, { headers: { "content-type": "text/xml" } });
  }
  const [company] = await sql<{ tenant_id: string; timezone: string }[]>`
    select s.tenant_id, t.timezone from public.messaging_settings s join public.tenants t on t.id = s.tenant_id where s.sms_number = ${params.To ?? ""}`;
  if (!company) return new NextResponse(EMPTY, { headers: { "content-type": "text/xml" } });
  await sql.begin((tx) => handleInbound(tx, { tenant_id: company.tenant_id, from: params.From ?? "", to: params.To ?? null, body: params.Body ?? "", provider: "twilio", provider_message_id: params.MessageSid ?? null }, company.timezone));
  return new NextResponse(EMPTY, { headers: { "content-type": "text/xml" } });
}
