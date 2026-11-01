import type { Metadata } from "next";
import { DEVICE_KINDS, KIND_LABELS } from "@/lib/commercial/devices";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Table, Textarea, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { bandLabel } from "@/lib/catalog/pricing";
import {
  JOB_KINDS,
  JOB_KIND_LABELS,
  type JobKind,
  PRICING_METHODS,
  PRICING_METHOD_LABELS,
  type PricingMethod,
  SERVICE_LINES,
  SERVICE_LINE_LABELS,
  type ServiceLine,
  TREATMENT_AREAS,
  TREATMENT_AREA_LABELS,
} from "@/lib/catalog/service-lines";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import {
  archivePriceBookItem,
  archiveServiceType,
  confirmStateRule,
  createPriceBookItem,
  refreshStateRules,
  updatePriceBookItem,
  updateServiceType,
  updateStateRule,
} from "../actions";

export const metadata: Metadata = { title: "Service type" };

type ServiceType = {
  id: string;
  name: string;
  description: string | null;
  service_line: ServiceLine;
  job_kind: JobKind;
  treatment_areas: string[];
  device_kinds: string[];
  pricing_method: PricingMethod;
  default_duration_minutes: number;
  active: boolean;
  archived_at: string | null;
};

type StateRule = {
  id: string;
  state_code: string;
  required_cert_categories: string[];
  pack_cert_categories: string[];
  tax_class: "taxable" | "exempt" | "unknown";
  pack_tax_class: "taxable" | "exempt" | "unknown";
  pack_version: string | null;
  notes: string | null;
  confirmed_at: string | null;
};

type Item = {
  id: string;
  name: string;
  add_on: boolean;
  size_basis: "none" | "size_sqft" | "lot_sqft";
  size_min: number;
  size_max: number | null;
  initial_price_cents: string;
  recurring_price_cents: string;
  one_time_price_cents: string;
  position: number;
  active: boolean;
  archived_at: string | null;
};

const TAX_LABELS = { taxable: "Taxable", exempt: "Exempt", unknown: "Unknown" } as const;

function dollars(cents: string | number): string {
  return (Number(cents) / 100).toFixed(2);
}

