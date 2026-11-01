import { NextResponse } from "next/server";
import { csvResponse } from "@/app/api/ledger/_shared";
import { reportsReader } from "@/app/api/reports/_shared";
import { dbAs } from "@/lib/auth/session";
import { toCsv } from "@/lib/compliance/export";
import { isIsoDate, todayInZone } from "@/lib/dates";
import { AGING, arAging, reserviceReport, retentionReport, revenueByLine, salesBySource, technicianReport } from "@/lib/reports/db";

export const dynamic = "force-dynamic";

const NEEDS: Record<string, string> = { retention: "agreements.read", technicians: "visits.read", revenue: "gl.read", receivables: "billing.read", sales: "customers.read", reservices: "visits.read" };

/** The CSV behind each standard report (spec 12), for the same range the page shows; money is integer cents. */
export async function GET(request: Request, { params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  const need = NEEDS[report];
  if (!need) return new NextResponse("no such report", { status: 404 });
  const reader = await reportsReader(need);
  if (reader instanceof NextResponse) return reader;
  const { session, active } = reader;
  const url = new URL(request.url);
  const today = todayInZone(active.tenantTimezone);

  if (report === "receivables") {
    const on = url.searchParams.get("on") ?? today;
    if (!isIsoDate(on)) return new NextResponse("on is a business date", { status: 400 });
    const r = await dbAs(session, (tx) => arAging(tx, active.tenantId, active.tenantTimezone, on));
    const headers = ["account", ...AGING.map((b) => `${b.replace(/ /g, "_")}_cents`), "total_cents"];
    return csvResponse(toCsv(headers, r.rows.map((x) => [x.account, ...AGING.map((b) => x.buckets[b]), x.total])), `receivables-aging-${on}.csv`);
  }

  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return new NextResponse("from and to are business dates, from first", { status: 400 });
  const name = `${report}-${from}-to-${to}.csv`;
  const tz = active.tenantTimezone;

  if (report === "retention") {
    const r = await dbAs(session, (tx) => retentionReport(tx, active.tenantId, tz, from, to));
    const months = r.months.map((m) => ["month", m.month, m.active_at_start, m.lost, m.rate ?? "", "", "", ""]);
    const lost = r.lost.map((a) => ["lost", a.last_active, "", "", "", a.number, a.account_name, a.cancel_reason ?? (a.cancelled_on ? "no reason recorded" : "ended, not renewed")]);
    return csvResponse(toCsv(["row", "month_or_day", "active_at_start", "lost", "attrition", "agreement", "account", "reason"], [...months, ...lost]), name);
  }
  if (report === "technicians") {
    const rows = await dbAs(session, (tx) => technicianReport(tx, active.tenantId, tz, from, to, active.permissions));
    return csvResponse(
      toCsv(
        ["technician", "stops", "working_days", "stops_per_day", "revenue_cents", "minutes_on_site", "reservice_base", "reserviced", "reservice_rate", "product_cost_cents"],
        rows.map((r) => [r.technician, r.stops, r.working_days, r.stops_per_day?.toFixed(2) ?? "", r.revenue_cents, r.minutes_on_site ?? "", r.base, r.reserviced, r.reservice_rate ?? "", r.product_cost_cents ?? ""]),
      ),
      name,
    );
  }
  if (report === "revenue") {
    const r = await dbAs(session, (tx) => revenueByLine(tx, active.tenantId, from, to));
    return csvResponse(toCsv(["period", "account", "cents"], [...r.rows.map((x) => [x.period, x.account, x.cents]), ...r.months.map((m) => [m, "Total revenue", r.totals[m] ?? 0])]), name);
  }
  if (report === "sales") {
    const r = await dbAs(session, (tx) => salesBySource(tx, active.tenantId, tz, from, to));
    return csvResponse(toCsv(["source", "leads", "won", "lost", "open", "close_rate"], [...r.rows, r.total].map((s) => [s.source, s.leads, s.won, s.lost, s.open, s.rate ?? ""])), name);
  }
  const rows = await dbAs(session, (tx) => reserviceReport(tx, active.tenantId, tz, from, to));
  return csvResponse(toCsv(["service_type", "reason", "reservices", "completed", "rate"], rows.map((r) => [r.service_type, r.reason, r.reservices, r.completed, r.rate ?? ""])), name);
}
