import type { Metadata } from "next";
import { ProductFields } from "@/components/catalog/product-fields";
import { PlatformShell } from "@/components/platform-shell";
import { Badge, Button, Card, Empty, Notice, Table, errorMessage } from "@/components/ui";
import { dbAs, requirePlatformAdmin } from "@/lib/auth/session";
import { approveProduct, archiveProduct, createMasterProduct, updateMasterProduct } from "./actions";

export const metadata: Metadata = { title: "Product master" };

type Product = {
  id: string;
  tenant_id: string | null;
  tenant_name: string | null;
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
  archived_at: string | null;
  enabled_by: number;
};

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await requirePlatformAdmin();
  const { error } = await searchParams;

  const products = await dbAs(session, (tx) =>
    tx<Product[]>`
      select p.id, p.tenant_id, t.name as tenant_name, p.name, p.manufacturer, p.epa_reg_no, p.active_ingredients, p.signal_word, p.restricted_use,
             p.rei_hours, p.formulation, p.label_url, p.sds_url, p.label_rates, p.upc, p.verified_at, p.archived_at,
             app.product_enabled_by(p.id) as enabled_by
      from public.products p left join public.tenants t on t.id = p.tenant_id
      order by (p.tenant_id is not null) desc, p.archived_at nulls first, p.name`,
  );
  const pending = products.filter((p) => p.tenant_id && !p.archived_at);
  const master = products.filter((p) => !p.tenant_id);

  return (
    <PlatformShell email={session.email}>
      <h1 className="text-2xl font-semibold">Product master</h1>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      <Card title="Awaiting approval" description="Products a company added from a label. Approving moves the row into the master list for every company; its id does not change, so records already written keep pointing at it.">
        {pending.length === 0 ? (
          <Empty>Nothing waiting.</Empty>
        ) : (
          <Table headers={["Product", "EPA reg. no.", "Added by", "Active ingredients", ""]}>
            {pending.map((p) => (
              <tr key={p.id}>
                <td className="py-2 pr-4 font-medium">
                  {p.name} {p.manufacturer ? <span className="font-normal text-stone-500">{p.manufacturer}</span> : null}{" "}
                  {p.restricted_use ? <Badge tone="bad">restricted use</Badge> : null}
                </td>
                <td className="py-2 pr-4 font-mono text-xs">{p.epa_reg_no}</td>
                <td className="py-2 pr-4">{p.tenant_name}</td>
                <td className="py-2 pr-4 text-xs">{p.active_ingredients.join(", ")}</td>
                <td className="py-2 text-right">
                  <form action={approveProduct} className="flex justify-end gap-2">
                    <input type="hidden" name="product_id" value={p.id} />
                    <Button type="submit">Approve into master list</Button>
                  </form>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Master list" description="Shared with every company. Label rates feed the technician app's label checks.">
        {master.length === 0 ? (
          <Empty>No products yet.</Empty>
        ) : (
          <div className="grid gap-6">
            {master.map((p) => (
              <form key={p.id} action={updateMasterProduct} className={`grid gap-4 border-b border-stone-200 pb-6 last:border-0 last:pb-0 sm:grid-cols-2 ${p.archived_at ? "opacity-60" : ""}`}>
                <input type="hidden" name="product_id" value={p.id} />
                <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                  <span className="font-medium">{p.name}</span>
                  <span className="font-mono text-xs text-stone-500">{p.epa_reg_no}</span>
                  {p.archived_at ? <Badge>archived</Badge> : <Badge tone="good">verified</Badge>}
                  {p.restricted_use ? <Badge tone="bad">restricted use</Badge> : null}
                  <span className="text-xs text-stone-500">enabled by {p.enabled_by} compan{p.enabled_by === 1 ? "y" : "ies"}</span>
                </div>
                <ProductFields prefix={`m-${p.id}`} values={p} withLabelRates />
                <div className="flex gap-3 sm:col-span-2">
                  <Button type="submit" variant="secondary">
                    Save
                  </Button>
                  <input type="hidden" name="archive" value={p.archived_at ? "false" : "true"} />
                  <Button type="submit" variant="danger" formAction={archiveProduct}>
                    {p.archived_at ? "Restore" : "Archive"}
                  </Button>
                </div>
              </form>
            ))}
          </div>
        )}
      </Card>

      <Card title="Add a master product" description="Enter it from the label. Master rows are verified on creation.">
        <form action={createMasterProduct} className="grid gap-4 sm:grid-cols-2">
          <ProductFields prefix="new" withLabelRates />
          <div>
            <Button type="submit">Add to master list</Button>
          </div>
        </form>
      </Card>
    </PlatformShell>
  );
}
