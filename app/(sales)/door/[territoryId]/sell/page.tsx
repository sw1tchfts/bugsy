import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PaymentFields } from "@/components/payment-fields";
import { DoorLocation } from "@/components/sales/door-location";
import { SignatureField } from "@/components/sales/signature-field";
import { Button, Card, Field, Input, Notice, Select, errorMessage } from "@/components/ui";
import { BILLING_MODE_LABELS, CADENCE_LABELS } from "@/lib/agreements/cadence";
import { dbAs } from "@/lib/auth/session";
import { type PriceBookItemLike, cents, priceBookOffers } from "@/lib/catalog/pricing";
import { todayInZone } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { normalizeAddress, normalizeEmail, phoneDigits } from "@/lib/geo/normalize";
import { cardEntry } from "@/lib/payments";
import { loadSettings } from "@/lib/billing/db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { sellAction } from "../../actions";

export const metadata: Metadata = { title: "Sell a plan" };

type Q = Record<string, string | undefined>;
const PROPERTY_TYPES = ["house", "townhouse", "condo"] as const;
const DOOR_CADENCES = ["quarterly", "bimonthly", "monthly"] as const;
const DOOR_BILLING = ["per_visit", "flat_monthly", "annual_prepay"] as const;

/** The sale at the door (spec 17 rule 3): who and where, a quick quote from the price book, then signature and card. */
export default async function Sell({ params, searchParams }: { params: Promise<{ territoryId: string }>; searchParams: Promise<Q> }) {
  const { territoryId } = await params;
  const q = await searchParams;
  const { session, active } = await requireActiveTenant();
  const size = q.size_sqft && /^\d+$/.test(q.size_sqft) ? Number(q.size_sqft) : null;
  const data = await dbAs(session, async (tx) => {
    const [t] = await tx<{ id: string; name: string }[]>`select id, name from public.territories where id = ${territoryId} and tenant_id = ${active.tenantId}`;
    if (!t) return null;
    const types = await tx<{ id: string; name: string }[]>`
      select st.id, st.name from public.service_types st where st.tenant_id = ${active.tenantId} and st.active and st.archived_at is null
        and exists (select 1 from public.price_book_items i where i.service_type_id = st.id and i.active and i.archived_at is null and not i.add_on) order by st.name`;
    const items = q.service_type_id
      ? await tx<PriceBookItemLike[]>`
          select id, service_type_id, name, add_on, size_basis, size_min, size_max, initial_price_cents, recurring_price_cents, one_time_price_cents
          from public.price_book_items where tenant_id = ${active.tenantId} and service_type_id = ${q.service_type_id} and active and archived_at is null and not add_on order by position, size_min`
      : [];
    // Edge case: the address (or the person's email or phone) already has an account; offer to add the plan to it.
    const address = q.line1 && q.city && q.state_code && q.postal_code ? normalizeAddress({ line1: q.line1, city: q.city, stateCode: q.state_code, postalCode: q.postal_code }) : null;
    const email = normalizeEmail(q.email);
    const phone = phoneDigits(q.phone);
    const existing =
      address || email || phone
        ? await tx<{ id: string; name: string; at_address: boolean }[]>`
            select a.id, a.name, bool_or(p.normalized_address = ${address}) as at_address
            from public.accounts a left join public.properties p on p.account_id = a.id and p.archived_at is null
            where a.tenant_id = ${active.tenantId} and a.archived_at is null
              and ((${address}::text is not null and p.normalized_address = ${address}) or (${email}::text is not null and a.email = ${email}) or (${phone}::text is not null and a.phone_digits = ${phone}))
            group by a.id, a.name order by bool_or(p.normalized_address = ${address}) desc nulls last, a.name limit 5`
        : [];
    const [{ dnk }] = address ? await tx<{ dnk: boolean }[]>`select app.do_not_knock(${active.tenantId}, ${address}) as dnk` : [{ dnk: false }];
    return { t, types, items, existing, dnk, cardEntry: cardEntry(await loadSettings(tx, active.tenantId)) };
  });
  if (!data) notFound();
  const offers = priceBookOffers(data.items, { sizeSqft: size, lotSqft: null });
  const ready = Boolean(q.service_type_id && q.name && q.line1);
  const today = todayInZone(active.tenantTimezone);
  return (
    <>
      <p className="text-sm">
        <Link href={`/door/${territoryId}`} className="text-emerald-800 underline">
          Back to {data.t.name}
        </Link>
      </p>
      <h1 className="text-xl font-semibold">Sell a plan</h1>
      {errorMessage(q.error) ? <Notice kind="error">{errorMessage(q.error)}</Notice> : null}
      <Card title="1. The customer and the home">
        <form method="get" className="grid gap-3">
          <Field label="Customer's name" htmlFor="name">
            <Input id="name" name="name" required defaultValue={q.name ?? ""} autoComplete="off" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Email" htmlFor="email">
              <Input id="email" name="email" type="email" defaultValue={q.email ?? ""} />
            </Field>
            <Field label="Phone" htmlFor="phone">
              <Input id="phone" name="phone" type="tel" defaultValue={q.phone ?? ""} />
            </Field>
          </div>
          <Field label="Street address" htmlFor="line1">
            <Input id="line1" name="line1" required defaultValue={q.line1 ?? ""} />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="City" htmlFor="city">
              <Input id="city" name="city" required defaultValue={q.city ?? ""} />
            </Field>
            <Field label="State" htmlFor="state_code">
              <Input id="state_code" name="state_code" required maxLength={2} defaultValue={q.state_code ?? ""} />
            </Field>
            <Field label="ZIP" htmlFor="postal_code">
              <Input id="postal_code" name="postal_code" required maxLength={10} defaultValue={q.postal_code ?? ""} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Home" htmlFor="property_type">
              <Select id="property_type" name="property_type" defaultValue={q.property_type ?? "house"}>
                {PROPERTY_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Size (sq ft)" htmlFor="size_sqft">
              <Input id="size_sqft" name="size_sqft" inputMode="numeric" defaultValue={q.size_sqft ?? ""} />
            </Field>
          </div>
          <Field label="Plan" htmlFor="service_type_id">
            <Select id="service_type_id" name="service_type_id" defaultValue={q.service_type_id ?? data.types[0]?.id}>
              {data.types.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary">
            Price it
          </Button>
        </form>
      </Card>
      {ready ? (
        <Card title="2. Price, signature and card">
          <form action={sellAction} className="grid gap-3">
            <input type="hidden" name="tenant_id" value={active.tenantId} />
            <input type="hidden" name="territory_id" value={territoryId} />
            <DoorLocation />
            {["name", "email", "phone", "line1", "city", "state_code", "postal_code", "property_type", "size_sqft"].map((k) => (
              <input key={k} type="hidden" name={k} value={q[k] ?? ""} />
            ))}
            {data.existing.length ? (
              <fieldset className="grid gap-2 rounded border border-amber-300 bg-amber-50 p-3" data-testid="door-existing">
                <legend className="px-1 text-sm font-medium text-amber-900">Already a customer?</legend>
                <p className="text-sm text-amber-900">This address or contact matches an account the company already has.</p>
                {data.existing.map((a, i) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="existing_account_id" value={a.id} defaultChecked={i === 0} />
                    Add the plan to {a.name}
                    {a.at_address ? " (this address)" : ""}
                  </label>
                ))}
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="existing_account_id" value="" /> Sell as a new customer
                </label>
              </fieldset>
            ) : null}
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">Price</legend>
              {offers.length === 0 ? <p className="text-sm text-stone-600">This plan has no price in the book.</p> : null}
              {offers.map((o, i) =>
                o.pick.status === "match" ? (
                  <label key={o.name} className="flex items-center gap-2 rounded border border-stone-300 bg-white p-2 text-sm" data-testid="door-price">
                    <input type="radio" name="price_book_item_id" value={o.pick.item.id} defaultChecked={i === 0} />
                    <span>
                      {o.name}: {formatCents(cents(o.pick.item.initial_price_cents))} first visit, then {formatCents(cents(o.pick.item.recurring_price_cents))} a visit
                    </span>
                  </label>
                ) : (
                  <p key={o.name} className="text-sm text-amber-800">
                    {o.name}: {o.pick.status === "needs_measurement" ? "enter the home's size to price it" : "no price for this size"}
                  </p>
                ),
              )}
            </fieldset>
            <div className="grid grid-cols-2 gap-2">
              <Field label="How often" htmlFor="cadence">
                <Select id="cadence" name="cadence" defaultValue="quarterly">
                  {DOOR_CADENCES.map((c) => (
                    <option key={c} value={c}>
                      {CADENCE_LABELS[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Billing" htmlFor="billing_mode">
                <Select id="billing_mode" name="billing_mode" defaultValue="per_visit">
                  {DOOR_BILLING.map((b) => (
                    <option key={b} value={b}>
                      {BILLING_MODE_LABELS[b]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="First visit" htmlFor="starts_on">
              <Input id="starts_on" name="starts_on" type="date" min={today} defaultValue={today} required />
            </Field>
            <Field label="Customer types their name" htmlFor="signed_name">
              <Input id="signed_name" name="signed_name" required />
            </Field>
            <SignatureField name="signature" label="Customer signs here" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="consent_notices" value="true" /> The customer agrees to get treatment notices by email or text
            </label>
            {data.dnk ? (
              <label className="flex items-start gap-2 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-900" data-testid="door-dnk">
                <input type="checkbox" name="confirm_dnk" value="true" required className="mt-1" /> This address asked not to be knocked. The customer asked for the plan anyway.
              </label>
            ) : null}
            <div className="grid grid-cols-3 gap-2">
              <PaymentFields {...data.cardEntry} idPrefix="card" names={{ number: "card_number", month: "card_month", year: "card_year" }} />
            </div>
            <p className="text-xs text-stone-600">The card goes to the payment processor and is used for autopay; only its last four digits are kept.</p>
            <Button type="submit">Sign and start the plan</Button>
          </form>
        </Card>
      ) : null}
    </>
  );
}
