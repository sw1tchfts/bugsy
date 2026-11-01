import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, Table } from "@/components/ui";
import { Sparkline } from "@/components/charts";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { dashboard } from "@/lib/reports/db";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { share } from "./helpers";

export const metadata: Metadata = { title: "Reports" };

function Tile({ label, value, detail, href, children, testid }: { label: string; value: string; detail?: string; href: string; children?: ReactNode; testid: string }) {
  return (
    <Link href={href} className="block rounded-lg border border-stone-200 bg-white p-4 shadow-sm hover:border-emerald-700" data-testid={testid}>
      <p className="text-sm text-stone-600">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      {detail ? <p className="text-xs text-stone-500">{detail}</p> : null}
      {children}
    </Link>
  );
}

/** The owner dashboard (spec 12): each tile is a number with the report behind it; tiles a role cannot read are absent. */
export default async function ReportsPage() {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "reports.read");
  const d = await dbAs(session, (tx) => dashboard(tx, active.tenantId, active.tenantTimezone, active.permissions));
  const trend = d.agreements?.trend.map((t) => ({ label: t.month, value: t.rate, display: share(t.rate) })) ?? [];

  return (
    <>
      <h1 className="text-2xl font-semibold">Reports</h1>
      <p className="text-sm text-stone-600">How the business is doing, as of today. Each number opens its report.</p>
      <div className="grid gap-4 sm:grid-cols-4">
        {d.agreements ? (
          <>
            <Tile label="Active agreements" value={String(d.agreements.active)} detail={`${d.agreements.renewals30} end in the next 30 days`} href="/reports/retention" testid="tile-active" />
            <Tile label={`Attrition, ${d.agreements.attrition.month}`} value={share(d.agreements.attrition.rate)} detail={`${d.agreements.attrition.lost} of ${d.agreements.attrition.active_at_start} lost; under 2% a month is top quartile`} href="/reports/retention" testid="tile-attrition">
              <Sparkline points={trend} label="Monthly attrition, last twelve months" />
            </Tile>
            <Tile label="Retention, 12 months" value={share(d.agreements.retention12)} detail="80% or more a year is strong" href="/reports/retention" testid="tile-retention" />
          </>
        ) : null}
        {d.revenue ? <Tile label="Revenue earned this month" value={formatCents(d.revenue.this_month)} detail={`${formatCents(d.revenue.last_month)} last month`} href="/reports/revenue" testid="tile-revenue" /> : null}
        {d.receivables ? <Tile label="Open receivables" value={formatCents(d.receivables.open)} detail={`${formatCents(d.receivables.past_due)} past due on ${d.receivables.accounts_past_due} account(s)`} href="/reports/receivables" testid="tile-receivables" /> : null}
        {d.contracts ? <Tile label="Contract position" value={formatCents(d.contracts.deferred)} detail={`deferred revenue; ${formatCents(d.contracts.unbilled)} delivered, not yet billed`} href="/ledger/reports/contracts" testid="tile-contracts" /> : null}
        {d.visits ? (
          <>
            <Tile label="Visits completed" value={String(d.visits.completed_7)} detail={`${d.visits.completed_30} in 30 days`} href="/reports/technicians" testid="tile-visits" />
            <Tile label="Stops per technician day" value={d.visits.stops_per_day === null ? "no data" : d.visits.stops_per_day.toFixed(1)} detail="last 30 days; 12 to 18 is a common benchmark" href="/reports/technicians" testid="tile-density" />
            <Tile label="Re-service rate" value={share(d.visits.reservice_rate)} detail={`${d.visits.reservices_30} re-services booked in 30 days`} href="/reports/reservices" testid="tile-reservices" />
          </>
        ) : null}
        {d.compliance_tasks !== null ? <Tile label="Compliance tasks open" value={String(d.compliance_tasks)} href="/compliance" testid="tile-compliance" /> : null}
        {d.texts_waiting !== null ? <Tile label="Texts waiting" value={String(d.texts_waiting)} href="/messages" testid="tile-texts" /> : null}
      </div>
      {d.leads ? (
        <Card title="Close rate by lead source, last 90 days" actions={<Link href="/reports/sales" className="text-sm text-emerald-800 underline">Sales report</Link>}>
          <Table headers={["Source", "Won", "Lost", "Close rate"]}>
            {d.leads.map((l) => (
              <tr key={l.source} data-testid="dashboard-source">
                <td className="py-1 pr-4">{l.source}</td>
                <td className="py-1 pr-4 tabular-nums">{l.won}</td>
                <td className="py-1 pr-4 tabular-nums">{l.lost}</td>
                <td className="py-1 pr-4 tabular-nums">{share(l.rate)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}
      <Card title="More reports">
        <ul className="grid gap-2 text-sm sm:grid-cols-3">
          <li>
            <Link href="/reports/retention" className="underline">Retention and churn</Link>
          </li>
          <li>
            <Link href="/reports/technicians" className="underline">Technician productivity</Link>
          </li>
          <li>
            <Link href="/reports/job-costing" className="underline">Job costing</Link>
          </li>
          {d.revenue ? (
            <li>
              <Link href="/reports/revenue" className="underline">Revenue by service line</Link>
            </li>
          ) : null}
          {d.receivables ? (
            <li>
              <Link href="/reports/receivables" className="underline">Receivables aging</Link>
            </li>
          ) : null}
          <li>
            <Link href="/reports/sales" className="underline">Sales by source</Link>
          </li>
          <li>
            <Link href="/reports/reservices" className="underline">Re-services</Link>
          </li>
          <li>
            <Link href="/reports/custom" className="underline">Custom reports</Link>
          </li>
          <li>
            <a href="/api/reports/export.zip" className="underline" data-testid="export-zip">Export all data (CSV)</a>
          </li>
        </ul>
      </Card>
    </>
  );
}
