import { NextResponse } from "next/server";
import { withAnon } from "@/lib/db";
import { verify } from "@/lib/webhooks/events";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/integrations/phone/<key> (spec 20 rule 8): the phone system's call event, signed with the connection's
 * secret the way Bugsy signs its own webhooks (`bugsy-signature: t=<unix>,v1=<hmac of "t.body">`). No user: the key
 * names the connection, the definer functions check it, match the caller and log the call once by its id.
 */
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!UUID.test(key)) return NextResponse.json({ error: { code: "not_found", message: "No such phone connection." } }, { status: 404 });
  // Refuse a large body before reading it, and count bytes, not characters.
  if (Number(request.headers.get("content-length") ?? "0") > 16_384) return NextResponse.json({ error: { code: "invalid", message: "Too large." } }, { status: 413 });
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 16_384) return NextResponse.json({ error: { code: "invalid", message: "Too large." } }, { status: 413 });
  const [{ secret }] = await withAnon((tx) => tx<{ secret: string | null }[]>`select app.phone_secret(${key}) as secret`);
  if (!secret) return NextResponse.json({ error: { code: "not_found", message: "No such phone connection." } }, { status: 404 });
  if (!verify(secret, raw, request.headers.get("bugsy-signature") ?? "")) {
    return NextResponse.json({ error: { code: "unauthorized", message: "The signature does not match." } }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: { code: "invalid", message: "Send a JSON object." } }, { status: 422 });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return NextResponse.json({ error: { code: "invalid", message: "Send a JSON object." } }, { status: 422 });
  try {
    const [{ r }] = await withAnon((tx) => tx<{ r: unknown }[]>`select app.phone_call_event(${key}, ${tx.json(payload as never)}) as r`);
    return NextResponse.json(r, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "22023" || e.code === "22P02" || e.code === "22007" || e.code === "23514") {
      return NextResponse.json({ error: { code: "invalid", message: (e.message ?? "invalid").slice(0, 200) } }, { status: 422 });
    }
    if (e.code === "P0002") return NextResponse.json({ error: { code: "not_found", message: "No such phone connection." } }, { status: 404 });
    console.error("phone event failed", e.code ?? "", e.message ?? err);
    return NextResponse.json({ error: { code: "server_error", message: "Something went wrong; try again." } }, { status: 500 });
  }
}
