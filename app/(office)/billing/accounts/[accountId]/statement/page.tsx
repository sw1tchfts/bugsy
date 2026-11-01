import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { loadSettings, statementFor } from "@/lib/billing/db";
import { formatBusinessDate, todayInZone } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

export const metadata: Metadata = { title: "Statement" };

/** One statement per account across its agreements and properties, as a page to print or save as PDF. */
export default async function StatementPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "billing.read");
  const { accountId } = await params;
  const tenantId = active.tenantId;
  const today = todayInZone(active.tenantTimezone);
  const data = await dbAs(session, async (tx) => {
    const [account] = await tx<{ name: string; billing_line1: string | null; billing_line2: string | null; billing_city: string | null; billing_state_code: string | null; billing_postal_code: string | null; tenant_name: string; legal_name: string | null }[]>`
      select a.name, a.billing_line1, a.billing_line2, a.billing_city, a.billing_state_code, a.billing_postal_code, t.name as tenant_name, t.legal_name
      from public.accounts a join public.tenants t on t.id = a.tenant_id where a.id = ${accountId} and a.tenant_id = ${tenantId}`;
    if (!account) return null;
    return { account, statement: await statementFor(tx, tenantId, accountId, today, active.tenantTimezone), settings: await loadSettings(tx, tenantId) };
  });
  if (!data) notFound();
  const { account, statement, settings } = data;
  const address = [account.billing_line1, account.billing_line2, [account.billing_city, account.billing_state_code, account.billing_postal_code].filter(Boolean).join(" ")].filter(Boolean);

  return (
    <>
      <p className="text-sm text-stone-500 print:hidden">
        <Link href={`/billing/accounts/${accountId}`} className="hover:underline">
          Account billing
        </Link>
      </p>
      <article className="mx-auto max-w-2xl rounded-lg border border-stone-200 bg-white p-8 text-sm print:border-0 print:p-0" data-testid="statement-print">
        <header className="mb-6 flex items-start justify-between border-b border-stone-200 pb-4">
          <div>
            <h1 className="text-xl font-semibold">{account.legal_name ?? account.tenant_name}</h1>
            <p className="text-stone-600">Statement as of {formatBusinessDate(today)}</p>
          </div>
          <div className="text-right">
            <p className="font-medium">{account.name}</p>
            {address.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
        </header>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-stone-300 text-left">
              <th className="py-1 pr-3">Date</th>
              <th className="py-1 pr-3">Ref</th>
              <th className="py-1 pr-3">Description</th>
              <th className="py-1 pr-3 text-right">Amount</th>
              <th className="py-1 pr-3 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {statement.lines.map((l, i) => (
              <tr key={i} className="border-b border-stone-100">
                <td className="py-1 pr-3">{l.date ? formatBusinessDate(l.date) : ""}</td>
                <td className="py-1 pr-3">{l.ref}</td>
                <td className="py-1 pr-3">{l.description}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{formatCents(l.amount_cents)}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{formatCents(l.balance_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto mt-4 grid w-72 grid-cols-2 gap-1">
          <dt className="text-stone-600">Open invoices</dt>
          <dd className="text-right tabular-nums">{formatCents(statement.open_invoices_cents)}</dd>
          <dt className="text-stone-600">Past due</dt>
          <dd className="text-right tabular-nums">{formatCents(statement.past_due_cents)}</dd>
          <dt className="text-stone-600">Unallocated credit</dt>
          <dd className="text-right tabular-nums">{formatCents(statement.unallocated_cents)}</dd>
          <dt className="font-semibold">Balance</dt>
          <dd className="text-right font-semibold tabular-nums">{formatCents(statement.balance_cents)}</dd>
        </dl>
        {settings.invoice_footer ? <p className="mt-6 text-xs text-stone-600">{settings.invoice_footer}</p> : null}
      </article>
    </>
  );
}
