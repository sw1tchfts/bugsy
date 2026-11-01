import type { Metadata } from "next";
import { Card, Empty, Table } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { todayInZone } from "@/lib/dates";
import { salesBySource } from "@/lib/reports/db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { Back, RangeForm, rangeOf, share } from "../helpers";

export const metadata: Metadata = { title: "Sales by source" };

/** Leads created in a range by source, with the close rate (spec 12 rule 8). */
export default async function SalesReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "reports.read");
  await requirePermission(active.tenantId, "customers.read");
  const range = rangeOf(await searchParams, todayInZone(active.tenantTimezone), { days: 90 });
  const r = await dbAs(session, (tx) => salesBySource(tx, active.tenantId, active.tenantTimezone, range.from, range.to));

  return (
    <>
      <Back />
      <h1 className="text-2xl font-semibold">Sales by source</h1>
      <p className="text-sm text-stone-600">Leads created in the range. Close rate is won over won plus lost; open leads are counted but left out of the rate.</p>
      <RangeForm from={range.from} to={range.to} csv="/api/reports/sales" />
      <Card title={`${range.from} to ${range.to}`}>
        {r.rows.length === 0 ? (
          <Empty>No leads were created in this range.</Empty>
        ) : (
          <Table headers={["Source", "Leads", "Won", "Lost", "Open", "Close rate"]}>
            {[...r.rows, r.total].map((s) => (
              <tr key={s.source} className={s === r.total ? "font-semibold" : ""} data-testid="sales-row">
                <td className="py-1 pr-4">{s.source}</td>
                <td className="py-1 pr-4 tabular-nums">{s.leads}</td>
                <td className="py-1 pr-4 tabular-nums">{s.won}</td>
                <td className="py-1 pr-4 tabular-nums">{s.lost}</td>
                <td className="py-1 pr-4 tabular-nums">{s.open}</td>
                <td className="py-1 pr-4 tabular-nums">{share(s.rate)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
