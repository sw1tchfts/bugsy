import type { Metadata } from "next";
import { LabelReader } from "@/components/catalog/label-reader";
import { ProductFields } from "@/components/catalog/product-fields";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Table, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { PRODUCT_UNITS, UNIT_LABELS } from "@/lib/catalog/product-form";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { archiveOwnProduct, createTenantProduct, setTenantProduct, updateOwnProduct } from "./actions";

export const metadata: Metadata = { title: "Products" };

type Row = {
  id: string;
  tenant_id: string | null;
  name: string;
  manufacturer: string | null;
  epa_reg_no: string;
  active_ingredients: string[];
  signal_word: string;
  restricted_use: boolean;
  rei_hours: string | null;
  formulation: string | null;
  label_url: string | null;
  sds_url: string | null;
  label_rates: unknown;
  upc: string | null;
  verified_at: string | null;
  enabled: boolean | null;
  unit: string | null;
  unit_cost_cents: string | null;
};

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  const { error } = await searchParams;
  const tenantId = active.tenantId;
  const canWrite = can(active.permissions, "catalog.write");

  const rows = await dbAs(session, (tx) =>
    tx<Row[]>`
      select p.id, p.tenant_id, p.name, p.manufacturer, p.epa_reg_no, p.active_ingredients, p.signal_word, p.restricted_use, p.rei_hours,
             p.formulation, p.label_url, p.sds_url, p.label_rates, p.upc, p.verified_at,
             tp.enabled, tp.unit, tp.unit_cost_cents
      from public.products p
      left join public.tenant_products tp on tp.product_id = p.id and tp.tenant_id = ${tenantId}
      where p.archived_at is null and (p.tenant_id is null or p.tenant_id = ${tenantId})
      order by (tp.enabled is true) desc, p.name`,
  );
  const own = rows.filter((r) => r.tenant_id === tenantId);
  const enabledCount = rows.filter((r) => r.enabled).length;

  const unitSelect = (name: string, value: string | null, label: string) => (
    <Select name={name} defaultValue={value ?? "fl_oz"} aria-label={label}>
      {PRODUCT_UNITS.map((u) => (
        <option key={u} value={u}>
          {UNIT_LABELS[u]}
        </option>
      ))}
    </Select>
  );

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Products</h1>
        <p className="mt-1 text-sm text-stone-600">
          One shared master list with each product&apos;s EPA registration number, label and safety data sheet. Switch on what you carry and set what you pay per unit. {enabledCount} enabled.
        </p>
      </div>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      <Card title="All products" description="Restricted-use products can only be applied by licensed, certified applicators. Unverified products are ones your company added that the platform has not approved yet.">
        {rows.length === 0 ? (
          <Empty>No products yet.</Empty>
        ) : (
          <Table headers={["Product", "EPA reg. no.", "Active ingredients", "Label", "Enabled", "Unit", "Unit cost", ""]}>
            {rows.map((r) => (
              <tr key={r.id} className={r.enabled ? "" : "text-stone-500"}>
                <td className="py-2 pr-4">
                  <span className="font-medium text-stone-900">{r.name}</span>
                  {r.manufacturer ? <span className="text-stone-500"> {r.manufacturer}</span> : null}
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    <Badge tone={r.signal_word === "danger" ? "bad" : r.signal_word === "warning" ? "warn" : "neutral"}>{r.signal_word}</Badge>
                    {r.restricted_use ? <Badge tone="bad">restricted use</Badge> : null}
                    {r.rei_hours ? <Badge tone="warn">REI {Number(r.rei_hours)} h</Badge> : null}
                    {r.tenant_id ? <Badge tone="warn">unverified</Badge> : null}
                  </div>
                </td>
                <td className="py-2 pr-4 font-mono text-xs">{r.epa_reg_no}</td>
                <td className="py-2 pr-4 text-xs">{r.active_ingredients.join(", ")}</td>
                <td className="py-2 pr-4 text-xs">
                  {r.label_url ? (
                    <a href={r.label_url} className="text-emerald-800 underline" target="_blank" rel="noreferrer">
                      label
                    </a>
                  ) : null}{" "}
                  {r.sds_url ? (
                    <a href={r.sds_url} className="text-emerald-800 underline" target="_blank" rel="noreferrer">
                      SDS
                    </a>
                  ) : null}
                </td>
                {canWrite ? (
                  <td className="py-2 pr-4" colSpan={4}>
                    <form action={setTenantProduct} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="tenant_id" value={tenantId} />
                      <input type="hidden" name="product_id" value={r.id} />
                      <label className="flex items-center gap-1 text-sm">
                        <input type="checkbox" name="enabled" value="true" defaultChecked={r.enabled ?? false} aria-label={`Enable ${r.name}`} /> on
                      </label>
                      {unitSelect("unit", r.unit, `Unit for ${r.name}`)}
                      <Input name="unit_cost" inputMode="decimal" defaultValue={r.unit_cost_cents ? (Number(r.unit_cost_cents) / 100).toFixed(2) : ""} placeholder="0.00" aria-label={`Unit cost for ${r.name}`} className="w-24" />
                      <Button type="submit" variant="secondary">
                        Save
                      </Button>
                    </form>
                  </td>
                ) : (
                  <>
                    <td className="py-2 pr-4">{r.enabled ? "yes" : "no"}</td>
                    <td className="py-2 pr-4">{r.unit ? UNIT_LABELS[r.unit as keyof typeof UNIT_LABELS] : ""}</td>
                    <td className="py-2 pr-4 tabular-nums">{r.unit_cost_cents ? formatCents(r.unit_cost_cents) : ""}</td>
                    <td />
                  </>
                )}
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {canWrite && own.length > 0 ? (
        <Card title="Products your company added" description="Editable until the platform approves them into the master list.">
          <div className="grid gap-6">
            {own.map((p) => (
              <div key={p.id} className="grid gap-3 border-b border-stone-200 pb-6 last:border-0 last:pb-0">
              <LabelReader tenantId={tenantId} productId={p.id} target={`own-${p.id}-rates`} />
              <form action={updateOwnProduct} className="grid gap-4 sm:grid-cols-2">
                <input type="hidden" name="tenant_id" value={tenantId} />
                <input type="hidden" name="product_id" value={p.id} />
                <ProductFields prefix={`own-${p.id}`} values={p} withLabelRates />
                <div className="flex gap-3 sm:col-span-2">
                  <Button type="submit" variant="secondary">
                    Save product
                  </Button>
                  <Button type="submit" variant="danger" formAction={archiveOwnProduct}>
                    Remove
                  </Button>
                </div>
              </form>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {canWrite ? (
        <Card title="Add a product the master list lacks" description="Enter it from the label. It is enabled for your company right away and marked unverified until a platform admin approves it.">
          <div className="mb-4">
            <LabelReader tenantId={tenantId} productId={null} target="new-rates" />
          </div>
          <form action={createTenantProduct} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="tenant_id" value={tenantId} />
            <ProductFields prefix="new" withLabelRates />
            <Field label="Unit you buy it in" htmlFor="new-unit">
              {unitSelect("unit", "fl_oz", "Unit")}
            </Field>
            <Field label="Unit cost ($)" htmlFor="new-cost">
              <Input id="new-cost" name="unit_cost" inputMode="decimal" placeholder="0.00" />
            </Field>
            <div>
              <Button type="submit">Add product</Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
