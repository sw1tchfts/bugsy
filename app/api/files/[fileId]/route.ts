import { NextResponse } from "next/server";
import { dbAs, getSession } from "@/lib/auth/session";
import { getFile } from "@/lib/files";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";

export const dynamic = "force-dynamic";

/** Serves a stored file under the viewer's own session: row level security decides whether it exists for them. */
export async function GET(_request: Request, context: { params: Promise<{ fileId: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("sign in", { status: 401 });
  const { active } = await resolveActiveTenant(session);
  if (!active) return new NextResponse("no company", { status: 403 });
  const { fileId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return new NextResponse("not found", { status: 404 });
  const file = await dbAs(session, (tx) => getFile(tx, active.tenantId, fileId));
  if (!file) return new NextResponse("not found", { status: 404 });
  return new NextResponse(new Uint8Array(file.data), {
    headers: { "content-type": file.content_type, "content-length": String(file.byte_size), "cache-control": "private, max-age=3600" },
  });
}
