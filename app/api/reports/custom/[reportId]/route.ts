import { NextResponse } from "next/server";
import { csvResponse } from "@/app/api/ledger/_shared";
import { reportsReader } from "@/app/api/reports/_shared";
import { dbAs } from "@/lib/auth/session";
import { MAX_ROWS } from "@/lib/reports/builder";
import { loadSaved, rowsToCsv, runSaved } from "@/lib/reports/db";

export const dynamic = "force-dynamic";

/** A saved report as CSV, every row up to the cap (spec 12 rule 9), run under the member's session. */
export async function GET(_request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const reader = await reportsReader();
  if (reader instanceof NextResponse) return reader;
  const { session, active } = reader;
  const out = await dbAs(session, async (tx) => {
    const report = await loadSaved(tx, active.tenantId, reportId);
    if (!report) return null;
    return { report, result: await runSaved(tx, active.tenantId, report, active.permissions, MAX_ROWS) };
  });
  if (!out) return new NextResponse("no such report", { status: 404 });
  if (!out.result) return new NextResponse(`${out.report.dataset} is not readable by your role`, { status: 403 });
  const slug = out.report.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "report";
  return csvResponse(rowsToCsv(out.result.columns, out.result.rows), `${slug}.csv`);
}
