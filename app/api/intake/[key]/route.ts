import { NextResponse } from "next/server";
import { submitIntake } from "@/lib/portal/forms";

export const dynamic = "force-dynamic";

// The booking form's JSON intake (spec 16 rule 8), for a company's website to post to directly. Anyone may post; the
// form key decides the company and the database's limits keep it sane. No cookies are read or set.
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" };

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  let body: Record<string, unknown>;
  const type = request.headers.get("content-type") ?? "";
  try {
    body = type.includes("application/json") ? ((await request.json()) as Record<string, unknown>) : Object.fromEntries((await request.formData()).entries());
  } catch {
    return NextResponse.json({ ok: false, errors: ["The request body could not be read."] }, { status: 400, headers: CORS });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ ok: false, errors: ["Send an object."] }, { status: 400, headers: CORS });
  const outcome = await submitIntake(key, body);
  if (!outcome.ok) return NextResponse.json({ ok: false, errors: outcome.errors }, { status: outcome.status, headers: CORS });
  return NextResponse.json({ ok: true }, { status: 201, headers: CORS });
}
