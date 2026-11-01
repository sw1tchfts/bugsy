import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Empty, Notice, Table, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { endOfMonth, startOfMonth, todayInZone } from "@/lib/dates";
import { periodsOverview, trialBalanceFor, unposted, unpricedUsage } from "@/lib/ledger/db";
import { formatPeriod } from "@/lib/ledger/periods";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { runLedgerNow } from "./actions";

export const metadata: Metadata = { title: "Ledger" };

const TONE = { open: "neutral", closed: "good", reopened: "warn" } as const;

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ error?: string; note?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "gl.read");
  const { error, note } = await searchParams;
  const tenantId = active.tenantId;
  const canWrite = can(active.permissions, "gl.write");
  const today = todayInZone(active.tenantTimezone);
  const data = await dbAs(session, async (tx) => ({
    periods: await periodsOverview(tx, tenantId, today),
    unposted: await unposted(tx, tenantId),
    unpriced: await unpricedUsage(tx, tenantId),
    month: await trialBalanceFor(tx, tenantId, { from: startOfMonth(today), to: endOfMonth(today) }),
  }));
  const pending = data.unposted.invoices + data.unposted.voids + data.unposted.visits + data.unposted.payments + data.unposted.payouts;
  const lastClosed = data.periods.find((p) => p.status === "closed");

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Ledger</h1>
          <p className="mt-1 text-sm text-stone-600">Every invoice, stop, payment and payout posts its own entry. Revenue is earned as visits are done; each agreement carries one contract balance.</p>
        </div>
        {canWrite ? (
          <form action={runLedgerNow}>
            <input type="hidden" name="tenant_id" value={tenantId} />
            <Button type="submit" variant="secondary">
              Post what the job missed now
            </Button>
          </form>
        ) : null}
      </div>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}
      {note ? <Notice kind="success">{note}</Notice> : null}

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-stone-600">This month&apos;s activity</p>
          <p className="text-2xl font-semibold tabular-nums" data-testid="tb-month">
            {formatCents(data.month.debit_total_cents)}
          </p>
          <p className="text-xs text-stone-500">{data.month.balanced ? "debits equal credits" : "out of balance"}</p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-stone-600">Last closed period</p>
          <p className="text-2xl font-semibold" data-testid="last-closed">
            {lastClosed ? formatPeriod(lastClosed.period) : "none"}
          </p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-stone-600">Waiting for the job</p>
          <p className="text-2xl font-semibold tabular-nums" data-testid="ledger-unposted">
            {pending}
          </p>
          <p className="text-xs text-stone-500">
            {data.unposted.invoices} invoice(s), {data.unposted.voids} void(s), {data.unposted.visits} visit(s), {data.unposted.payments} payment(s), {data.unposted.payouts} payout(s)
          </p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-stone-600">Unpriced product use</p>
          <p className="text-2xl font-semibold tabular-nums" data-testid="ledger-unpriced">
            {data.unpriced.length}
          </p>
          <p className="text-xs text-stone-500">set a unit cost on the product to post it</p>
        </div>
      </div>

      <Card title="Books" description="Where to look.">
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          <li>
            <Link href="/ledger/journal" className="underline">
              General journal
            </Link>
            : every entry, with reversals.
          </li>
          <li>
            <Link href="/ledger/accounts" className="underline">
              Chart of accounts
            </Link>
            : balances and each account&apos;s ledger.
          </li>
          <li>
            <Link href="/ledger/reports/trial-balance" className="underline">
              Trial balance
            </Link>
            ,{" "}
            <Link href="/ledger/reports/income" className="underline">
              income statement
            </Link>
            ,{" "}
            <Link href="/ledger/reports/balance-sheet" className="underline">
              balance sheet
            </Link>
            .
          </li>
          <li>
            <Link href="/ledger/reports/contracts" className="underline">
              Deferred revenue roll-forward
            </Link>
            : the contract balance per agreement.
          </li>
          <li>
            <Link href="/ledger/periods" className="underline">
              Periods
            </Link>
            : close the month, or reopen one as the owner.
          </li>
        </ul>
      </Card>

      <Card title="Periods" description="Calendar months in the company&apos;s zone. A closed month refuses postings; late events post on the first open day.">
        <Table headers={["Period", "Status", "Entries", ""]}>
          {data.periods.slice(0, 6).map((p) => (
            <tr key={p.period} data-testid="ledger-period">
              <td className="py-2 pr-4">{formatPeriod(p.period)}</td>
              <td className="py-2 pr-4">
                <Badge tone={TONE[p.status]}>{p.status}</Badge>
              </td>
              <td className="py-2 pr-4 tabular-nums">{p.entries}</td>
              <td className="py-2 pr-4">
                <Link href={`/ledger/journal?from=${p.period}-01&to=${p.period}-31`} className="underline">
                  Journal
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Unpriced product use" description="Usage at completed stops with no cost on the tenant product, or a unit that does not convert to the cost unit.">
        {data.unpriced.length === 0 ? (
          <Empty>Every product used has been expensed.</Empty>
        ) : (
          <Table headers={["Product", "Amount", "Cost unit", "Customer", ""]}>
            {data.unpriced.slice(0, 50).map((u) => (
              <tr key={u.id} data-testid="unpriced-row">
                <td className="py-2 pr-4">{u.product_name}</td>
                <td className="py-2 pr-4 tabular-nums">
                  {u.amount} {u.amount_unit}
                </td>
                <td className="py-2 pr-4">{u.cost_unit ?? "no cost set"}</td>
                <td className="py-2 pr-4">{u.account_name}</td>
                <td className="py-2 pr-4">
                  <Link href={`/dispatch/visits/${u.visit_id}`} className="underline">
                    Visit
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
