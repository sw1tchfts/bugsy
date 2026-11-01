import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { dbAs, getSession } from "@/lib/auth/session";
import { taxReport } from "@/lib/billing/db";
import { toCsv } from "@/lib/compliance/export";
import { isIsoDate } from "@/lib/dates";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";

export const dynamic = "force-dynamic";

/** Tax collected by jurisdiction for the filing period, as CSV (spec 08). */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("sign in", { status: 401 });
  const { active } = await resolveActiveTenant(session);
  if (!active) return new NextResponse("no company", { status: 403 });
  if (!can(active.permissions, "billing.read")) return new NextResponse("billing.read needed", { status: 403 });
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return new NextResponse("from and to are business dates, from first", { status: 400 });
  const rows = await dbAs(session, (tx) => taxReport(tx, active.tenantId, from, to));
  const csv = toCsv(
    ["state", "jurisdiction", "kind", "rate", "taxable_cents", "tax_cents", "invoices"],
    rows.map((r) => [r.state_code, r.jurisdiction, r.kind, r.rate, r.taxable_cents, r.tax_cents, r.invoices]),
  );
  return new NextResponse(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="tax-${from}-to-${to}.csv"`, "cache-control": "private, no-store" },
  });
}
