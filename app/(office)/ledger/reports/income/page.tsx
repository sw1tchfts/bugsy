import type { Metadata } from "next";
import Link from "next/link";
import { Button, Card, Field, Input, Select, Table } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { todayInZone } from "@/lib/dates";
import { CHART_TEMPLATE } from "@/lib/ledger/chart";
import { cashBasisFor, incomeStatementFor } from "@/lib/ledger/db";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { rangeFromParams, signed } from "../../helpers";

export const metadata: Metadata = { title: "Income statement" };

export default async function IncomePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; basis?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "gl.read");
  const params = await searchParams;
  const range = rangeFromParams(params, todayInZone(active.tenantTimezone));
  const basis = params.basis === "cash" ? "cash" : "accrual";
  const data = await dbAs(session, async (tx) =>
    basis === "cash" ? { cash: await cashBasisFor(tx, active.tenantId, range, active.tenantTimezone), accrual: null } : { accrual: await incomeStatementFor(tx, active.tenantId, range), cash: null },
  );
  const names = new Map(CHART_TEMPLATE.map((a) => [a.key, a.name]));

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/ledger" className="hover:underline">
          Ledger
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Income statement</h1>
      <p className="text-sm text-stone-600">Accrual is the books: revenue as visits are done. The cash view counts money when it lands on an invoice, pro rata across its lines, with refunds and payout fees against it.</p>
      <Card title="Range and basis">
        <form method="get" className="grid gap-3 sm:grid-cols-5">
          <Field label="From" htmlFor="from">
            <Input id="from" name="from" type="date" defaultValue={range.from} />
          </Field>
          <Field label="To" htmlFor="to">
            <Input id="to" name="to" type="date" defaultValue={range.to} />
          </Field>
          <Field label="Basis" htmlFor="basis">
            <Select id="basis" name="basis" defaultValue={basis}>
              <option value="accrual">Accrual</option>
              <option value="cash">Cash</option>
            </Select>
          </Field>
          <div className="flex items-end gap-3 sm:col-span-2">
            <Button type="submit" variant="secondary">
              Show
            </Button>
            <a href={`/api/ledger/income.csv?from=${range.from}&to=${range.to}&basis=${basis}`} className="text-sm text-emerald-800 underline" data-testid="income-csv">
              Download CSV
            </a>
          </div>
        </form>
      </Card>
      {data.accrual ? (
        <Card title={`Net income ${signed(data.accrual.net_income_cents)}`} description="Accrual basis.">
          <Table headers={["Account", "Amount"]}>
            <tr className="font-semibold">
              <td className="py-2 pr-4" colSpan={2}>
                Revenue
              </td>
            </tr>
            {data.accrual.revenue.map((r) => (
              <tr key={r.account.id} data-testid="income-row">
                <td className="py-2 pr-4 pl-4">
                  {r.account.number} {r.account.name}
                </td>
                <td className="py-2 pr-4 tabular-nums">{signed(r.amount_cents)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-2 pr-4">Total revenue</td>
              <td className="py-2 pr-4 tabular-nums" data-testid="income-revenue">
                {signed(data.accrual.revenue_cents)}
              </td>
            </tr>
            <tr className="font-semibold">
              <td className="py-2 pr-4" colSpan={2}>
                Expenses
              </td>
            </tr>
            {data.accrual.expenses.map((r) => (
              <tr key={r.account.id} data-testid="income-row">
                <td className="py-2 pr-4 pl-4">
                  {r.account.number} {r.account.name}
                </td>
                <td className="py-2 pr-4 tabular-nums">{signed(r.amount_cents)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-2 pr-4">Total expenses</td>
              <td className="py-2 pr-4 tabular-nums">{signed(data.accrual.expenses_cents)}</td>
            </tr>
            <tr className="font-semibold">
              <td className="py-2 pr-4">Net income</td>
              <td className="py-2 pr-4 tabular-nums" data-testid="income-net">
                {signed(data.accrual.net_income_cents)}
              </td>
            </tr>
          </Table>
        </Card>
      ) : null}
      {data.cash ? (
        <Card title={`Net cash income ${signed(data.cash.net_cents)}`} description="Cash basis view.">
          <Table headers={["Line", "Amount"]}>
            {data.cash.revenue.map((r) => (
              <tr key={r.account} data-testid="income-row">
                <td className="py-2 pr-4 pl-4">{names.get(r.account) ?? r.account}</td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(r.amount_cents)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-2 pr-4">Revenue received</td>
              <td className="py-2 pr-4 tabular-nums" data-testid="income-revenue">
                {formatCents(data.cash.revenue_cents)}
              </td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Sales tax collected (not income)</td>
              <td className="py-2 pr-4 tabular-nums">{formatCents(data.cash.tax_collected_cents)}</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Receipts not yet applied to an invoice</td>
              <td className="py-2 pr-4 tabular-nums">{formatCents(data.cash.unapplied_cents)}</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Refunds</td>
              <td className="py-2 pr-4 tabular-nums">({formatCents(data.cash.refunds_cents)})</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Payment processing fees</td>
              <td className="py-2 pr-4 tabular-nums">({formatCents(data.cash.fees_cents)})</td>
            </tr>
            <tr className="font-semibold">
              <td className="py-2 pr-4">Net cash income</td>
              <td className="py-2 pr-4 tabular-nums" data-testid="income-net">
                {signed(data.cash.net_cents)}
              </td>
            </tr>
          </Table>
        </Card>
      ) : null}
    </>
  );
}
