import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { dbAs, getSession } from "@/lib/auth/session";
import { wdiHtml } from "@/lib/specialty/wdi";
import { loadWdi } from "@/lib/specialty/wdi-db";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";

export const dynamic = "force-dynamic";

/** The printable WDI report (spec 15 rule 7). Every value is escaped and the page runs no script. */
export async function GET(_request: Request, { params }: { params: Promise<{ visitId: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("sign in", { status: 401 });
  const { active } = await resolveActiveTenant(session);
  if (!active) return new NextResponse("no company", { status: 403 });
  if (!can(active.permissions, "visits.read") && !can(active.permissions, "compliance.read") && !can(active.permissions, "customers.read")) return new NextResponse("forbidden", { status: 403 });
  const { visitId } = await params;
  const data = await dbAs(session, (tx) => loadWdi(tx, active.tenantId, visitId, active.tenantTimezone));
  if (!data?.report) return new NextResponse("no report for this visit", { status: 404 });
  const body = wdiHtml(data.report, data.ctx);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>WDI report</title>
<style>body{font-family:system-ui,sans-serif;color:#1c1917;margin:24px;max-width:820px}h1{font-size:20px}dl{display:grid;grid-template-columns:14rem 1fr;gap:4px 12px}dt{color:#57534e}
table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #d6d3d1;padding:4px 6px;text-align:left;font-size:13px}.small{font-size:12px;color:#57534e}</style></head>
<body>${data.report.status === "issued" ? "" : '<p class="small">DRAFT: not issued.</p>'}${body}</body></html>`;
  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox", "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
}
