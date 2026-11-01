import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, Field, Notice, Select, Table, errorMessage } from "@/components/ui";
import { formatBusinessDate, formatInstantDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { invoiceDetail, overview } from "@/lib/portal/db";
import { portalDb, requirePortal } from "@/lib/portal/session";
import { payInvoice } from "../../actions";

export const metadata: Metadata = { title: "Invoice" };

/** An invoice (spec 16 rule 3): its lines, what was paid, and paying the rest with a card on file. */
export default async function PortalInvoice({ params, searchParams }: { params: Promise<{ invoiceId: string }>; searchParams: Promise<{ note?: string; error?: string }> }) {
  const { invoiceId } = await params;
  const q = await searchParams;
  const { session, identity } = await requirePortal();
  const data = await portalDb(session, identity, async (tx) => {
    const invoice = await invoiceDetail(tx, identity, invoiceId);
    return invoice ? { invoice, methods: (await overview(tx, identity)).methods } : null;
  });
  if (!data) notFound();
  const { invoice, methods } = data;
  const open = invoice.total_cents - invoice.paid_cents;
  const payable = ["issued", "partially_paid", "past_due"].includes(invoice.status) && open > 0;
  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/portal" className="hover:underline">
          Home
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">
        Invoice #{invoice.number} <Badge tone={invoice.status === "paid" ? "good" : invoice.status === "past_due" ? "bad" : "warn"}>{invoice.status.replace(/_/g, " ")}</Badge>
      </h1>
      <p className="text-sm text-stone-600">
        {invoice.issued_on ? `Issued ${formatBusinessDate(invoice.issued_on)}. ` : ""}
        {invoice.due_on ? `Due ${formatBusinessDate(invoice.due_on)}.` : ""}
      </p>
      {q.note ? <Notice kind="success">{q.note}</Notice> : null}
      {q.error ? <Notice kind="error">{errorMessage(q.error)}</Notice> : null}
      <Card title="Charges">
        <Table headers={["", "Amount", "Tax"]}>
          {invoice.lines.map((l, i) => (
            <tr key={i}>
              <td className="py-2 pr-4">{l.description}</td>
              <td className="py-2 pr-4 tabular-nums">{formatCents(l.amount_cents)}</td>
              <td className="py-2 pr-4 tabular-nums">{l.tax_cents ? formatCents(l.tax_cents) : ""}</td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-sm">
          Total {formatCents(invoice.total_cents)}; paid {formatCents(invoice.paid_cents)}; <span className="font-semibold" data-testid="portal-invoice-open">open {formatCents(open)}</span>
        </p>
        {invoice.payments.length ? (
          <ul className="mt-2 text-sm text-stone-600">
            {invoice.payments.map((p) => (
              <li key={p.id}>
                {formatCents(p.amount_cents)} by {p.method.replace(/_/g, " ")} on {formatInstantDate(p.received_at, identity.tenant_timezone)}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      {payable ? (
        <Card title={`Pay ${formatCents(open)}`}>
          {methods.length === 0 ? (
            <p className="text-sm">
              Add a card first on the{" "}
              <Link href="/portal/billing" className="text-emerald-800 underline">
                billing page
              </Link>
              .
            </p>
          ) : (
            <form action={payInvoice} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="invoice_id" value={invoice.id} />
              <input type="hidden" name="attempt" value={crypto.randomUUID()} />
              <Field label="Pay with" htmlFor="method_id">
                <Select id="method_id" name="method_id" defaultValue={methods.find((m) => m.is_default)?.id ?? methods[0].id}>
                  {methods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.brand ?? m.kind} ending {m.last4}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit">Pay now</Button>
            </form>
          )}
        </Card>
      ) : null}
    </>
  );
}
