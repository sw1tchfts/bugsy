import type { Metadata } from "next";
import Link from "next/link";
import { PaymentFields } from "@/components/payment-fields";
import { Badge, Button, Card, Empty, Notice, Table, errorMessage } from "@/components/ui";
import { loadSettings } from "@/lib/billing/db";
import { formatBusinessDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { cardEntry } from "@/lib/payments";
import { overview } from "@/lib/portal/db";
import { portalDb, requirePortal } from "@/lib/portal/session";
import { addCard, updateCard } from "../actions";

export const metadata: Metadata = { title: "Billing" };

/** Cards and autopay, and the invoices (spec 16 rule 3). The card number goes to the gateway and is never stored. */
export default async function PortalBilling({ searchParams }: { searchParams: Promise<{ note?: string; error?: string }> }) {
  const q = await searchParams;
  const { session, identity } = await requirePortal();
  const [data, settings] = await portalDb(session, identity, (tx) => Promise.all([overview(tx, identity), loadSettings(tx, identity.tenant_id)]));
  const entry = cardEntry(settings);
  return (
    <>
      <h1 className="text-2xl font-semibold">Billing</h1>
      {q.note ? <Notice kind="success">{q.note}</Notice> : null}
      {q.error ? <Notice kind="error">{errorMessage(q.error)}</Notice> : null}
      <Card title="Cards on file" description="Autopay charges the default card when an invoice is issued.">
        {data.methods.length === 0 ? (
          <Empty>No card on file.</Empty>
        ) : (
          <ul className="grid gap-2">
            {data.methods.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 border-b border-stone-100 pb-2 text-sm" data-testid="portal-card">
                <span className="font-medium">
                  {m.brand ?? m.kind} ending {m.last4}
                </span>
                {m.exp_month ? <span className="text-stone-600">expires {String(m.exp_month).padStart(2, "0")}/{m.exp_year}</span> : null}
                {m.is_default ? <Badge tone="good">default</Badge> : null}
                {m.autopay ? <Badge tone="good">autopay</Badge> : null}
                <form action={updateCard} className="ml-auto flex gap-2">
                  <input type="hidden" name="method_id" value={m.id} />
                  {!m.is_default ? (
                    <Button type="submit" name="intent" value="default" variant="secondary">
                      Make default
                    </Button>
                  ) : null}
                  <Button type="submit" name="intent" value={m.autopay ? "autopay_off" : "autopay_on"} variant="secondary">
                    {m.autopay ? "Turn off autopay" : "Turn on autopay"}
                  </Button>
                  <Button type="submit" name="intent" value="remove" variant="secondary">
                    Remove
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addCard} className="mt-4 grid gap-3 border-t border-stone-100 pt-3 sm:grid-cols-4">
          <PaymentFields {...entry} idPrefix="card" required />
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="autopay" /> Use for autopay
          </label>
          <div className="sm:col-span-4">
            <Button type="submit">Save card</Button>
          </div>
        </form>
      </Card>
      <Card title="Invoices">
        {data.open.length + data.paid.length === 0 ? (
          <Empty>No invoices.</Empty>
        ) : (
          <Table headers={["Invoice", "Issued", "Total", "Status"]}>
            {[...data.open, ...data.paid].map((i) => (
              <tr key={i.id}>
                <td className="py-2 pr-4">
                  <Link href={`/portal/invoices/${i.id}`} className="underline">
                    #{i.number}
                  </Link>
                </td>
                <td className="py-2 pr-4">{i.issued_on ? formatBusinessDate(i.issued_on) : ""}</td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(i.total_cents)}</td>
                <td className="py-2 pr-4">{i.status.replace(/_/g, " ")}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
