import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Table, Textarea, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { formatBusinessDate, formatInstant } from "@/lib/dates";
import { listMembers } from "@/lib/dispatch/db";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { chargeInvoiceAction, issueDraft, recordPaymentAction, refundPaymentAction, setPoNumber, voidInvoiceAction } from "../../actions";

export const metadata: Metadata = { title: "Invoice" };

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
  source: string;
  tax_unconfirmed: boolean;
  void_reason: string | null;
  voided_at: string | null;
  account_id: string;
  account_name: string;
  po_required: boolean;
  property_address: string | null;
  agreement_id: string | null;
  agreement_number: number | null;
  visit_id: string | null;
};
type Line = { id: string; position: number; description: string; amount_cents: string | number; tax_class: string; tax_rate: string; tax_cents: string | number; service_line: string | null };
type Allocation = { payment_id: string; amount_cents: string | number; method: string; received_at: string; reference: string | null; status: string; refunded: string | number; payment_amount: string | number };
type Method = { id: string; brand: string | null; last4: string; kind: string; autopay: boolean; is_default: boolean };
type Attempt = { attempt: number; scheduled_for: string; attempted_at: string | null; result: string | null; error: string | null };

const TONE: Record<string, "neutral" | "good" | "warn" | "bad"> = { draft: "neutral", issued: "warn", partially_paid: "warn", paid: "good", past_due: "bad", void: "neutral" };

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ invoiceId: string }>; searchParams: Promise<{ error?: string; note?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "billing.read");
  const { invoiceId } = await params;
  const { error, note } = await searchParams;
  const tenantId = active.tenantId;
  const tz = active.tenantTimezone;
  const canWrite = can(active.permissions, "billing.write");

  const data = await dbAs(session, async (tx) => {
    const [invoice] = await tx<Invoice[]>`
      select i.id, i.number, i.kind, i.status, i.issued_on, i.due_on, i.terms_days, i.po_number, i.subtotal_cents, i.tax_cents, i.total_cents, i.paid_cents, i.memo, i.source, i.tax_unconfirmed,
             i.void_reason, i.voided_at, i.account_id, a.name as account_name, a.po_required, p.normalized_address as property_address, i.agreement_id, ag.number as agreement_number, i.visit_id
      from public.invoices i join public.accounts a on a.id = i.account_id
        left join public.properties p on p.id = i.property_id left join public.agreements ag on ag.id = i.agreement_id
      where i.id = ${invoiceId} and i.tenant_id = ${tenantId}`;
    if (!invoice) return null;
    const lines = await tx<Line[]>`select id, position, description, amount_cents, tax_class, tax_rate::text, tax_cents, service_line from public.invoice_lines where invoice_id = ${invoiceId} order by position`;
    const allocations = await tx<Allocation[]>`
      select al.payment_id, al.amount_cents, p.method, p.received_at, p.reference, p.status, p.amount_cents as payment_amount,
             coalesce((select sum(r.amount_cents) from public.payments r where r.refund_of = p.id and r.status = 'succeeded'), 0) as refunded
      from public.payment_allocations al join public.payments p on p.id = al.payment_id where al.invoice_id = ${invoiceId} order by p.received_at`;
    const methods = await tx<Method[]>`select id, brand, last4, kind, autopay, is_default from public.payment_methods where tenant_id = ${tenantId} and account_id = ${invoice.account_id} and status = 'active' order by is_default desc, created_at desc`;
    const attempts = await tx<Attempt[]>`select attempt, scheduled_for, attempted_at, result, error from public.autopay_attempts where invoice_id = ${invoiceId} order by attempt`;
    return { invoice, lines, allocations, methods, attempts, members: await listMembers(tx, tenantId) };
  });
  if (!data) notFound();
  const { invoice, lines, allocations, methods, attempts } = data;
  const total = Number(invoice.total_cents);
  const open = total - Number(invoice.paid_cents);
  const isOpen = invoice.kind === "invoice" && ["issued", "partially_paid", "past_due"].includes(invoice.status) && open > 0;
  const hidden = (
    <>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="invoice_id" value={invoice.id} />
      <input type="hidden" name="account_id" value={invoice.account_id} />
    </>
  );

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/billing" className="hover:underline">
          Billing
        </Link>{" "}
        /{" "}
        <Link href="/billing/invoices" className="hover:underline">
          Invoices
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">
          {invoice.kind === "credit_memo" ? "Credit memo" : "Invoice"} {invoice.number !== null ? `#${invoice.number}` : "(draft)"}
        </h1>
        <Badge tone={TONE[invoice.status] ?? "neutral"}>{invoice.status.replace("_", " ")}</Badge>
        {invoice.tax_unconfirmed ? <Badge tone="warn">tax class unconfirmed for this state</Badge> : null}
        <Link href={`/billing/invoices/${invoice.id}/print`} className="text-sm text-emerald-800 underline">
          Print view
        </Link>
      </div>
      <p className="text-sm text-stone-600">
        <Link href={`/billing/accounts/${invoice.account_id}`} className="underline">
          {invoice.account_name}
        </Link>
        {invoice.property_address ? `, ${invoice.property_address}` : ""}. {invoice.source.replace("_", " ")}
        {invoice.agreement_id ? (
          <>
            {" "}
            on{" "}
            <Link href={`/agreements/${invoice.agreement_id}`} className="underline">
              agreement #{invoice.agreement_number}
            </Link>
          </>
        ) : null}
        {invoice.visit_id ? (
          <>
            {" "}
            for{" "}
            <Link href={`/dispatch/visits/${invoice.visit_id}`} className="underline">
              the visit
            </Link>
          </>
        ) : null}
        . {invoice.issued_on ? `Issued ${formatBusinessDate(invoice.issued_on)}, due ${formatBusinessDate(invoice.due_on ?? invoice.issued_on)} (net ${invoice.terms_days}).` : "Not issued yet."}
        {invoice.po_number ? ` PO ${invoice.po_number}.` : ""}
        {invoice.memo ? ` ${invoice.memo}.` : ""}
        {invoice.status === "void" ? ` Void: ${invoice.void_reason} (${invoice.voided_at ? formatInstant(invoice.voided_at, tz) : ""}).` : ""}
      </p>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}
      {note ? <Notice kind="success">{note}</Notice> : null}

      <Card title="Lines" description="Each line carries the service type that decided its tax; the breakdown names the jurisdictions.">
        <Table headers={["#", "Description", "Amount", "Tax class", "Rate", "Tax"]}>
          {lines.map((l) => (
            <tr key={l.id} data-testid="invoice-line">
              <td className="py-2 pr-4 text-xs text-stone-500">{l.position}</td>
              <td className="py-2 pr-4">{l.description}</td>
              <td className="py-2 pr-4 tabular-nums">{formatCents(Number(l.amount_cents))}</td>
              <td className="py-2 pr-4">{l.tax_class.replace("_", " ")}</td>
              <td className="py-2 pr-4 tabular-nums">{l.tax_rate}</td>
              <td className="py-2 pr-4 tabular-nums">{formatCents(Number(l.tax_cents))}</td>
            </tr>
          ))}
        </Table>
        <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-stone-500">Subtotal</dt>
            <dd className="tabular-nums">{formatCents(Number(invoice.subtotal_cents))}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Tax</dt>
            <dd className="tabular-nums">{formatCents(Number(invoice.tax_cents))}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Total</dt>
            <dd className="tabular-nums font-semibold" data-testid="invoice-total">
              {formatCents(total)}
            </dd>
          </div>
          <div>
            <dt className="text-stone-500">Open</dt>
            <dd className="tabular-nums" data-testid="invoice-open">
              {invoice.kind === "invoice" && invoice.status !== "void" ? formatCents(open) : ""}
            </dd>
          </div>
        </dl>
      </Card>

      {invoice.status === "draft" && canWrite ? (
        <Card title="Draft" description={invoice.po_required ? "This account requires a PO number on every invoice." : "Issue it to number it and start the terms."}>
          <div className="grid gap-3 sm:grid-cols-2">
            <form action={setPoNumber} className="flex items-end gap-2">
              {hidden}
              <Field label="PO number" htmlFor="po">
                <Input id="po" name="po_number" defaultValue={invoice.po_number ?? ""} />
              </Field>
              <Button type="submit" variant="secondary">
                Save PO
              </Button>
            </form>
            <form action={issueDraft} className="self-end">
              {hidden}
              <Button type="submit">Issue invoice</Button>
            </form>
          </div>
        </Card>
      ) : null}

      <Card title="Payments" description="Money allocated to this invoice.">
        {allocations.length === 0 ? (
          <Empty>Nothing paid yet.</Empty>
        ) : (
          <Table headers={["Received", "Method", "Reference", "Allocated", "Payment", ""]}>
            {allocations.map((a) => (
              <tr key={a.payment_id} data-testid="allocation-row">
                <td className="py-2 pr-4">{formatInstant(a.received_at, tz)}</td>
                <td className="py-2 pr-4">{a.method.replace("_", " ")}</td>
                <td className="py-2 pr-4">{a.reference ?? ""}</td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(Number(a.amount_cents))}</td>
                <td className="py-2 pr-4 tabular-nums">
                  {formatCents(Number(a.payment_amount))}
                  {Number(a.refunded) > 0 ? ` (${formatCents(Number(a.refunded))} refunded)` : ""}
                </td>
                <td className="py-2 text-right">
                  {canWrite && a.status === "succeeded" && Number(a.payment_amount) > Number(a.refunded) ? (
                    <form action={refundPaymentAction} className="flex items-center justify-end gap-2">
                      <input type="hidden" name="tenant_id" value={tenantId} />
                      <input type="hidden" name="payment_id" value={a.payment_id} />
                      <input type="hidden" name="account_id" value={invoice.account_id} />
                      <input type="hidden" name="return_to" value={`/billing/invoices/${invoice.id}`} />
                      <Input name="amount" inputMode="decimal" defaultValue={((Number(a.payment_amount) - Number(a.refunded)) / 100).toFixed(2)} className="w-24" aria-label="Refund amount" />
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
        {attempts.length ? (
          <ul className="mt-3 grid gap-1 text-xs text-stone-600">
            {attempts.map((t) => (
              <li key={t.attempt} data-testid="attempt-row">
                Autopay attempt {t.attempt} planned {formatBusinessDate(t.scheduled_for)}: {t.result ?? "pending"}
                {t.attempted_at ? ` at ${formatInstant(t.attempted_at, tz)}` : ""}
                {t.error ? ` (${t.error})` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {isOpen && canWrite ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card title="Record a payment" description="Cash, check or other money received for this invoice.">
            <form action={recordPaymentAction} className="grid gap-3">
              {hidden}
              <Field label="Method" htmlFor="pay-method">
                <Select id="pay-method" name="method" defaultValue="check">
                  <option value="check">Check</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
              <Field label="Amount ($)" htmlFor="pay-amount">
                <Input id="pay-amount" name="amount" inputMode="decimal" defaultValue={(open / 100).toFixed(2)} required />
              </Field>
              <Field label="Check number or reference" htmlFor="pay-ref">
                <Input id="pay-ref" name="reference" />
              </Field>
              <Field label="Received on" htmlFor="pay-on" hint="Blank for now.">
                <Input id="pay-on" name="received_on" type="date" />
              </Field>
              <Button type="submit">Record payment</Button>
            </form>
          </Card>
          <Card title="Charge a saved method" description="Charges the open amount through the gateway and allocates it here.">
            {methods.length === 0 ? (
              <Empty>
                No saved method.{" "}
                <Link href={`/billing/accounts/${invoice.account_id}`} className="underline">
                  Add one on the account
                </Link>
                .
              </Empty>
            ) : (
              <form action={chargeInvoiceAction} className="grid gap-3">
                {hidden}
                <Field label="Method" htmlFor="charge-method">
                  <Select id="charge-method" name="payment_method_id" defaultValue={methods[0].id}>
                    {methods.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.brand ?? m.kind} ending {m.last4}
                        {m.autopay ? " (autopay)" : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button type="submit">Charge {formatCents(open)}</Button>
              </form>
            )}
          </Card>
        </div>
      ) : null}

      {canWrite && invoice.status !== "void" && invoice.status !== "paid" && Number(invoice.paid_cents) === 0 && allocations.length === 0 ? (
        <Card title="Void" description="Only with a reason, and only while nothing is paid against it. The invoice stays on file as void.">
          <form action={voidInvoiceAction} className="grid gap-3 sm:grid-cols-3">
            {hidden}
            <div className="sm:col-span-2">
              <Field label="Reason" htmlFor="void-reason">
                <Textarea id="void-reason" name="reason" rows={2} required />
              </Field>
            </div>
            <div className="self-end">
              <Button type="submit" variant="danger">
                Void invoice
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
