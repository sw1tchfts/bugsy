import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { periodCsv } from "@/lib/payroll/db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

export const dynamic = "force-dynamic";

/** The pay period's file for the payroll provider (spec 18 rule 12), as exported. */
export async function GET(_request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  const { session, active } = await requireActiveTenant();
  if (!can(active.permissions, "payroll.read")) return new NextResponse("forbidden", { status: 403 });
  const { periodId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(periodId)) return new NextResponse("not found", { status: 404 });
  const out = await dbAs(session, (tx) => periodCsv(tx, active.tenantId, periodId));
  if (!out) return new NextResponse("not found", { status: 404 });
  return new NextResponse(out.csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="payroll-${out.period.starts_on}-to-${out.period.ends_on}.csv"`, "cache-control": "private, no-store" },
  });
}
