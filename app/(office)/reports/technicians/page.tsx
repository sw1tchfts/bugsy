import type { Metadata } from "next";
import { Card, Empty, Table } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { todayInZone } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { technicianReport } from "@/lib/reports/db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { Back, RangeForm, rangeOf, share } from "../helpers";

export const metadata: Metadata = { title: "Technician productivity" };

/** Productivity per lead technician (spec 12 rule 5). */
export default async function TechniciansReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "reports.read");
  await requirePermission(active.tenantId, "visits.read");
  const range = rangeOf(await searchParams, todayInZone(active.tenantTimezone), { days: 30 });
  const rows = await dbAs(session, (tx) => technicianReport(tx, active.tenantId, active.tenantTimezone, range.from, range.to, active.permissions));

  return (
    <>
      <Back />
      <h1 className="text-2xl font-semibold">Technician productivity</h1>
      <p className="text-sm text-stone-600">
        Completed visits where the technician was the lead. A re-service counts against the visit before it when booked on the same agreement within 30 days. Product cost is the chemical cost the ledger posted for those visits.
      </p>
      <RangeForm from={range.from} to={range.to} csv="/api/reports/technicians" />
      <Card title={`${range.from} to ${range.to}`}>
        {rows.length === 0 ? (
          <Empty>No completed visits in this range.</Empty>
        ) : (
          <Table headers={["Technician", "Stops", "Working days", "Stops per day", "Revenue serviced", "Minutes on site", "Re-service rate", "Product cost"]}>
            {rows.map((r) => (
              <tr key={r.technician} data-testid="technician-row">
                <td className="py-1 pr-4">{r.technician}</td>
                <td className="py-1 pr-4 tabular-nums">{r.stops}</td>
                <td className="py-1 pr-4 tabular-nums">{r.working_days}</td>
                <td className="py-1 pr-4 tabular-nums">{r.stops_per_day === null ? "no data" : r.stops_per_day.toFixed(1)}</td>
                <td className="py-1 pr-4 tabular-nums">{formatCents(r.revenue_cents)}</td>
                <td className="py-1 pr-4 tabular-nums">{r.minutes_on_site ?? "no times"}</td>
                <td className="py-1 pr-4 tabular-nums">
                  {share(r.reservice_rate)} ({r.reserviced} of {r.base})
                </td>
                <td className="py-1 pr-4 tabular-nums">{r.product_cost_cents === null ? "needs ledger access" : formatCents(r.product_cost_cents)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