export default async function ServiceTypePage({ params, searchParams }: { params: Promise<{ serviceTypeId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  const { serviceTypeId } = await params;
  const { error } = await searchParams;
  const tenantId = active.tenantId;
  const canWrite = can(active.permissions, "catalog.write");
  const canConfirm = can(active.permissions, "compliance.write");

  const [serviceType, rules, items] = await dbAs(session, async (tx) => {
    const [st] = await tx<ServiceType[]>`
      select id, name, description, service_line, job_kind, treatment_areas, device_kinds, pricing_method, default_duration_minutes, active, archived_at
      from public.service_types where id = ${serviceTypeId} and tenant_id = ${tenantId}`;
    if (!st) return [null, [], []] as const;
    const rules = await tx<StateRule[]>`
      select id, state_code, required_cert_categories, pack_cert_categories, tax_class, pack_tax_class, pack_version, notes, confirmed_at
      from public.service_type_state_rules where service_type_id = ${serviceTypeId} and tenant_id = ${tenantId} order by state_code`;
    const items = await tx<Item[]>`
      select id, name, add_on, size_basis, size_min, size_max, initial_price_cents, recurring_price_cents, one_time_price_cents, position, active, archived_at
      from public.price_book_items where service_type_id = ${serviceTypeId} and tenant_id = ${tenantId}
      order by archived_at nulls first, position, name, size_min`;
    return [st, rules, items] as const;
  });
  if (!serviceType) notFound();

  const hidden = (
    <>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="service_type_id" value={serviceType.id} />
    </>
  );

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-stone-500">
            <Link href="/catalog/service-types" className="hover:underline">
              Service types
            </Link>
          </p>
          <h1 className="text-2xl font-semibold">
            {serviceType.name} {serviceType.archived_at ? <Badge>archived</Badge> : null}
          </h1>
          <p className="text-sm text-stone-600">
            {SERVICE_LINE_LABELS[serviceType.service_line]}, {JOB_KIND_LABELS[serviceType.job_kind].toLowerCase()},{" "}
            {serviceType.treatment_areas.length ? serviceType.treatment_areas.join(" and ") : "no treatment areas"}, {PRICING_METHOD_LABELS[serviceType.pricing_method].toLowerCase()},{" "}
            {serviceType.default_duration_minutes} minutes.
          </p>
        </div>
      </div>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      <Card
        title="State rules"
        description="One row per state you work in. Defaults come from the state's rule pack; where no pack is researched yet the answer is unknown and the conservative rule applies. You can add certification categories and set the tax class, never remove what the pack requires."
        actions={
          canWrite ? (
            <form action={refreshStateRules} className="flex items-end gap-2">
              {hidden}
              <Input name="state_code" placeholder="Add state (OH)" aria-label="Add a state" maxLength={2} pattern="[A-Za-z]{2}" className="w-32" />
              <Button type="submit" variant="secondary">
                Refresh state rules
              </Button>
            </form>
          ) : undefined
        }
      >
        {rules.length === 0 ? (
          <Empty>No states yet. Add a branch or a property, or add a state here.</Empty>
        ) : (
          <Table headers={["State", "Rule pack", "Required certification categories", "Tax class", "Notes", ""]}>
            {rules.map((r) => (
              <tr key={r.id}>
                <td className="py-2 pr-4 font-medium">{r.state_code}</td>
                <td className="py-2 pr-4">
                  {r.pack_version ? (
                    <span>
                      <Badge tone="good">pack {r.pack_version}</Badge> {r.pack_cert_categories.length ? `requires ${r.pack_cert_categories.join(", ")}` : "no categories listed"}; tax {TAX_LABELS[r.pack_tax_class].toLowerCase()}
                    </span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone="warn">no rule pack for {r.state_code} yet</Badge>
                      {r.confirmed_at ? <Badge tone="good">confirmed by a licensed manager</Badge> : <Badge tone="bad">unconfirmed: dispatch blocked</Badge>}
                      {canConfirm ? (
                        <form action={confirmStateRule}>
                          {hidden}
                          <input type="hidden" name="rule_id" value={r.id} />
                          <input type="hidden" name="confirm" value={r.confirmed_at ? "false" : "true"} />
                          <Button type="submit" variant="secondary">
                            {r.confirmed_at ? "Withdraw confirmation" : "Confirm rules"}
                          </Button>
                        </form>
                      ) : null}
                    </span>
                  )}
                </td>
                {canWrite ? (
                  <td className="py-2 pr-4" colSpan={4}>
                    <form action={updateStateRule} className="flex flex-wrap items-center gap-2">
                      {hidden}
                      <input type="hidden" name="rule_id" value={r.id} />
                      <Input name="required_cert_categories" defaultValue={r.required_cert_categories.join(", ")} placeholder="Categories, comma separated" aria-label={`Categories for ${r.state_code}`} className="w-56" />
                      <Select name="tax_class" defaultValue={r.tax_class} aria-label={`Tax class for ${r.state_code}`}>
                        {(["taxable", "exempt", "unknown"] as const).map((t) => (
                          <option key={t} value={t}>
                            {TAX_LABELS[t]}
                          </option>
                        ))}
                      </Select>
                      <Input name="notes" defaultValue={r.notes ?? ""} placeholder="Notes or source" aria-label={`Notes for ${r.state_code}`} className="w-56" />
                      <Button type="submit" variant="secondary">
                        Save
                      </Button>
                    </form>
                  </td>
                ) : (
                  <>
                    <td className="py-2 pr-4">{r.required_cert_categories.join(", ") || "none"}</td>
                    <td className="py-2 pr-4">{TAX_LABELS[r.tax_class]}</td>
                    <td className="py-2 pr-4">{r.notes ?? ""}</td>
                    <td />
                  </>
                )}
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card
        title="Price book"
        description={
          serviceType.pricing_method === "bid"
            ? "This work is bid from labor and materials after an inspection; price book items here are optional starting points."
            : "Bands by home or lot size, add-ons, and one-time prices. A band runs from its minimum up to, not including, its maximum; bands never overlap."
        }
      >
        {items.length === 0 ? (
          <Empty>No price book items yet.</Empty>
        ) : (
          <Table headers={["Item", "Band", "Initial", "Recurring", "One-time", "Order", ""]}>
            {items.map((item) =>
              canWrite && !item.archived_at ? (
                <tr key={item.id}>
                  <td className="py-2 pr-4" colSpan={7}>
                    <form action={updatePriceBookItem} className="flex flex-wrap items-end gap-2">
                      {hidden}
                      <input type="hidden" name="item_id" value={item.id} />
                      <Field label="Item" htmlFor={`name-${item.id}`}>
                        <Input id={`name-${item.id}`} name="name" defaultValue={item.name} required className="w-44" />
                      </Field>
                      <label className="flex items-center gap-2 pb-2 text-sm">
                        <input type="checkbox" name="add_on" value="true" defaultChecked={item.add_on} /> Add-on
                      </label>
                      <Field label="Sized by" htmlFor={`basis-${item.id}`}>
                        <Select id={`basis-${item.id}`} name="size_basis" defaultValue={item.size_basis}>
                          <option value="none">Any size</option>
                          <option value="size_sqft">Home sq ft</option>
                          <option value="lot_sqft">Lot sq ft</option>
                        </Select>
                      </Field>
                      <Field label="From" htmlFor={`min-${item.id}`}>
                        <Input id={`min-${item.id}`} name="size_min" type="number" min={0} defaultValue={item.size_min} className="w-24" />
                      </Field>
                      <Field label="Up to" htmlFor={`max-${item.id}`}>
                        <Input id={`max-${item.id}`} name="size_max" type="number" min={1} defaultValue={item.size_max ?? ""} className="w-24" />
                      </Field>
                      <Field label="Initial ($)" htmlFor={`initial-${item.id}`}>
                        <Input id={`initial-${item.id}`} name="initial_price" inputMode="decimal" defaultValue={dollars(item.initial_price_cents)} className="w-24" />
                      </Field>
                      <Field label="Recurring ($)" htmlFor={`recurring-${item.id}`}>
                        <Input id={`recurring-${item.id}`} name="recurring_price" inputMode="decimal" defaultValue={dollars(item.recurring_price_cents)} className="w-24" />
                      </Field>
                      <Field label="One-time ($)" htmlFor={`once-${item.id}`}>
                        <Input id={`once-${item.id}`} name="one_time_price" inputMode="decimal" defaultValue={dollars(item.one_time_price_cents)} className="w-24" />
                      </Field>
                      <Field label="Order" htmlFor={`pos-${item.id}`}>
                        <Input id={`pos-${item.id}`} name="position" type="number" min={1} defaultValue={item.position} className="w-16" />
                      </Field>
                      <Button type="submit" variant="secondary">
                        Save
                      </Button>
                      <Button type="submit" variant="danger" formAction={archivePriceBookItem}>
                        Archive
                      </Button>
                      <input type="hidden" name="archive" value="true" />
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={item.id} className={item.archived_at ? "text-stone-400" : ""}>
                  <td className="py-2 pr-4 font-medium">
                    {item.name} {item.add_on ? <Badge>add-on</Badge> : null} {item.archived_at ? <Badge>archived</Badge> : null}
                  </td>
                  <td className="py-2 pr-4">{bandLabel(item)}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatCents(Number(item.initial_price_cents))}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatCents(Number(item.recurring_price_cents))}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatCents(Number(item.one_time_price_cents))}</td>
                  <td className="py-2 pr-4 tabular-nums">{item.position}</td>
                  <td className="py-2 text-right">
                    {canWrite && item.archived_at ? (
                      <form action={archivePriceBookItem}>
                        {hidden}
                        <input type="hidden" name="item_id" value={item.id} />
                        <input type="hidden" name="archive" value="false" />
                        <Button type="submit" variant="secondary">
                          Restore
                        </Button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ),
            )}
          </Table>
        )}

        {canWrite && !serviceType.archived_at ? (
          <form action={createPriceBookItem} className="mt-4 flex flex-wrap items-end gap-2 border-t border-stone-200 pt-4">
            {hidden}
            <Field label="New item" htmlFor="new-name">
              <Input id="new-name" name="name" required maxLength={80} className="w-44" placeholder="Quarterly plan" />
            </Field>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" name="add_on" value="true" /> Add-on
            </label>
            <Field label="Sized by" htmlFor="new-basis">
              <Select id="new-basis" name="size_basis" defaultValue="none">
                <option value="none">Any size</option>
                <option value="size_sqft">Home sq ft</option>
                <option value="lot_sqft">Lot sq ft</option>
              </Select>
            </Field>
            <Field label="From" htmlFor="new-min">
              <Input id="new-min" name="size_min" type="number" min={0} defaultValue={0} className="w-24" />
            </Field>
            <Field label="Up to" htmlFor="new-max">
              <Input id="new-max" name="size_max" type="number" min={1} className="w-24" placeholder="open" />
            </Field>
            <Field label="Initial ($)" htmlFor="new-initial">
              <Input id="new-initial" name="initial_price" inputMode="decimal" className="w-24" />
            </Field>
            <Field label="Recurring ($)" htmlFor="new-recurring">
              <Input id="new-recurring" name="recurring_price" inputMode="decimal" className="w-24" />
            </Field>
            <Field label="One-time ($)" htmlFor="new-once">
              <Input id="new-once" name="one_time_price" inputMode="decimal" className="w-24" />
            </Field>
            <Field label="Order" htmlFor="new-pos">
              <Input id="new-pos" name="position" type="number" min={1} defaultValue={items.length + 1} className="w-16" />
            </Field>
            <Button type="submit">Add item</Button>
          </form>
        ) : null}
      </Card>

      {canWrite ? (
        <Card title="Details">
          <form action={updateServiceType} className="grid gap-4 sm:grid-cols-2">
            {hidden}
            <input type="hidden" name="areas_present" value="true" />
            <Field label="Name" htmlFor="name">
              <Input id="name" name="name" required maxLength={80} defaultValue={serviceType.name} />
            </Field>
            <Field label="Service line" htmlFor="service_line">
              <Select id="service_line" name="service_line" defaultValue={serviceType.service_line}>
                {SERVICE_LINES.map((l) => (
                  <option key={l} value={l}>
                    {SERVICE_LINE_LABELS[l]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Job kind" htmlFor="job_kind">
              <Select id="job_kind" name="job_kind" defaultValue={serviceType.job_kind}>
                {JOB_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {JOB_KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Pricing method" htmlFor="pricing_method">
              <Select id="pricing_method" name="pricing_method" defaultValue={serviceType.pricing_method}>
                {PRICING_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PRICING_METHOD_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-medium text-stone-700">Treatment areas</legend>
              <div className="mt-1 flex flex-wrap gap-4 text-sm">
                {TREATMENT_AREAS.map((a) => (
                  <label key={a} className="flex items-center gap-2">
                    <input type="checkbox" name="treatment_areas" value={a} defaultChecked={serviceType.treatment_areas.includes(a)} /> {TREATMENT_AREA_LABELS[a]}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-medium text-stone-700">Devices checked at every visit (commercial programs)</legend>
              <input type="hidden" name="kinds_present" value="1" />
              <div className="mt-1 flex flex-wrap gap-4 text-sm">
                {DEVICE_KINDS.map((k) => (
                  <label key={k} className="flex items-center gap-2">
                    <input type="checkbox" name="device_kinds" value={k} defaultChecked={serviceType.device_kinds.includes(k)} /> {KIND_LABELS[k]}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Default duration (minutes)" htmlFor="default_duration_minutes">
              <Input id="default_duration_minutes" name="default_duration_minutes" type="number" min={5} max={1440} defaultValue={serviceType.default_duration_minutes} />
            </Field>
            <Field label="Active" htmlFor="active" hint="Inactive types stay on existing quotes but leave the pickers.">
              <Select id="active" name="active" defaultValue={serviceType.active ? "true" : "false"}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description" htmlFor="description">
                <Textarea id="description" name="description" rows={2} defaultValue={serviceType.description ?? ""} />
              </Field>
            </div>
            <div className="flex gap-3 sm:col-span-2">
              <input type="hidden" name="archive" value={serviceType.archived_at ? "false" : "true"} />
              <Button type="submit">Save service type</Button>
              <Button type="submit" variant="danger" formAction={archiveServiceType}>
                {serviceType.archived_at ? "Restore service type" : "Archive service type"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
