import type { Metadata } from "next";
import Link from "next/link";
import { Button, Card, Empty, Field, Input, Table } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { taxReport } from "@/lib/billing/db";
import { addDays, isIsoDate, startOfMonth, todayInZone } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

export const metadata: Metadata = { title: "Tax collected" };

export default async function TaxPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "billing.read");
  const params = await searchParams;
  const today = todayInZone(active.tenantTimezone);
  const to = params.to && isIsoDate(params.to) ? params.to : today;
  const from = params.from && isIsoDate(params.from) ? params.from : addDays(startOfMonth(to), -30);
  const rows = await dbAs(session, (tx) => taxReport(tx, active.tenantId, from, to));
  const totalTax = rows.reduce((sum, r) => sum + r.tax_cents, 0);

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/billing" className="hover:underline">
          Billing
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Tax collected</h1>
      <p className="text-sm text-stone-600">By jurisdiction, from the breakdown each invoice line kept, for invoices issued in the range. Rates come from the shared rate table with their sources; a state with no rates collects nothing.</p>
      <Card title="Period">
        <form method="get" className="grid gap-3 sm:grid-cols-4">
          <Field label="From" htmlFor="from">
            <Input id="from" name="from" type="date" defaultValue={from} />
          </Field>
          <Field label="To" htmlFor="to">
            <Input id="to" name="to" type="date" defaultValue={to} />
          </Field>
          <div className="flex items-end gap-3 sm:col-span-2">
            <Button type="submit" variant="secondary">
              Show
            </Button>
            <a href={`/api/billing/tax.csv?from=${from}&to=${to}`} className="text-sm text-emerald-800 underline" data-testid="tax-csv">
              Download CSV
            </a>
          </div>
        </form>
      </Card>
      <Card title={`${formatCents(totalTax)} collected`}>
        {rows.length === 0 ? (
          <Empty>No tax collected in this range.</Empty>
        ) : (
          <Table headers={["State", "Jurisdiction", "Kind", "Rate", "Taxable", "Tax", "Invoices"]}>
            {rows.map((r, i) => (
              <tr key={i} data-testid="tax-row">
                <td className="py-2 pr-4">{r.state_code}</td>
                <td className="py-2 pr-4">{r.jurisdiction}</td>
                <td className="py-2 pr-4">{r.kind}</td>
                <td className="py-2 pr-4 tabular-nums">{r.rate}</td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(r.taxable_cents)}</td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(r.tax_cents)}</td>
                <td className="py-2 pr-4 tabular-nums">{r.invoices}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
