import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Card, Empty, Field, Input, Notice, Table, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { formatBusinessDate, todayInZone } from "@/lib/dates";
import { normalBalance } from "@/lib/ledger/chart";
import { accountLedger, accounts } from "@/lib/ledger/db";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { saveAccount } from "../../actions";
import { SOURCE_LABELS, rangeFromParams, signed } from "../../helpers";

export const metadata: Metadata = { title: "Account ledger" };

export default async function AccountLedgerPage({ params, searchParams }: { params: Promise<{ accountId: string }>; searchParams: Promise<{ from?: string; to?: string; error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "gl.read");
  const { accountId } = await params;
  const query = await searchParams;
  const range = rangeFromParams(query, todayInZone(active.tenantTimezone));
  const canWrite = can(active.permissions, "gl.write");
  const data = await dbAs(session, async (tx) => {
    const account = (await accounts(tx, active.tenantId)).find((a) => a.id === accountId);
    if (!account) return null;
    return { account, ledger: await accountLedger(tx, active.tenantId, accountId, range) };
  });
  if (!data) notFound();
  const sign = normalBalance(data.account.type) === "debit" ? 1 : -1;

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/ledger" className="hover:underline">
          Ledger
        </Link>{" "}
        /{" "}
        <Link href="/ledger/accounts" className="hover:underline">
          Accounts
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">
        {data.account.number} {data.account.name}
      </h1>
      <p className="text-sm text-stone-600">
        {data.account.type}, {data.account.subtype.replace("_", " ")}. Balances read the way this account carries them.
      </p>
      {query.error ? <Notice kind="error">{errorMessage(query.error)}</Notice> : null}
      {canWrite ? (
        <Card title="Number and name" description={data.account.system ? "A template account: its role stays and it stays active; the number and name are yours." : "A custom account: deactivate it to stop new postings."}>
          <form action={saveAccount} className="grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="tenant_id" value={active.tenantId} />
            <input type="hidden" name="account_id" value={data.account.id} />
            <Field label="Number" htmlFor="edit-number">
              <Input id="edit-number" name="number" inputMode="numeric" defaultValue={data.account.number} required />
            </Field>
            <Field label="Name" htmlFor="edit-name">
              <Input id="edit-name" name="name" defaultValue={data.account.name} required />
            </Field>
            {data.account.system ? (
              <input type="hidden" name="active" value="true" />
            ) : (
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" name="active" value="false" defaultChecked={!data.account.active} /> Inactive
              </label>
            )}
            <div className="flex items-end">
              <Button type="submit" variant="secondary">
                Save account
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      <Card title="Range">
        <form method="get" className="grid gap-3 sm:grid-cols-4">
          <Field label="From" htmlFor="from">
            <Input id="from" name="from" type="date" defaultValue={range.from} />
          </Field>
          <Field label="To" htmlFor="to">
            <Input id="to" name="to" type="date" defaultValue={range.to} />
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="secondary">
              Show
            </Button>
          </div>
        </form>
      </Card>
      <Card title={`Opening ${signed(sign * data.ledger.opening_cents)}, closing ${signed(sign * data.ledger.closing_cents)}`}>
        {data.ledger.lines.length === 0 ? (
          <Empty>No lines in this range.</Empty>
        ) : (
          <Table headers={["Date", "Entry", "Kind", "Memo", "Debit", "Credit", "Agreement", "Balance"]}>
            {data.ledger.lines.map((l, i) => (
              <tr key={i} data-testid="ledger-line">
                <td className="py-2 pr-4">{formatBusinessDate(l.posted_on)}</td>
                <td className="py-2 pr-4 tabular-nums">
                  <Link href={`/ledger/journal/${l.entry_id}`} className="underline">
                    #{l.number}
                  </Link>
                </td>
                <td className="py-2 pr-4">{SOURCE_LABELS[l.source_type] ?? l.source_type}</td>
                <td className="py-2 pr-4">{l.memo}</td>
                <td className="py-2 pr-4 tabular-nums">{l.debit_cents ? formatCents(l.debit_cents) : ""}</td>
                <td className="py-2 pr-4 tabular-nums">{l.credit_cents ? formatCents(l.credit_cents) : ""}</td>
                <td className="py-2 pr-4">{l.agreement_number ? `#${l.agreement_number}` : l.jurisdiction ?? ""}</td>
                <td className="py-2 pr-4 tabular-nums">{signed(sign * l.balance_cents)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
