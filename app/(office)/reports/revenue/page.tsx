import type { Metadata } from "next";
import Link from "next/link";
import { Card, Empty, Table } from "@/components/ui";
import { MonthBars } from "@/components/charts";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { todayInZone } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { revenueByLine } from "@/lib/reports/db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { Back, RangeForm, rangeOf } from "../helpers";

export const metadata: Metadata = { title: "Revenue by service line" };

/** Revenue by service line and month from the ledger (spec 12 rule 6), so it matches the income statement. */
export default async function RevenueReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "reports.read");
  await requirePermission(active.tenantId, "gl.read");
  const range = rangeOf(await searchParams, todayInZone(active.tenantTimezone), { months: 12 });
  const r = await dbAs(session, (tx) => revenueByLine(tx, active.tenantId, range.from, range.to));
  const cell = (account: string, month: string) => r.rows.find((x) => x.account === account && x.period === month)?.cents ?? 0;
  const points = r.months.map((m) => ({ label: m, value: r.totals[m] ?? 0, display: formatCents(r.totals[m] ?? 0) }));
  const grand = Object.values(r.totals).reduce((s, v) => s + v, 0);

  return (
    <>
      <Back />
      <h1 className="text-2xl font-semibold">Revenue by service line</h1>
      <p className="text-sm text-stone-600">
        Earned revenue from the ledger&apos;s revenue accounts, credits less debits, by the month each entry was posted. Totals match the{" "}
        <Link href={`/ledger/reports/income?from=${range.from}&to=${range.to}`} className="underline">
          income statement
        </Link>
        .
      </p>
      <RangeForm from={range.from} to={range.to} csv="/api/reports/revenue" />
      <Card title="Revenue by month" description="Hover a column for the month's total; the table below has every account.">
        <MonthBars points={points} label="Revenue earned by month" format={(v) => formatCents(Math.round(v)).replace(/\.\d\d$/, "")} />
      </Card>
      <Card title={`Total ${formatCents(grand)}`}>
        {r.accounts.length === 0 ? (
          <Empty>No revenue posted in this range.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table headers={["Account", ...r.months, "Total"]}>
              {r.accounts.map((a) => (
                <tr key={a} data-testid="revenue-account">
                  <td className="py-1 pr-4">{a}</td>
                  {r.months.map((m) => (
                    <td key={m} className="py-1 pr-4 tabular-nums">
                      {formatCents(cell(a, m))}
                    </td>
                  ))}
                  <td className="py-1 pr-4 tabular-nums">{formatCents(r.rows.filter((x) => x.account === a).reduce((s, x) => s + x.cents, 0))}</td>
                </tr>
              ))}
              <tr className="font-semibold" data-testid="revenue-total">
                <td className="py-1 pr-4">Total revenue</td>
                {r.months.map((m) => (
                  <td key={m} className="py-1 pr-4 tabular-nums" data-testid={`revenue-total-${m}`}>
                    {formatCents(r.totals[m] ?? 0)}
                  </td>
                ))}
                <td className="py-1 pr-4 tabular-nums">{formatCents(grand)}</td>
              </tr>
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}
