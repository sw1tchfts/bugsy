import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Field, Input, Table } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { todayInZone } from "@/lib/dates";
import { trialBalanceFor } from "@/lib/ledger/db";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { rangeFromParams, signed } from "../../helpers";

export const metadata: Metadata = { title: "Trial balance" };

export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "gl.read");
  const range = rangeFromParams(await searchParams, todayInZone(active.tenantTimezone));
  const tb = await dbAs(session, (tx) => trialBalanceFor(tx, active.tenantId, range));

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/ledger" className="hover:underline">
          Ledger
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Trial balance</h1>
        <Badge tone={tb.balanced ? "good" : "bad"}>{tb.balanced ? "balanced" : "out of balance"}</Badge>
      </div>
      <Card title="Range">
        <form method="get" className="grid gap-3 sm:grid-cols-4">
          <Field label="From" htmlFor="from">
            <Input id="from" name="from" type="date" defaultValue={range.from} />
          </Field>
          <Field label="To" htmlFor="to">
            <Input id="to" name="to" type="date" defaultValue={range.to} />
          </Field>
          <div className="flex items-end gap-3 sm:col-span-2">
            <Button type="submit" variant="secondary">
              Show
            </Button>
            <a href={`/api/ledger/trial-balance.csv?from=${range.from}&to=${range.to}`} className="text-sm text-emerald-800 underline" data-testid="tb-csv">
              Download CSV
            </a>
          </div>
        </form>
      </Card>
      <Card title={`Debits ${formatCents(tb.debit_total_cents)}, credits ${formatCents(tb.credit_total_cents)}`} description="Opening and closing balances are debit positive; a credit balance shows in parentheses.">
        <Table headers={["Number", "Account", "Opening", "Debits", "Credits", "Closing"]}>
          {tb.rows.map((r) => (
            <tr key={r.account.id} data-testid="tb-row">
              <td className="py-2 pr-4 tabular-nums">{r.account.number}</td>
              <td className="py-2 pr-4">
                <Link href={`/ledger/accounts/${r.account.id}?from=${range.from}&to=${range.to}`} className="underline">
                  {r.account.name}
                </Link>
              </td>
              <td className="py-2 pr-4 tabular-nums">{signed(r.opening_cents)}</td>
              <td className="py-2 pr-4 tabular-nums">{formatCents(r.debit_cents)}</td>
              <td className="py-2 pr-4 tabular-nums">{formatCents(r.credit_cents)}</td>
              <td className="py-2 pr-4 tabular-nums">{signed(r.closing_cents)}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-2 pr-4" colSpan={3}>
              Total
            </td>
            <td className="py-2 pr-4 tabular-nums" data-testid="tb-debits">
              {formatCents(tb.debit_total_cents)}
            </td>
            <td className="py-2 pr-4 tabular-nums" data-testid="tb-credits">
              {formatCents(tb.credit_total_cents)}
            </td>
            <td className="py-2 pr-4 tabular-nums">
              {formatCents(tb.closing_debit_cents)} / ({formatCents(tb.closing_credit_cents)})
            </td>
          </tr>
        </Table>
      </Card>
    </>
  );
}
