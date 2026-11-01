import type { Metadata } from "next";
import Link from "next/link";
import { Card, Empty, Table } from "@/components/ui";
import { MonthBars, heatStyle } from "@/components/charts";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { todayInZone } from "@/lib/dates";
import { type Breakdown, retentionReport } from "@/lib/reports/db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { Back, RangeForm, rangeOf, share } from "../helpers";

export const metadata: Metadata = { title: "Retention and churn" };

function BreakdownTable({ title, by, rows, testid }: { title: string; by: string; rows: Breakdown[]; testid: string }) {
  const total = rows.reduce((sum, r) => sum + r.lost, 0);
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <Empty>No agreements lost in this range.</Empty>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
              <th className="py-2 pr-4 font-medium">{by}</th>
              <th className="py-2 pr-4 text-right font-medium">Lost</th>
              <th className="py-2 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((r) => (
              <tr key={r.key} data-testid={testid}>
                <td className="py-1 pr-4">{r.key}</td>
                <td className="py-1 pr-4 text-right tabular-nums">{r.lost}</td>
                <td className="py-1 text-right tabular-nums">{share(total ? r.lost / total : null, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/** Retention and churn (spec 12 rules 1 to 4): attrition by month, why agreements were lost, and how each cohort held. */
export default async function RetentionPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "reports.read");
  await requirePermission(active.tenantId, "agreements.read");
  const range = rangeOf(await searchParams, todayInZone(active.tenantTimezone), { months: 12 });
  const r = await dbAs(session, (tx) => retentionReport(tx, active.tenantId, active.tenantTimezone, range.from, range.to));
  const points = r.months.map((m) => ({ label: m.month, value: m.rate, display: `${share(m.rate)} (${m.lost} of ${m.active_at_start})` }));
  const depth = Math.max(0, ...r.cohorts.map((c) => c.retained.length));

  return (
    <>
      <Back />
      <h1 className="text-2xl font-semibold">Retention and churn</h1>
      <p className="text-sm text-stone-600">
        Attrition is agreements lost in a month (cancelled, or ended without renewal) over those active on its first day. Under 2% a month is top quartile; 80% or more kept over a year is strong.
      </p>
      <RangeForm from={range.from} to={range.to} csv="/api/reports/retention" />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-stone-200 bg-white p-4" data-testid="retention-kept">
          <p className="text-sm text-stone-600">Kept over the range</p>
          <p className="text-2xl font-semibold">{share(r.retention.rate)}</p>
          <p className="text-xs text-stone-500">
            {r.retention.kept} of {r.retention.base} active on {range.from} still active on {range.to}
          </p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <p className="text-sm text-stone-600">Agreements lost</p>
          <p className="text-2xl font-semibold">{r.lost.length}</p>
          <p className="text-xs text-stone-500">last active day in the range</p>
        </div>
      </div>
      <Card title="Attrition by month" description="Hover a column for the month's figures; the table below has them all.">
        <MonthBars points={points} label="Monthly attrition rate" format={(v) => `${(v * 100).toFixed(1)}%`} />
        <Table headers={["Month", "Active on the 1st", "Lost", "Attrition"]}>
          {r.months.map((m) => (
            <tr key={m.month} data-testid="attrition-month">
              <td className="py-1 pr-4">{m.month}</td>
              <td className="py-1 pr-4 tabular-nums">{m.active_at_start}</td>
              <td className="py-1 pr-4 tabular-nums">{m.lost}</td>
              <td className="py-1 pr-4 tabular-nums">{share(m.rate)}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <BreakdownTable title="By reason" by="Reason" rows={r.reasons} testid="lost-reason" />
        <BreakdownTable title="By service line" by="Service line" rows={r.lines} testid="lost-line" />
        <BreakdownTable title="By technician" by="Technician" rows={r.technicians} testid="lost-technician" />
      </div>
      <Card title="Cohorts" description="Agreements signed each month, and the share still active N months after that month ended. Darker is more kept.">
        {r.cohorts.length === 0 ? (
          <Empty>No agreements were signed in this range.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs tabular-nums" data-testid="cohort-table">
              <thead>
                <tr className="text-left text-stone-500">
                  <th className="py-1 pr-3 font-medium">Signed</th>
                  <th className="py-1 pr-3 font-medium">Agreements</th>
                  {Array.from({ length: depth }, (_, i) => (
                    <th key={i} className="w-12 min-w-12 px-1 py-1 text-center font-medium">
                      {i}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.cohorts.map((c) => (
                  <tr key={c.month}>
                    <td className="py-1 pr-3">{c.month}</td>
                    <td className="py-1 pr-3">{c.signed}</td>
                    {Array.from({ length: depth }, (_, i) => {
                      const v = c.retained[i] ?? null;
                      return (
                        <td key={i} className="w-12 min-w-12 border-2 border-white px-1 py-1 text-center" style={heatStyle(v)} title={v === null ? `${c.month}, month ${i}: not yet` : `${c.month}, month ${i}: ${share(v, 0)} kept`}>
                          {v === null ? "" : share(v, 0)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Agreements lost">
        {r.lost.length === 0 ? (
          <Empty>None in this range.</Empty>
        ) : (
          <Table headers={["Agreement", "Account", "Service line", "Last active", "Reason", "Technician"]}>
            {r.lost.map((a) => (
              <tr key={a.id} data-testid="lost-agreement">
                <td className="py-1 pr-4">
                  <Link href={`/agreements/${a.id}`} className="underline">
                    #{a.number}
                  </Link>
                </td>
                <td className="py-1 pr-4">{a.account_name}</td>
                <td className="py-1 pr-4">{a.service_line}</td>
                <td className="py-1 pr-4">{a.last_active}</td>
                <td className="py-1 pr-4">{a.cancel_reason ?? (a.cancelled_on ? "no reason recorded" : "ended, not renewed")}</td>
                <td className="py-1 pr-4">{a.technician ?? "no visit yet"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
