import { zipSync } from "fflate";
import { NextResponse } from "next/server";
import { binderFiles } from "@/lib/commercial/binder";
import { binderData } from "@/lib/commercial/db";
import { addMonths, isIsoDate, todayInZone } from "@/lib/dates";
import { getFile } from "@/lib/files";
import { staffNames } from "@/lib/portal/db";
import { portalDb, requirePortal } from "@/lib/portal/session";

export const dynamic = "force-dynamic";

/** The audit binder for a customer's own site (spec 16 rule 6): the office's binder, read under the portal identity. */
export async function GET(request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  const { session, identity } = await requirePortal();
  const { propertyId } = await params;
  const url = new URL(request.url);
  const to = url.searchParams.get("to") || todayInZone(identity.tenant_timezone);
  const from = url.searchParams.get("from") || addMonths(to, -12);
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return new NextResponse("from and to are dates, from first", { status: 400 });
  const out = await portalDb(session, identity, async (tx) => {
    // A customer reads no staff list: technicians are named from the names the portal may see.
    const names = await staffNames(tx, identity.tenant_id);
    const data = await binderData(tx, identity.tenant_id, propertyId, identity.tenant_timezone, from, to, names);
    if (!data) return null;
    const rows = await tx<{ id: string; technician_id: string | null }[]>`select id, technician_id from public.visits where id = any(${data.visits.map((v) => v.id)}::uuid[])`;
    const tech = new Map(rows.map((r) => [r.id, r.technician_id]));
    data.visits = data.visits.map((v) => ({ ...v, technician: names.get(tech.get(v.id) ?? "") ?? v.technician }));
    const images = new Map<string, { type: string; base64: string }>();
    for (const m of data.maps) {
      const f = await getFile(tx, identity.tenant_id, m.file_id);
      if (f) images.set(m.file_id, { type: f.content_type, base64: Buffer.from(f.data).toString("base64") });
    }
    return { data, images };
  });
  if (!out) return new NextResponse("no such site", { status: 404 });
  const zip = zipSync(binderFiles(out.data, out.images), { level: 6 });
  return new NextResponse(Buffer.from(zip), {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="audit-binder-${from}-to-${to}.zip"`, "cache-control": "private, no-store" },
  });
}
