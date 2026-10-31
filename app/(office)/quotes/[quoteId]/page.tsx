import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, Field, Input, Notice, Select, Textarea, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { type PriceBookItemLike, bandLabel, offeredColumns, priceBookOffers, priceFor } from "@/lib/catalog/pricing";
import { formatBusinessDate, formatInstantDate, todayInZone } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { addLine, addLineFromPriceBook, addOption, removeLine, removeOption, setQuoteStatus, updateOption, updateQuote } from "../actions";

export const metadata: Metadata = { title: "Quote" };

type Quote = {
  id: string; number: number; status: string; valid_until: string | null; notes: string | null; sent_at: string | null; decided_at: string | null;
  accepted_option_id: string | null; lead_id: string | null; lead_name: string | null; account_id: string | null; account_name: string | null; created_at: string;
  property_id: string | null; size_sqft: number | null; lot_sqft: number | null;
};
type PriceItem = PriceBookItemLike & { service_type_name: string };
type Option = { id: string; position: number; name: string; description: string | null; recommended: boolean; total_cents: number };
type Line = { id: string; option_id: string; position: number; description: string; kind: string; quantity: string; unit_price_cents: number; amount_cents: number };

const KIND_LABEL: Record<string, string> = { initial: "Initial service", recurring: "Recurring visit", one_time: "One-time", add_on: "Add-on" };

