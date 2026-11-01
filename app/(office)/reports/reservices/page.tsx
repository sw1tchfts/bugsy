import type { Metadata } from "next";
import { Card, Empty, Table } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { todayInZone } from "@/lib/dates";
import { reserviceReport } from "@/lib/reports/db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { Back, RangeForm, rangeOf, share } from "../helpers";

export const metadata: Metadata = { title: "Re-services" };

/** Re-services booked in a range by service type and reason, against the service type's completed visits. */
export default async function ReservicesReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "reports.read");
  await requirePermission(active.tenantId, "visits.read");
  const range = rangeOf(await searchParams, todayInZone(active.tenantTimezone), { days: 90 });
  const rows = await dbAs(session, (tx) => reserviceReport(tx, active.tenantId, active.tenantTimezone, range.from, range.to));

  return (
    <>
      <Back />
      <h1 className="text-2xl font-semibold">Re-services</h1>
      <p className="text-sm text-stone-600">Free return visits booked in the range, by service type and the reason given, against that service type&apos;s completed visits in the same range.</p>
      <RangeForm from={range.from} to={range.to} csv="/api/reports/reservices" />
      <Card title={`${range.from} to ${range.to}`}>
        {rows.length === 0 ? (
          <Empty>No re-services were booked in this range.</Empty>
        ) : (
          <Table headers={["Service type", "Reason", "Re-services", "Completed visits", "Rate"]}>
            {rows.map((r) => (
              <tr key={`${r.service_type}:${r.reason}`} data-testid="reservice-row">
                <td className="py-1 pr-4">{r.service_type}</td>
                <td className="py-1 pr-4">{r.reason}</td>
                <td className="py-1 pr-4 tabular-nums">{r.reservices}</td>
                <td className="py-1 pr-4 tabular-nums">{r.completed}</td>
                <td className="py-1 pr-4 tabular-nums">{share(r.rate)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
