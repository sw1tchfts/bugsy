import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Field, Input, Table } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { isIsoDate, todayInZone } from "@/lib/dates";
import { balanceSheetFor } from "@/lib/ledger/db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { signed } from "../../helpers";

export const metadata: Metadata = { title: "Balance sheet" };

export default async function BalanceSheetPage({ searchParams }: { searchParams: Promise<{ as_of?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "gl.read");
  const params = await searchParams;
  const asOf = params.as_of && isIsoDate(params.as_of) ? params.as_of : todayInZone(active.tenantTimezone);
  const bs = await dbAs(session, (tx) => balanceSheetFor(tx, active.tenantId, asOf));
  const section = (title: string, rows: typeof bs.assets, total: number, testid: string) => (
    <>
      <tr className="font-semibold">
        <td className="py-2 pr-4" colSpan={2}>
          {title}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.account.id} data-testid="bs-row">
          <td className="py-2 pr-4 pl-4">
            {r.account.number} {r.account.name}
          </td>
          <td className="py-2 pr-4 tabular-nums">{signed(r.amount_cents)}</td>
        </tr>
      ))}
      <tr>
        <td className="py-2 pr-4">Total {title.toLowerCase()}</td>
        <td className="py-2 pr-4 tabular-nums" data-testid={testid}>
          {signed(total)}
        </td>
      </tr>
    </>
  );

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/ledger" className="hover:underline">
          Ledger
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Balance sheet</h1>
        <Badge tone={bs.balanced ? "good" : "bad"}>{bs.balanced ? "balanced" : "out of balance"}</Badge>
      </div>
      <Card title="As of">
        <form method="get" className="grid gap-3 sm:grid-cols-4">
          <Field label="Date" htmlFor="as_of">
            <Input id="as_of" name="as_of" type="date" defaultValue={asOf} />
          </Field>
          <div className="flex items-end gap-3">
            <Button type="submit" variant="secondary">
              Show
            </Button>
            <a href={`/api/ledger/balance-sheet.csv?as_of=${asOf}`} className="text-sm text-emerald-800 underline" data-testid="bs-csv">
              Download CSV
            </a>
          </div>
        </form>
      </Card>
      <Card title={`Assets ${signed(bs.assets_cents)}; liabilities and equity ${signed(bs.liabilities_cents + bs.total_equity_cents)}`}>
        <Table headers={["Account", "Amount"]}>
          {section("Assets", bs.assets, bs.assets_cents, "bs-assets")}
          {section("Liabilities", bs.liabilities, bs.liabilities_cents, "bs-liabilities")}
          {section("Equity", bs.equity, bs.equity_cents, "bs-equity")}
          <tr>
            <td className="py-2 pr-4 pl-4">Net income to date</td>
            <td className="py-2 pr-4 tabular-nums">{signed(bs.net_income_cents)}</td>
          </tr>
          <tr className="font-semibold">
            <td className="py-2 pr-4">Total liabilities and equity</td>
            <td className="py-2 pr-4 tabular-nums" data-testid="bs-total">
              {signed(bs.liabilities_cents + bs.total_equity_cents)}
            </td>
          </tr>
        </Table>
      </Card>
    </>
  );
}
