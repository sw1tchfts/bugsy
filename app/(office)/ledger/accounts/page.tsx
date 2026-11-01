import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Field, Input, Notice, Select, Table, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { normalBalance } from "@/lib/ledger/chart";
import { accounts, ensureChart } from "@/lib/ledger/db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { saveAccount } from "../actions";
import { signed } from "../helpers";

export const metadata: Metadata = { title: "Chart of accounts" };

const SUBTYPES = ["bank", "clearing", "receivable", "contract_asset", "inventory", "fixed_asset", "contract_liability", "tax_payable", "payable", "service_revenue", "other_income", "cost_of_service", "operating_expense", "equity"];

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "gl.read");
  const { error } = await searchParams;
  const canWrite = can(active.permissions, "gl.write");
  const rows = await dbAs(session, async (tx) => {
    if (canWrite) await ensureChart(tx, active.tenantId);
    return accounts(tx, active.tenantId);
  });

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/ledger" className="hover:underline">
          Ledger
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Chart of accounts</h1>
      <p className="text-sm text-stone-600">The pest template, numbered the usual way. Template accounts keep their role; numbers and names are yours. Balances are shown the way the account carries them.</p>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}
      <Card title={`${rows.length} accounts`}>
        <Table headers={["Number", "Name", "Type", "Role", "Balance", "Lines"]}>
          {rows.map((a) => {
            const balance = normalBalance(a.type) === "debit" ? a.balance_cents : -a.balance_cents;
            return (
              <tr key={a.id} data-testid="account-row" className={a.active ? "" : "text-stone-400"}>
                <td className="py-2 pr-4 tabular-nums">{a.number}</td>
                <td className="py-2 pr-4">
                  <Link href={`/ledger/accounts/${a.id}`} className="underline">
                    {a.name}
                  </Link>
                  {!a.active ? <Badge>inactive</Badge> : null}
                </td>
                <td className="py-2 pr-4">{a.type}</td>
                <td className="py-2 pr-4">{a.subtype.replace("_", " ")}</td>
                <td className="py-2 pr-4 tabular-nums">{signed(balance)}</td>
                <td className="py-2 pr-4 tabular-nums">{a.lines}</td>
              </tr>
            );
          })}
        </Table>
      </Card>
      {canWrite ? (
        <Card title="Add an account" description="For what the template lacks: a second bank account, a truck lease, a line of credit.">
          <form action={saveAccount} className="grid gap-3 sm:grid-cols-5">
            <input type="hidden" name="tenant_id" value={active.tenantId} />
            <Field label="Number" htmlFor="acct-number">
              <Input id="acct-number" name="number" inputMode="numeric" required />
            </Field>
            <Field label="Name" htmlFor="acct-name">
              <Input id="acct-name" name="name" required />
            </Field>
            <Field label="Type" htmlFor="acct-type">
              <Select id="acct-type" name="type" defaultValue="expense">
                {["asset", "liability", "equity", "revenue", "expense"].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Role" htmlFor="acct-subtype">
              <Select id="acct-subtype" name="subtype" defaultValue="operating_expense">
                {SUBTYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace("_", " ")}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="secondary">
                Add account
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
