import { zipSync } from "fflate";
import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { dbAs, getSession } from "@/lib/auth/session";
import { binderFiles } from "@/lib/commercial/binder";
import { binderData } from "@/lib/commercial/db";
import { addMonths, isIsoDate, todayInZone } from "@/lib/dates";
import { getFile } from "@/lib/files";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";

export const dynamic = "force-dynamic";

/** The audit binder for a site and a range (spec 14 rule 10), under the member's own session. */
export async function GET(request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("sign in", { status: 401 });
  const { active } = await resolveActiveTenant(session);
  if (!active) return new NextResponse("no company", { status: 403 });
  if (!can(active.permissions, "customers.read") && !can(active.permissions, "visits.read")) return new NextResponse("customers.read or visits.read needed", { status: 403 });
  const { propertyId } = await params;
  const url = new URL(request.url);
  const today = todayInZone(active.tenantTimezone);
  const to = url.searchParams.get("to") || today;
  const from = url.searchParams.get("from") || addMonths(to, -12);
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return new NextResponse("from and to are dates, from first", { status: 400 });
  const out = await dbAs(session, async (tx) => {
    const data = await binderData(tx, active.tenantId, propertyId, active.tenantTimezone, from, to);
    if (!data) return null;
    const images = new Map<string, { type: string; base64: string }>();
    for (const m of data.maps) {
      const f = await getFile(tx, active.tenantId, m.file_id);
      if (f) images.set(m.file_id, { type: f.content_type, base64: Buffer.from(f.data).toString("base64") });
    }
    return { data, images };
  });
  if (!out) return new NextResponse("no such site", { status: 404 });
  const zip = zipSync(binderFiles(out.data, out.images), { level: 6 });
  const slug = out.data.property.account_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site";
  return new NextResponse(Buffer.from(zip), {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="audit-binder-${slug}-${from}-to-${to}.zip"`, "cache-control": "private, no-store" },
  });
}
