import type { Metadata } from "next";
import Link from "next/link";
import { Button, Card, Empty, Field, Input, Table } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { isIsoDate, todayInZone } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { AGING, arAging } from "@/lib/reports/db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { Back } from "../helpers";

export const metadata: Metadata = { title: "Receivables aging" };

/** Open invoices by days past due on a day (spec 12 rule 7). */
export default async function ReceivablesReportPage({ searchParams }: { searchParams: Promise<{ on?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "reports.read");
  await requirePermission(active.tenantId, "billing.read");
  const params = await searchParams;
  const today = todayInZone(active.tenantTimezone);
  const on = params.on && isIsoDate(params.on) ? params.on : today;
  const r = await dbAs(session, (tx) => arAging(tx, active.tenantId, active.tenantTimezone, on));
  const total = AGING.reduce((s, b) => s + r.totals[b], 0);

  return (
    <>
      <Back />
      <h1 className="text-2xl font-semibold">Receivables aging</h1>
      <p className="text-sm text-stone-600">Invoices open on the day shown, less what was paid on them by then, by how many days past their due date they were. Current means not yet due.</p>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <Field label="As of" htmlFor="on">
          <Input id="on" name="on" type="date" defaultValue={on} />
        </Field>
        <Button type="submit" variant="secondary">
          Show
        </Button>
        <a href={`/api/reports/receivables?on=${on}`} className="pb-2 text-sm text-emerald-800 underline" data-testid="report-csv">
          Download CSV
        </a>
      </form>
      <Card title={`Open ${formatCents(total)} on ${on}`}>
        {r.rows.length === 0 ? (
          <Empty>Nothing is open.</Empty>
        ) : (
          <Table headers={["Account", ...AGING.map((b) => (b === "current" ? "Current" : `${b} days`)), "Total"]}>
            {r.rows.map((row) => (
              <tr key={row.account_id} data-testid="aging-row">
                <td className="py-1 pr-4">
                  <Link href={`/customers/${row.account_id}`} className="underline">
                    {row.account}
                  </Link>
                </td>
                {AGING.map((b) => (
                  <td key={b} className="py-1 pr-4 tabular-nums">
                    {row.buckets[b] ? formatCents(row.buckets[b]) : ""}
                  </td>
                ))}
                <td className="py-1 pr-4 tabular-nums">{formatCents(row.total)}</td>
              </tr>
            ))}
            <tr className="font-semibold" data-testid="aging-total">
              <td className="py-1 pr-4">Total</td>
              {AGING.map((b) => (
                <td key={b} className="py-1 pr-4 tabular-nums">
                  {formatCents(r.totals[b])}
                </td>
              ))}
              <td className="py-1 pr-4 tabular-nums">{formatCents(total)}</td>
            </tr>
          </Table>
        )}
      </Card>
    </>
  );
}
