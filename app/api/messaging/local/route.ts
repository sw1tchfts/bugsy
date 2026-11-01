import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { handleInbound } from "@/lib/messaging/db";

export const dynamic = "force-dynamic";

/**
 * A text from a customer, simulated, for development and the end-to-end tests: the local provider has no carrier to
 * receive it. Refused in production unless MESSAGING_LOCAL_INBOUND is set, and for a company texting through Twilio.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && process.env.MESSAGING_LOCAL_INBOUND !== "1") return new NextResponse("not found", { status: 404 });
  const input = (await request.json().catch(() => ({}))) as { tenant: string; from: string; body: string };
  if (!input.tenant || !input.from || typeof input.body !== "string") return new NextResponse("tenant, from and body are required", { status: 400 });
  const [company] = await sql<{ id: string; timezone: string; sms_provider: string | null }[]>`
    select t.id, t.timezone, s.sms_provider from public.tenants t left join public.messaging_settings s on s.tenant_id = t.id where t.id::text = ${input.tenant} or t.name = ${input.tenant}`;
  if (!company) return new NextResponse("no such company", { status: 404 });
  if (company.sms_provider && company.sms_provider !== "local") return new NextResponse("this company texts through a carrier", { status: 409 });
  const result = await sql.begin((tx) => handleInbound(tx, { tenant_id: company.id, from: input.from, to: null, body: input.body, provider: "local", provider_message_id: `local_in_${crypto.randomUUID()}` }, company.timezone));
  return NextResponse.json({ ok: true, ...result });
}
