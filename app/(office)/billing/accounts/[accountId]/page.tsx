import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Table, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { loadSettings, statementFor } from "@/lib/billing/db";
import { formatBusinessDate, formatInstantDate, todayInZone } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { addPaymentMethodAction, recordPaymentAction, refundPaymentAction, removePaymentMethod, setAutopay, setTaxExemption } from "../../actions";

export const metadata: Metadata = { title: "Account billing" };

type Account = { id: string; name: string; terms_days: number; po_required: boolean; past_due_since: string | null; tax_exempt_number: string | null; tax_exempt_expires_on: string | null };
type Method = { id: string; kind: string; brand: string | null; last4: string; exp_month: number | null; exp_year: number | null; autopay: boolean; is_default: boolean };

export default async function AccountBillingPage({ params, searchParams }: { params: Promise<{ accountId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "billing.read");
  const { accountId } = await params;
  const { error } = await searchParams;
  const tenantId = active.tenantId;
  const canWrite = can(active.permissions, "billing.write");
  const today = todayInZone(active.tenantTimezone);

  const data = await dbAs(session, async (tx) => {
    const [account] = await tx<Account[]>`select id, name, terms_days, po_required, past_due_since, tax_exempt_number, tax_exempt_expires_on from public.accounts where id = ${accountId} and tenant_id = ${tenantId}`;
    if (!account) return null;
    const methods = await tx<Method[]>`select id, kind, brand, last4, exp_month, exp_year, autopay, is_default from public.payment_methods where tenant_id = ${tenantId} and account_id = ${accountId} and status = 'active' order by is_default desc, created_at desc`;
    return { account, methods, statement: await statementFor(tx, tenantId, accountId, today, active.tenantTimezone), settings: await loadSettings(tx, tenantId) };
  });
  if (!data) notFound();
  const { account, methods, statement } = data;
  const hidden = (
    <>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="account_id" value={account.id} />
    </>
  );

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/billing" className="hover:underline">
          Billing
        </Link>{" "}
        /{" "}
        <Link href={`/customers/${account.id}`} className="hover:underline">
          {account.name}
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{account.name}</h1>
        {account.past_due_since ? <Badge tone="bad">past due since {formatBusinessDate(account.past_due_since)}</Badge> : <Badge tone="good">in good standing</Badge>}
        {account.tax_exempt_number ? <Badge tone="warn">tax exempt {account.tax_exempt_number}</Badge> : null}
        <Link href={`/billing/accounts/${account.id}/statement`} className="text-sm text-emerald-800 underline">
          Printable statement
        </Link>
      </div>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-stone-600">Balance</p>
          <p className="text-2xl font-semibold tabular-nums" data-testid="account-balance">
            {formatCents(statement.balance_cents)}
          </p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-stone-600">Open invoices</p>
          <p className="text-2xl font-semibold tabular-nums">{formatCents(statement.open_invoices_cents)}</p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-stone-600">Past due</p>
          <p className="text-2xl font-semibold tabular-nums">{formatCents(statement.past_due_cents)}</p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-stone-600">Unallocated credit</p>
          <p className="text-2xl font-semibold tabular-nums" data-testid="account-credit">
            {formatCents(statement.unallocated_cents)}
          </p>
          <p className="text-xs text-stone-500">net {account.terms_days} terms{account.po_required ? ", PO required" : ""}</p>
        </div>
      </div>

      <Card title="Statement" description="Every invoice, credit memo, payment and refund with the running balance.">
        {statement.lines.length === 0 ? (
          <Empty>Nothing billed yet.</Empty>
        ) : (
          <Table headers={["Date", "Type", "Ref", "Description", "Amount", "Balance"]}>
            {statement.lines.map((l, i) => (
              <tr key={i} data-testid="statement-line">
                <td className="py-2 pr-4">{l.date ? formatBusinessDate(l.date) : ""}</td>
                <td className="py-2 pr-4">{l.type.replace("_", " ")}</td>
                <td className="py-2 pr-4">{l.ref}</td>
                <td className="py-2 pr-4">{l.description}</td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(l.amount_cents)}</td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(l.balance_cents)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Invoices" description="Open the invoice to record a payment against it, charge a card or void it.">
        {statement.invoices.length === 0 ? (
          <Empty>No invoices.</Empty>
        ) : (
          <Table headers={["Number", "Issued", "Due", "Total", "Paid", "Status"]}>
            {statement.invoices.map((i) => (
              <tr key={i.id}>
                <td className="py-2 pr-4 tabular-nums">
                  <Link href={`/billing/invoices/${i.id}`} className="underline">
                    {i.kind === "credit_memo" ? "CM " : ""}
                    {i.number !== null ? `#${i.number}` : "draft"}
                  </Link>
                </td>
                <td className="py-2 pr-4">{i.issued_on ? formatBusinessDate(i.issued_on) : ""}</td>
                <td className="py-2 pr-4">{i.due_on ? formatBusinessDate(i.due_on) : ""}</td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(i.total_cents)}</td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(i.paid_cents)}</td>
                <td className="py-2 pr-4">{i.status.replace("_", " ")}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Payments" description="Money received and refunded.">
        {statement.payments.length === 0 ? (
          <Empty>No payments.</Empty>
        ) : (
          <Table headers={["Received", "Kind", "Method", "Reference", "Amount", "Status", ""]}>
            {statement.payments.map((p) => (
              <tr key={p.id} data-testid="payment-row">
                <td className="py-2 pr-4">{formatInstantDate(p.received_at, active.tenantTimezone)}</td>
                <td className="py-2 pr-4">{p.kind}</td>
                <td className="py-2 pr-4">{p.method.replace("_", " ")}</td>
                <td className="py-2 pr-4">{p.reference ?? ""}</td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(p.amount_cents)}</td>
                <td className="py-2 pr-4">{p.status}</td>
                <td className="py-2 text-right">
                  {canWrite && p.kind === "payment" && p.status === "succeeded" ? (
                    <form action={refundPaymentAction} className="flex items-center justify-end gap-2">
                      {hidden}
                      <input type="hidden" name="payment_id" value={p.id} />
                      <Input name="amount" inputMode="decimal" defaultValue={(p.amount_cents / 100).toFixed(2)} className="w-24" aria-label={`Refund amount for payment ${p.id}`} />
                      <Button type="submit" variant="secondary">
                        Refund
                      </Button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
        {canWrite ? (
          <form action={recordPaymentAction} className="mt-4 grid gap-3 sm:grid-cols-5">
            {hidden}
            <Field label="Method" htmlFor="acct-method">
              <Select id="acct-method" name="method" defaultValue="check">
                <option value="check">Check</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            <Field label="Amount ($)" htmlFor="acct-amount">
              <Input id="acct-amount" name="amount" inputMode="decimal" required />
            </Field>
            <Field label="Reference" htmlFor="acct-ref">
              <Input id="acct-ref" name="reference" />
            </Field>
            <Field label="Received on" htmlFor="acct-on">
              <Input id="acct-on" name="received_on" type="date" />
            </Field>
            <div className="self-end">
              <Button type="submit" variant="secondary">
                Record payment
              </Button>
            </div>
          </form>
        ) : null}
      </Card>

      <Card title="Saved payment methods" description="Card and bank details live with the gateway; only the brand, last four and expiry are kept here. The default method with autopay on is charged on each invoice's due date.">
        {methods.length === 0 ? (
          <Empty>No saved method.</Empty>
        ) : (
          <Table headers={["Method", "Expires", "Autopay", ""]}>
            {methods.map((m) => (
              <tr key={m.id} data-testid="payment-method">
                <td className="py-2 pr-4">
                  {m.brand ?? m.kind.replace("_", " ")} ending {m.last4}
                  {m.is_default ? <Badge tone="neutral">default</Badge> : null}
                </td>
                <td className="py-2 pr-4">{m.exp_month && m.exp_year ? `${m.exp_month}/${m.exp_year}` : ""}</td>
                <td className="py-2 pr-4">{m.autopay ? <Badge tone="good">on</Badge> : <Badge>off</Badge>}</td>
                <td className="py-2 text-right">
                  {canWrite ? (
                    <div className="flex justify-end gap-2">
                      <form action={setAutopay}>
                        {hidden}
                        <input type="hidden" name="payment_method_id" value={m.id} />
                        <input type="hidden" name="autopay" value={m.autopay ? "false" : "true"} />
                        <Button type="submit" variant="secondary">
                          {m.autopay ? "Turn autopay off" : "Turn autopay on"}
                        </Button>
                      </form>
                      <form action={removePaymentMethod}>
                        {hidden}
                        <input type="hidden" name="payment_method_id" value={m.id} />
                        <Button type="submit" variant="secondary">
                          Remove
                        </Button>
                      </form>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
        {canWrite ? (
          <form action={addPaymentMethodAction} className="mt-4 grid gap-3 sm:grid-cols-5" data-testid="add-method">
            {hidden}
            <Field label="Kind" htmlFor="pm-kind">
              <Select id="pm-kind" name="kind" defaultValue="card">
                <option value="card">Card</option>
                <option value="bank">Bank account</option>
              </Select>
            </Field>
            <Field label="Number" htmlFor="pm-number" hint="Handed to the gateway, never stored.">
              <Input id="pm-number" name="number" inputMode="numeric" autoComplete="off" required />
            </Field>
            <Field label="Exp. month" htmlFor="pm-month">
              <Input id="pm-month" name="exp_month" inputMode="numeric" placeholder="MM" />
            </Field>
            <Field label="Exp. year" htmlFor="pm-year">
              <Input id="pm-year" name="exp_year" inputMode="numeric" placeholder="YYYY" />
            </Field>
            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" name="autopay" value="true" defaultChecked /> Autopay
              </label>
              <Button type="submit" variant="secondary">
                Save method
              </Button>
            </div>
          </form>
        ) : null}
      </Card>

      {canWrite ? (
        <Card title="Tax exemption" description="An exemption certificate on file zeroes the tax on every invoice until it expires.">
          <form action={setTaxExemption} className="grid gap-3 sm:grid-cols-3">
            {hidden}
            <Field label="Certificate number" htmlFor="exempt-number">
              <Input id="exempt-number" name="tax_exempt_number" defaultValue={account.tax_exempt_number ?? ""} />
            </Field>
            <Field label="Expires on" htmlFor="exempt-expires">
              <Input id="exempt-expires" name="tax_exempt_expires_on" type="date" defaultValue={account.tax_exempt_expires_on ?? ""} />
            </Field>
            <div className="self-end">
              <Button type="submit" variant="secondary">
                Save exemption
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
