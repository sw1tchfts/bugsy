import { NextResponse } from "next/server";
import { getFile } from "@/lib/files";
import { portalDb, requirePortal } from "@/lib/portal/session";

export const dynamic = "force-dynamic";

/** A file a portal identity may open (spec 16 rule 7: its sites' map images and shared documents), under its session. */
export async function GET(_request: Request, context: { params: Promise<{ fileId: string }> }) {
  const { session, identity } = await requirePortal();
  const { fileId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return new NextResponse("not found", { status: 404 });
  const file = await portalDb(session, identity, (tx) => getFile(tx, identity.tenant_id, fileId));
  if (!file) return new NextResponse("not found", { status: 404 });
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "content-type": file.content_type,
      "content-length": String(file.byte_size),
      "cache-control": "private, max-age=3600",
      "content-security-policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      "x-content-type-options": "nosniff",
    },
  });
}
