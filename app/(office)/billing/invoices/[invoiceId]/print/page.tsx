import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { loadSettings } from "@/lib/billing/db";
import { formatBusinessDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

export const metadata: Metadata = { title: "Print invoice" };

type Invoice = {
  id: string;
  number: number | null;
  kind: string;
  status: string;
  issued_on: string | null;
  due_on: string | null;
  terms_days: number;
  po_number: string | null;
  subtotal_cents: string | number;
  tax_cents: string | number;
  total_cents: string | number;
  paid_cents: string | number;
  memo: string | null;
  account_name: string;
  billing_line1: string | null;
  billing_line2: string | null;
  billing_city: string | null;
  billing_state_code: string | null;
  billing_postal_code: string | null;
  property_address: string | null;
  branch_address: string | null;
  tenant_name: string;
  legal_name: string | null;
};
type Line = { id: string; description: string; amount_cents: string | number; tax_class: string; tax_cents: string | number; tax_breakdown: { kind: string; name: string; rate: string; cents: number }[] };

/** The invoice as a page to print or save as PDF: what was done, what was taxed, what is owed. */
export default async function PrintInvoicePage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "billing.read");
  const { invoiceId } = await params;
  const tenantId = active.tenantId;
  const data = await dbAs(session, async (tx) => {
    const [invoice] = await tx<Invoice[]>`
      select i.id, i.number, i.kind, i.status, i.issued_on, i.due_on, i.terms_days, i.po_number, i.subtotal_cents, i.tax_cents, i.total_cents, i.paid_cents, i.memo,
             a.name as account_name, a.billing_line1, a.billing_line2, a.billing_city, a.billing_state_code, a.billing_postal_code,
             p.normalized_address as property_address, b.address as branch_address, t.name as tenant_name, t.legal_name
      from public.invoices i join public.accounts a on a.id = i.account_id join public.tenants t on t.id = i.tenant_id
        left join public.properties p on p.id = i.property_id
        left join public.agreements ag on ag.id = i.agreement_id left join public.branches b on b.id = ag.branch_id
      where i.id = ${invoiceId} and i.tenant_id = ${tenantId}`;
    if (!invoice) return null;
    const lines = await tx<Line[]>`select id, description, amount_cents, tax_class, tax_cents, tax_breakdown from public.invoice_lines where invoice_id = ${invoiceId} order by position`;
    return { invoice, lines, settings: await loadSettings(tx, tenantId) };
  });
  if (!data) notFound();
  const { invoice, lines, settings } = data;
  const total = Number(invoice.total_cents);
  const open = total - Number(invoice.paid_cents);
  const billingAddress = [invoice.billing_line1, invoice.billing_line2, [invoice.billing_city, invoice.billing_state_code, invoice.billing_postal_code].filter(Boolean).join(" ")].filter(Boolean);

  return (
    <>
      <p className="text-sm text-stone-500 print:hidden">
        <Link href={`/billing/invoices/${invoice.id}`} className="hover:underline">
          Invoice
        </Link>
      </p>
      <article className="mx-auto max-w-2xl rounded-lg border border-stone-200 bg-white p-8 text-sm print:border-0 print:p-0" data-testid="invoice-print">
        <header className="mb-6 flex items-start justify-between border-b border-stone-200 pb-4">
          <div>
            <h1 className="text-xl font-semibold">{invoice.legal_name ?? invoice.tenant_name}</h1>
            {invoice.branch_address ? <p className="text-stone-600">{invoice.branch_address}</p> : null}
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold">
              {invoice.kind === "credit_memo" ? "Credit memo" : "Invoice"} {invoice.number !== null ? `#${invoice.number}` : "(draft)"}
            </p>
            {invoice.issued_on ? <p>Issued {formatBusinessDate(invoice.issued_on)}</p> : null}
            {invoice.due_on && invoice.kind === "invoice" ? <p>Due {formatBusinessDate(invoice.due_on)} (net {invoice.terms_days})</p> : null}
            {invoice.po_number ? <p>PO {invoice.po_number}</p> : null}
          </div>
        </header>
        <section className="mb-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-stone-500">Bill to</p>
            <p className="font-medium">{invoice.account_name}</p>
            {billingAddress.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
          {invoice.property_address ? (
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-500">Service address</p>
              <p>{invoice.property_address}</p>
            </div>
          ) : null}
        </section>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-stone-300 text-left">
              <th className="py-1 pr-3">Description</th>
              <th className="py-1 pr-3 text-right">Amount</th>
              <th className="py-1 pr-3 text-right">Tax</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-stone-100">
                <td className="py-1 pr-3">
                  {l.description}
                  {l.tax_class === "taxable" && l.tax_breakdown.length ? <span className="block text-xs text-stone-500">Tax: {l.tax_breakdown.map((b) => `${b.name} ${b.rate}`).join(", ")}</span> : null}
                  {l.tax_class === "exempt_certificate" ? <span className="block text-xs text-stone-500">Tax exempt (certificate on file)</span> : null}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">{formatCents(Number(l.amount_cents))}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{formatCents(Number(l.tax_cents))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto mt-4 grid w-64 grid-cols-2 gap-1">
          <dt className="text-stone-600">Subtotal</dt>
          <dd className="text-right tabular-nums">{formatCents(Number(invoice.subtotal_cents))}</dd>
          <dt className="text-stone-600">Tax</dt>
          <dd className="text-right tabular-nums">{formatCents(Number(invoice.tax_cents))}</dd>
          <dt className="font-semibold">Total</dt>
          <dd className="text-right font-semibold tabular-nums">{formatCents(total)}</dd>
          {invoice.kind === "invoice" && invoice.status !== "void" ? (
            <>
              <dt className="text-stone-600">Paid</dt>
              <dd className="text-right tabular-nums">{formatCents(Number(invoice.paid_cents))}</dd>
              <dt className="font-semibold">Amount due</dt>
              <dd className="text-right font-semibold tabular-nums">{formatCents(open)}</dd>
            </>
          ) : null}
        </dl>
        {invoice.memo ? <p className="mt-4 text-stone-700">{invoice.memo}</p> : null}
        {settings.invoice_footer ? <p className="mt-6 text-xs text-stone-600">{settings.invoice_footer}</p> : null}
        {invoice.status === "void" ? <p className="mt-6 text-lg font-semibold text-red-800">VOID</p> : null}
      </article>
    </>
  );
}
