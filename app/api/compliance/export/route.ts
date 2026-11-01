import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { dbAs, getSession } from "@/lib/auth/session";
import { buildInspectorExport, zipFiles } from "@/lib/compliance/export";
import { isIsoDate } from "@/lib/dates";
import { normalizeStateCode } from "@/lib/geo/normalize";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";

export const dynamic = "force-dynamic";

/** The inspector export: one zip for a range of business dates, logged in compliance_exports (and so the audit trail). */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("sign in", { status: 401 });
  const { active } = await resolveActiveTenant(session);
  if (!active) return new NextResponse("no company", { status: 403 });
  if (!can(active.permissions, "compliance.write")) return new NextResponse("compliance.write needed", { status: 403 });
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const state = normalizeStateCode(url.searchParams.get("state"));
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return new NextResponse("from and to are business dates, from first", { status: 400 });
  const files = await dbAs(session, async (tx) => {
    const built = await buildInspectorExport(tx, active.tenantId, { from, to, state }, active.tenantName, active.tenantTimezone);
    // The export log is a write; a read-only company still exports (spec 13), it just is not logged.
    if (active.tenantStatus === "active" && (!active.support || active.support.access === "write")) {
      await tx`insert into public.compliance_exports (tenant_id, from_date, to_date, state_code, file_count) values (${active.tenantId}, ${from}, ${to}, ${state}, ${built.length})`;
    }
    return built;
  });
  const zip = zipFiles(files);
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="inspection-${from}-to-${to}${state ? `-${state}` : ""}.zip"`,
      "cache-control": "private, no-store",
    },
  });
}
