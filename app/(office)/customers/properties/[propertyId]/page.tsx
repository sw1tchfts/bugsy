import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContactForm } from "@/components/customers/contact-form";
import { AddressFields, PropertyTypeSelect } from "@/components/customers/fields";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Table, Textarea, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { archiveContact, createUnit, moveProperty, retryGeocode, updateProperty } from "../../actions";

export const metadata: Metadata = { title: "Property" };

type Property = {
  id: string; account_id: string; account_name: string; name: string | null; line1: string; line2: string | null; city: string; state_code: string; postal_code: string;
  normalized_address: string; county: string | null; lat: number | null; lng: number | null; geocode_status: string; property_type: string; size_sqft: number | null;
  lot_sqft: number | null; measured_by: string | null; unit_count: number | null; access_notes: string | null; archived_at: string | null;
};
type Unit = { id: string; label: string; floor: string | null; notes: string | null; residents: number };
type Contact = { id: string; name: string; role: string; email: string | null; phone: string | null; unit_label: string | null; e_notice_consent_at: string | null };
type AccountOption = { id: string; name: string };

export default async function PropertyPage({ params, searchParams }: { params: Promise<{ propertyId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { propertyId } = await params;
  const { error } = await searchParams;
  const { session, active } = await requireActiveTenant();
  const tenantId = active.tenantId;
  const canWrite = can(active.permissions, "customers.write");

  const data = await dbAs(session, async (tx) => {
    const [property] = await tx<Property[]>`
      select p.*, a.name as account_name from public.properties p join public.accounts a on a.id = p.account_id
      where p.id = ${propertyId} and p.tenant_id = ${tenantId}`;
    if (!property) return null;
    const units = await tx<Unit[]>`
      select u.id, u.label, u.floor, u.notes, (select count(*)::int from public.contacts c where c.unit_id = u.id and c.archived_at is null) as residents
      from public.units u where u.property_id = ${propertyId} and u.archived_at is null order by u.label`;
    const contacts = await tx<Contact[]>`
      select c.id, c.name, c.role, c.email, c.phone, u.label as unit_label, c.e_notice_consent_at
      from public.contacts c left join public.units u on u.id = c.unit_id
      where c.property_id = ${propertyId} and c.archived_at is null order by u.label nulls first, c.name`;
    const accounts = await tx<AccountOption[]>`select id, name from public.accounts where tenant_id = ${tenantId} and archived_at is null order by name limit 500`;
    return { property, units, contacts, accounts };
  });
  if (!data) notFound();
  const { property, units, contacts, accounts } = data;
  const here = `/customers/properties/${propertyId}`;
  const pinTone = property.geocode_status === "ok" || property.geocode_status === "manual" ? "good" : property.geocode_status === "failed" ? "bad" : "warn";

  return (
    <>
      <div>
        <p className="text-sm text-stone-500">
          <Link href="/customers" className="hover:underline">
            Customers
          </Link>{" "}
          /{" "}
          <Link href={`/customers/${property.account_id}`} className="hover:underline">
            {property.account_name}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">{property.name ?? "Property"}</h1>
        <p className="text-sm text-stone-600">
          {property.normalized_address}
          {property.county ? `, ${property.county} County` : ""} <Badge tone={pinTone}>pin: {property.geocode_status}</Badge>
          {property.lat != null ? ` ${property.lat.toFixed(4)}, ${property.lng?.toFixed(4)}` : ""}
        </p>
        <p className="text-sm">
          <Link href={`/sites/${property.id}`} className="text-emerald-800 underline" data-testid="site-link">
            Device program and audit binder
          </Link>
        </p>
      </div>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}
      {property.geocode_status === "failed" && canWrite ? (
        <form action={retryGeocode}>
          <input type="hidden" name="tenant_id" value={tenantId} />
          <input type="hidden" name="property_id" value={propertyId} />
          <Notice kind="error">
            The address could not be validated.{" "}
            <Button type="submit" variant="secondary">
              Try again
            </Button>
          </Notice>
        </form>
      ) : null}

      <Card title="Units" description="For buildings served unit by unit. Residents attach to a unit so notices reach the right door.">
        {units.length === 0 ? (
          <Empty>No units.</Empty>
        ) : (
          <Table headers={["Unit", "Floor", "Residents", "Notes"]}>
            {units.map((u) => (
              <tr key={u.id}>
                <td className="py-2 pr-4 font-medium">{u.label}</td>
                <td className="py-2 pr-4">{u.floor ?? ""}</td>
                <td className="py-2 pr-4 tabular-nums">{u.residents}</td>
                <td className="py-2 pr-4 text-stone-600">{u.notes ?? ""}</td>
              </tr>
            ))}
          </Table>
        )}
        {canWrite ? (
          <form action={createUnit} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="tenant_id" value={tenantId} />
            <input type="hidden" name="property_id" value={propertyId} />
            <Field label="Unit label" htmlFor="unit-label">
              <Input id="unit-label" name="label" required maxLength={20} />
            </Field>
            <Field label="Floor" htmlFor="unit-floor">
              <Input id="unit-floor" name="floor" maxLength={10} />
            </Field>
            <Button type="submit" variant="secondary">
              Add unit
            </Button>
          </form>
        ) : null}
      </Card>

      <Card title="People at this property" description="Residents and site contacts. Pesticide notices go to them, which is not always the account.">
        {contacts.length === 0 ? (
          <Empty>No contacts at this property.</Empty>
        ) : (
          <Table headers={["Name", "Role", "Unit", "Phone", "Email", "Notices", ""]}>
            {contacts.map((c) => (
              <tr key={c.id}>
                <td className="py-2 pr-4 font-medium">{c.name}</td>
                <td className="py-2 pr-4">{c.role.replace("_", " ")}</td>
                <td className="py-2 pr-4">{c.unit_label ?? ""}</td>
                <td className="py-2 pr-4">{c.phone ?? ""}</td>
                <td className="py-2 pr-4">{c.email ?? ""}</td>
                <td className="py-2 pr-4">{c.e_notice_consent_at ? <Badge tone="good">electronic ok</Badge> : <Badge>paper</Badge>}</td>
                <td className="py-2 text-right">
                  {canWrite ? (
                    <form action={archiveContact}>
                      <input type="hidden" name="tenant_id" value={tenantId} />
                      <input type="hidden" name="contact_id" value={c.id} />
                      <input type="hidden" name="return_to" value={here} />
                      <Button type="submit" variant="danger">
                        Remove
                      </Button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
        {canWrite ? (
          <details className="mt-2">
            <summary className="cursor-pointer text-sm font-medium">Add a contact here</summary>
            <div className="mt-3">
              <ContactForm tenantId={tenantId} propertyId={propertyId} units={units} returnTo={here} />
            </div>
          </details>
        ) : null}
      </Card>

      {canWrite ? (
        <>
          <Card title="Property details" description="Saving re-validates the address.">
            <form action={updateProperty} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="tenant_id" value={tenantId} />
              <input type="hidden" name="property_id" value={propertyId} />
              <Field label="Property name" htmlFor="name">
                <Input id="name" name="name" defaultValue={property.name ?? ""} />
              </Field>
              <PropertyTypeSelect value={property.property_type} />
              <AddressFields values={{ line1: property.line1, line2: property.line2 ?? "", city: property.city, state_code: property.state_code, postal_code: property.postal_code }} />
              <Field label="Size (sq ft)" htmlFor="size_sqft">
                <Input id="size_sqft" name="size_sqft" type="number" min={1} defaultValue={property.size_sqft ?? ""} />
              </Field>
              <Field label="Lot (sq ft)" htmlFor="lot_sqft">
                <Input id="lot_sqft" name="lot_sqft" type="number" min={1} defaultValue={property.lot_sqft ?? ""} />
              </Field>
              <Field label="Measured by" htmlFor="measured_by">
                <Select id="measured_by" name="measured_by" defaultValue={property.measured_by ?? "manual"}>
                  <option value="manual">Entered by hand</option>
                  <option value="imagery">From imagery</option>
                </Select>
              </Field>
              <Field label="Units (count)" htmlFor="unit_count">
                <Input id="unit_count" name="unit_count" type="number" min={0} defaultValue={property.unit_count ?? ""} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Access notes" htmlFor="access_notes">
                  <Textarea id="access_notes" name="access_notes" defaultValue={property.access_notes ?? ""} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Button type="submit">Save property</Button>
              </div>
            </form>
          </Card>

          <Card title="Move to another account" description="When a property changes hands. History stays with the property.">
            <form action={moveProperty} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="tenant_id" value={tenantId} />
              <input type="hidden" name="property_id" value={propertyId} />
              <Field label="New account" htmlFor="move-account">
                <Select id="move-account" name="account_id" defaultValue={property.account_id}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" variant="secondary">
                Move property
              </Button>
            </form>
          </Card>
        </>
      ) : null}
    </>
  );
}