export default async function QuotePage({ params, searchParams }: { params: Promise<{ quoteId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { quoteId } = await params;
  const { error } = await searchParams;
  const { session, active } = await requireActiveTenant();
  const tenantId = active.tenantId;
  const canWrite = can(active.permissions, "agreements.write");

  const data = await dbAs(session, async (tx) => {
    const [quote] = await tx<Quote[]>`
      select q.id, q.number, q.status, q.valid_until, q.notes, q.sent_at, q.decided_at, q.accepted_option_id, q.lead_id, l.name as lead_name,
             q.account_id, a.name as account_name, q.created_at, q.property_id, p.size_sqft, p.lot_sqft
      from public.quotes q
        left join public.leads l on l.id = q.lead_id
        left join public.accounts a on a.id = q.account_id
        left join public.properties p on p.id = q.property_id
      where q.id = ${quoteId} and q.tenant_id = ${tenantId}`;
    if (!quote) return null;
    const options = await tx<Option[]>`select id, position, name, description, recommended, total_cents from public.quote_options where quote_id = ${quoteId} order by position`;
    const lines = await tx<Line[]>`
      select l.id, l.option_id, l.position, l.description, l.kind, l.quantity::text, l.unit_price_cents, l.amount_cents
      from public.quote_lines l join public.quote_options o on o.id = l.option_id where o.quote_id = ${quoteId} order by o.position, l.position`;
    const items = await tx<PriceItem[]>`
      select p.id, p.service_type_id, st.name as service_type_name, p.name, p.add_on, p.size_basis, p.size_min, p.size_max,
             p.initial_price_cents, p.recurring_price_cents, p.one_time_price_cents
      from public.price_book_items p join public.service_types st on st.id = p.service_type_id
      where p.tenant_id = ${tenantId} and p.active and p.archived_at is null and st.active and st.archived_at is null
      order by st.name, p.position, p.name, p.size_min`;
    return { quote, options, lines, items };
  });
  if (!data) notFound();
  const { quote, options, lines, items } = data;
  const editable = canWrite && quote.status === "draft";

  // Price book choices for this quote's property. Items that need a size the property lacks are listed but not pickable.
  const serviceTypeNames = new Map(items.map((i) => [i.service_type_id, i.service_type_name]));
  const choices: { value: string; label: string }[] = [];
  const blocked: string[] = [];
  for (const offer of priceBookOffers(items, { sizeSqft: quote.size_sqft, lotSqft: quote.lot_sqft })) {
    const prefix = `${serviceTypeNames.get(offer.serviceTypeId)}: ${offer.name}`;
    if (offer.pick.status === "match") {
      const item = offer.pick.item;
      for (const column of offeredColumns(item)) {
        const band = item.size_basis === "none" ? "" : ` (${bandLabel(item)})`;
        const kind = item.add_on ? `add-on, ${KIND_LABEL[column].toLowerCase()}` : KIND_LABEL[column].toLowerCase();
        choices.push({ value: `${item.id}:${column}`, label: `${prefix}${band}, ${kind} ${formatCents(priceFor(item, column))}` });
      }
    } else if (offer.pick.status === "needs_measurement") {
      blocked.push(`${prefix}: enter the ${offer.pick.basis === "size_sqft" ? "home" : "lot"} size on the property first`);
    }
  }

  return (
    <>
      <div>
        <p className="text-sm text-stone-500">
          {quote.lead_id ? (
            <Link href={`/leads/${quote.lead_id}`} className="hover:underline">
              Lead: {quote.lead_name}
            </Link>
          ) : null}
          {quote.lead_id && quote.account_id ? " / " : null}
          {quote.account_id ? (
            <Link href={`/customers/${quote.account_id}`} className="hover:underline">
              Account: {quote.account_name}
            </Link>
          ) : null}
        </p>
        <h1 className="text-2xl font-semibold">
          Quote #{quote.number} <Badge tone={quote.status === "accepted" ? "good" : quote.status === "declined" ? "bad" : quote.status === "sent" ? "warn" : "neutral"}>{quote.status}</Badge>
        </h1>
        <p className="text-sm text-stone-600">
          Created {formatInstantDate(quote.created_at, active.tenantTimezone)}
          {quote.valid_until ? `, valid until ${formatBusinessDate(quote.valid_until)}` : ""}
          {quote.sent_at ? `, sent ${formatInstantDate(quote.sent_at, active.tenantTimezone)}` : ""}
          {quote.decided_at ? `, decided ${formatInstantDate(quote.decided_at, active.tenantTimezone)}` : ""}.
        </p>
      </div>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      {canWrite ? (
        <Card title="Status">
          <div className="flex flex-wrap gap-3">
            {quote.status === "draft" ? (
              <form action={setQuoteStatus}>
                <input type="hidden" name="tenant_id" value={tenantId} />
                <input type="hidden" name="quote_id" value={quoteId} />
                <input type="hidden" name="status" value="sent" />
                <Button type="submit">Mark sent</Button>
              </form>
            ) : null}
            {quote.status === "sent" ? (
              <>
                <form action={setQuoteStatus} className="flex items-end gap-2">
                  <input type="hidden" name="tenant_id" value={tenantId} />
                  <input type="hidden" name="quote_id" value={quoteId} />
                  <input type="hidden" name="status" value="accepted" />
                  <Field label="Customer accepted" htmlFor="accept-option">
                    <Select id="accept-option" name="option_id" required defaultValue={options.find((o) => o.recommended)?.id ?? options[0]?.id}>
                      {options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name} ({formatCents(o.total_cents)})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Button type="submit">Record acceptance</Button>
                </form>
                <form action={setQuoteStatus}>
                  <input type="hidden" name="tenant_id" value={tenantId} />
                  <input type="hidden" name="quote_id" value={quoteId} />
                  <input type="hidden" name="status" value="declined" />
                  <Button type="submit" variant="danger">
                    Declined
                  </Button>
                </form>
                {quote.valid_until && quote.valid_until < todayInZone(active.tenantTimezone) ? (
                  <form action={setQuoteStatus}>
                    <input type="hidden" name="tenant_id" value={tenantId} />
                    <input type="hidden" name="quote_id" value={quoteId} />
                    <input type="hidden" name="status" value="expired" />
                    <Button type="submit" variant="secondary">
                      Expired
                    </Button>
                  </form>
                ) : null}
              </>
            ) : null}
            {quote.status === "draft" ? <p className="self-center text-sm text-stone-500">Sending marks the quote sent; emailing it to the customer arrives with messaging (spec 11).</p> : null}
            {quote.status === "accepted" ? (
              <p className="self-center text-sm text-stone-600">
                Accepted option: {options.find((o) => o.id === quote.accepted_option_id)?.name}.{" "}
                {quote.account_id ? (
                  <Link href={`/agreements/new?quote_option=${quote.accepted_option_id}`} className="font-medium text-emerald-800 underline">
                    Create the agreement
                  </Link>
                ) : (
                  "Convert the lead to an account to create the agreement."
                )}
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {options.map((o) => {
        const optionLines = lines.filter((l) => l.option_id === o.id);
        return (
          <Card
            key={o.id}
            title={`${o.name}${o.recommended ? " (recommended)" : ""}`}
            description={o.description ?? undefined}
            actions={<span className="text-lg font-semibold tabular-nums">{formatCents(o.total_cents)}</span>}
          >
            {optionLines.length === 0 ? <p className="text-sm text-stone-500">No lines yet.</p> : null}
            {optionLines.length ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                    <th className="py-2 pr-4 text-left font-medium">Line</th>
                    <th className="py-2 pr-4 text-left font-medium">Kind</th>
                    <th className="py-2 pr-4 text-right font-medium">Qty</th>
                    <th className="py-2 pr-4 text-right font-medium">Unit</th>
                    <th className="py-2 pr-4 text-right font-medium">Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {optionLines.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2 pr-4">{l.description}</td>
                      <td className="py-2 pr-4 text-stone-600">{KIND_LABEL[l.kind]}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{Number(l.quantity)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatCents(l.unit_price_cents)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatCents(l.amount_cents)}</td>
                      <td className="py-2 text-right">
                        {editable ? (
                          <form action={removeLine}>
                            <input type="hidden" name="tenant_id" value={tenantId} />
                            <input type="hidden" name="quote_id" value={quoteId} />
                            <input type="hidden" name="line_id" value={l.id} />
                            <Button type="submit" variant="danger">
                              Remove
                            </Button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {editable ? (
              <div className="mt-4 grid gap-4 border-t border-stone-100 pt-4">
                {choices.length || blocked.length ? (
                  <form action={addLineFromPriceBook} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="tenant_id" value={tenantId} />
                    <input type="hidden" name="quote_id" value={quoteId} />
                    <input type="hidden" name="option_id" value={o.id} />
                    <Field label="From the price book" htmlFor={`pick-${o.id}`}>
                      <Select id={`pick-${o.id}`} name="pick" required defaultValue="">
                        <option value="" disabled>
                          Pick an item
                        </option>
                        {choices.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                        {blocked.map((b) => (
                          <option key={b} value="" disabled>
                            {b}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Button type="submit" variant="secondary">
                      Add from price book
                    </Button>
                  </form>
                ) : null}
                <form action={addLine} className="grid gap-3 sm:grid-cols-[1fr_160px_90px_120px_auto] sm:items-end">
                  <input type="hidden" name="tenant_id" value={tenantId} />
                  <input type="hidden" name="quote_id" value={quoteId} />
                  <input type="hidden" name="option_id" value={o.id} />
                  <Field label="Line" htmlFor={`desc-${o.id}`}>
                    <Input id={`desc-${o.id}`} name="description" required placeholder="Quarterly visit" />
                  </Field>
                  <Field label="Kind" htmlFor={`kind-${o.id}`}>
                    <Select id={`kind-${o.id}`} name="kind" defaultValue="recurring">
                      {Object.entries(KIND_LABEL).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Qty" htmlFor={`qty-${o.id}`}>
                    <Input id={`qty-${o.id}`} name="quantity" type="number" step="0.01" min="0.01" defaultValue="1" />
                  </Field>
                  <Field label="Unit price ($)" htmlFor={`price-${o.id}`}>
                    <Input id={`price-${o.id}`} name="unit_price" inputMode="decimal" required placeholder="125.00" />
                  </Field>
                  <Button type="submit" variant="secondary">
                    Add line
                  </Button>
                </form>
                <form action={updateOption} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="tenant_id" value={tenantId} />
                  <input type="hidden" name="quote_id" value={quoteId} />
                  <input type="hidden" name="option_id" value={o.id} />
                  <Field label="Option name" htmlFor={`oname-${o.id}`}>
                    <Input id={`oname-${o.id}`} name="name" defaultValue={o.name} required />
                  </Field>
                  <Field label="Description" htmlFor={`odesc-${o.id}`}>
                    <Input id={`odesc-${o.id}`} name="description" defaultValue={o.description ?? ""} />
                  </Field>
                  <label className="flex items-center gap-2 pb-2 text-sm">
                    <input type="checkbox" name="recommended" value="true" defaultChecked={o.recommended} /> Recommended
                  </label>
                  <Button type="submit" variant="secondary">
                    Save option
                  </Button>
                  <Button type="submit" variant="danger" formAction={removeOption} disabled={options.length === 1}>
                    Remove option
                  </Button>
                </form>
              </div>
            ) : null}
          </Card>
        );
      })}

      {editable ? (
        <Card title="Add an option" description="Good, better, best: each option is a complete offer with its own lines.">
          <form action={addOption} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="tenant_id" value={tenantId} />
            <input type="hidden" name="quote_id" value={quoteId} />
            <Field label="Name" htmlFor="new-option-name">
              <Input id="new-option-name" name="name" placeholder="Quarterly plan with mosquito season" required />
            </Field>
            <Field label="Description" htmlFor="new-option-desc">
              <Input id="new-option-desc" name="description" />
            </Field>
            <Button type="submit" variant="secondary">
              Add option
            </Button>
          </form>
        </Card>
      ) : null}

      {canWrite ? (
        <Card title="Quote details">
          <form action={updateQuote} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="tenant_id" value={tenantId} />
            <input type="hidden" name="quote_id" value={quoteId} />
            <Field label="Valid until" htmlFor="valid_until">
              <Input id="valid_until" name="valid_until" type="date" defaultValue={quote.valid_until ?? ""} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Notes for the customer" htmlFor="notes">
                <Textarea id="notes" name="notes" defaultValue={quote.notes ?? ""} />
              </Field>
            </div>
            <div>
              <Button type="submit" variant="secondary">
                Save details
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
