import type { Metadata } from "next";
import Link from "next/link";
import { AgreementFields } from "@/components/agreements/agreement-fields";
import { Button, Card, Field, Notice, Select, errorMessage } from "@/components/ui";
import { agreementFromOption } from "@/lib/agreements/quotes";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { type PriceBookItemLike, offeredColumns, priceBookOffers, priceFor } from "@/lib/catalog/pricing";
import { startOfMonth, todayInZone } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { createAgreement } from "../actions";

export const metadata: Metadata = { title: "New agreement" };

type Account = { id: string; name: string };
type Property = { id: string; account_id: string; name: string | null; normalized_address: string; size_sqft: number | null; lot_sqft: number | null };
type ServiceType = { id: string; name: string; pricing_method: string };
type Branch = { id: string; name: string };
type OptionInfo = { quote_id: string; option_id: string; option_name: string; account_id: string | null; property_id: string | null; lead_id: string | null };
type Line = { kind: "initial" | "recurring" | "one_time" | "add_on"; description: string; amount_cents: string };

type Search = { error?: string; account_id?: string; property_id?: string; quote_option?: string };

export default async function NewAgreementPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "agreements.write");
  const params = await searchParams;
  const tenantId = active.tenantId;

  const data = await dbAs(session, async (tx) => {
    let accountId = params.account_id ?? null;
    let propertyId = params.property_id ?? null;
    let option: OptionInfo | null = null;
    let prices: ReturnType<typeof agreementFromOption> | null = null;
    if (params.quote_option) {
      const [row] = await tx<OptionInfo[]>`
        select q.id as quote_id, o.id as option_id, o.name as option_name, q.account_id, q.property_id, q.lead_id
        from public.quote_options o join public.quotes q on q.id = o.quote_id where o.id = ${params.quote_option} and o.tenant_id = ${tenantId}`;
      if (row) {
        option = row;
        accountId = accountId ?? row.account_id;
        propertyId = propertyId ?? row.property_id;
        const lines = await tx<Line[]>`select kind, description, amount_cents from public.quote_lines where option_id = ${row.option_id} and tenant_id = ${tenantId} order by position`;
        prices = agreementFromOption(lines);
      }
    }
    const accounts = await tx<Account[]>`select id, name from public.accounts where tenant_id = ${tenantId} and archived_at is null and status = 'active' order by name`;
    const properties = accountId
      ? await tx<Property[]>`select id, account_id, name, normalized_address, size_sqft, lot_sqft from public.properties where tenant_id = ${tenantId} and account_id = ${accountId} and archived_at is null order by created_at`
      : [];
    if (!propertyId && properties.length === 1) propertyId = properties[0].id;
    const serviceTypes = await tx<ServiceType[]>`select id, name, pricing_method from public.service_types where tenant_id = ${tenantId} and active and archived_at is null order by name`;
    const branches = await tx<Branch[]>`select id, name from public.branches where tenant_id = ${tenantId} and archived_at is null order by name`;
    const items = propertyId
      ? await tx<(PriceBookItemLike & { service_type_name: string })[]>`
          select p.id, p.service_type_id, st.name as service_type_name, p.name, p.add_on, p.size_basis, p.size_min, p.size_max, p.initial_price_cents, p.recurring_price_cents, p.one_time_price_cents
          from public.price_book_items p join public.service_types st on st.id = p.service_type_id
          where p.tenant_id = ${tenantId} and p.active and p.archived_at is null and st.active and st.archived_at is null and not p.add_on
          order by st.name, p.position, p.name, p.size_min`
      : [];
    return { accountId, propertyId, option, prices, accounts, properties, serviceTypes, branches, items };
  });

  const property = data.properties.find((p) => p.id === data.propertyId) ?? null;
  const account = data.accounts.find((a) => a.id === data.accountId) ?? null;
  const offers = property ? priceBookOffers(data.items, { sizeSqft: property.size_sqft, lotSqft: property.lot_sqft }) : [];
  const serviceTypeNames = new Map(data.items.map((i) => [i.service_type_id, i.service_type_name]));
  const today = todayInZone(active.tenantTimezone);

  return (
    <>
      <div>
        <p className="text-sm text-stone-500">
          <Link href="/agreements" className="hover:underline">
            Agreements
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">New agreement</h1>
        {data.option ? (
          <p className="text-sm text-stone-600">
            From quote option &quot;{data.option.option_name}&quot;.{" "}
            {data.prices ? `Initial ${formatCents(data.prices.initialPriceCents)}, recurring ${formatCents(data.prices.recurringPriceCents)}.` : ""}
            {data.prices?.oneTime.length ? ` One-time work to book separately: ${data.prices.oneTime.map((l) => l.description).join(", ")}.` : ""}
            {!data.option.account_id ? " Convert the lead to an account first; a quote on a lead has no account to sign." : ""}
          </p>
        ) : null}
      </div>
      {params.error ? <Notice kind="error">{errorMessage(params.error)}</Notice> : null}

      <Card title="Who and where" description="An account pays; a property is where the work happens.">
        <form method="get" className="flex flex-wrap items-end gap-3">
          {params.quote_option ? <input type="hidden" name="quote_option" value={params.quote_option} /> : null}
          <Field label="Account" htmlFor="account_id">
            <Select id="account_id" name="account_id" defaultValue={data.accountId ?? ""} required>
              <option value="" disabled>
                Pick an account
              </option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          {data.accountId ? (
            <Field label="Property" htmlFor="property_id">
              <Select id="property_id" name="property_id" defaultValue={data.propertyId ?? ""}>
                <option value="">Pick a property</option>
                {data.properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name ? `${p.name}: ` : ""}
                    {p.normalized_address}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Button type="submit" variant="secondary">
            Continue
          </Button>
        </form>
      </Card>

      {account && property ? (
        <Card title={`Plan for ${account.name} at ${property.normalized_address}`} description="Pick the service and prices, then save the draft. Its page shows every visit and the billing schedule before the customer signs.">
          <form action={createAgreement} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="tenant_id" value={tenantId} />
            <input type="hidden" name="account_id" value={account.id} />
            <input type="hidden" name="property_id" value={property.id} />
            {data.option ? <input type="hidden" name="quote_id" value={data.option.quote_id} /> : null}
            {data.option ? <input type="hidden" name="quote_option_id" value={data.option.option_id} /> : null}
            <Field label="Service type" htmlFor="service_type_id">
              <Select id="service_type_id" name="service_type_id" required defaultValue="">
                <option value="" disabled>
                  Pick a service type
                </option>
                {data.serviceTypes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Branch" htmlFor="branch_id">
              <Select id="branch_id" name="branch_id" defaultValue={data.branches[0]?.id ?? ""}>
                {data.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            {offers.length ? (
              <div className="rounded border border-stone-200 bg-stone-50 p-3 text-sm sm:col-span-2">
                <p className="font-medium text-stone-800">Price book for this property{property.size_sqft ? ` (${property.size_sqft.toLocaleString("en-US")} sq ft` : ""}{property.lot_sqft ? `${property.size_sqft ? ", " : " ("}${property.lot_sqft.toLocaleString("en-US")} lot sq ft` : ""}{property.size_sqft || property.lot_sqft ? ")" : ""}</p>
                <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                  {offers.map((o) => {
                    const matched = o.pick.status === "match" ? o.pick.item : null;
                    return (
                      <li key={`${o.serviceTypeId}-${o.name}`}>
                        <span className="text-stone-700">
                          {serviceTypeNames.get(o.serviceTypeId)}: {o.name}
                        </span>{" "}
                        {matched ? (
                          <span className="tabular-nums">
                            {offeredColumns(matched)
                              .map((c) => `${c.replace("_", "-")} ${formatCents(priceFor(matched, c))}`)
                              .join(", ")}
                          </span>
                        ) : o.pick.status === "needs_measurement" ? (
                          <span className="text-stone-500">needs the {o.pick.basis === "size_sqft" ? "home" : "lot"} size on the property</span>
                        ) : (
                          <span className="text-stone-500">no band fits</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            <AgreementFields
              prefix="new"
              values={{
                starts_on: startOfMonth(today) < today ? today : today,
                initial_price_cents: data.prices?.initialPriceCents,
                recurring_price_cents: data.prices?.recurringPriceCents,
                window_days: 7,
              }}
            />
            <div className="sm:col-span-2">
              <Button type="submit">Save draft</Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
