import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Table, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { formatInstantDate } from "@/lib/dates";
import { listLocations, movementLog, stockLevels, unconvertedUsage } from "@/lib/inventory/db";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { countAction, receiveAction, saveLocation, transferAction } from "./actions";

export const metadata: Metadata = { title: "Inventory" };

const KIND: Record<string, string> = { receipt: "Received", transfer: "Moved", usage: "Used", adjustment: "Count" };

/** Stock by branch and truck (spec 18): levels and low stock, receive, move and count, and every movement. */
export default async function Inventory({ searchParams }: { searchParams: Promise<{ note?: string; error?: string; location?: string }> }) {
  const q = await searchParams;
  const { session, active } = await requireActiveTenant();
  if (!can(active.permissions, "inventory.read")) redirect("/?error=forbidden");
  const write = can(active.permissions, "inventory.write");
  const t = active.tenantId;
  const data = await dbAs(session, async (tx) => {
    const locations = await listLocations(tx, t);
    const levels = await stockLevels(tx, t);
    const products = await tx<{ product_id: string; name: string; unit: string; unit_cost_cents: string }[]>`
      select tp.product_id, p.name, tp.unit, tp.unit_cost_cents from public.tenant_products tp join public.products p on p.id = tp.product_id
      where tp.tenant_id = ${t} and tp.enabled order by p.name`;
    const branches = await tx<{ id: string; name: string }[]>`select id, name from public.branches where tenant_id = ${t} and archived_at is null order by name`;
    const technicians = await tx<{ user_id: string; name: string | null }[]>`
      select m.user_id, m.display_name as name from public.memberships m join public.roles r on r.id = m.role_id where m.tenant_id = ${t} and 'visits.write' = any(r.permissions) order by 2`;
    const moves = await movementLog(tx, t, { location_id: q.location && /^[0-9a-f-]{36}$/i.test(q.location) ? q.location : null, limit: 100 });
    const unconverted = await unconvertedUsage(tx, t);
    return { locations, levels, products, branches, technicians, moves, unconverted };
  });
  const activeLocations = data.locations.filter((l) => l.active);
  const hidden = <input type="hidden" name="tenant_id" value={t} />;
  const productOptions = data.products.map((p) => (
    <option key={p.product_id} value={p.product_id}>
      {p.name} ({p.unit.replace("_", " ")})
    </option>
  ));
  const locationOptions = activeLocations.map((l) => (
    <option key={l.id} value={l.id}>
      {l.name}
    </option>
  ));
  return (
    <>
      <h1 className="text-2xl font-semibold">Inventory</h1>
      {q.note ? <Notice kind="success">{q.note}</Notice> : null}
      {errorMessage(q.error) ? <Notice kind="error">{errorMessage(q.error)}</Notice> : null}
      {data.unconverted.length ? (
        <Notice kind="info">
          {data.unconverted.length} application line(s) could not come off the shelves because their units do not convert into the product&apos;s unit (for example{" "}
          {data.unconverted[0].product_name}, {data.unconverted[0].amount} {data.unconverted[0].amount_unit} against {data.unconverted[0].stock_unit}).
        </Notice>
      ) : null}

      {activeLocations.length === 0 ? <Empty>No locations yet. Add a warehouse for each branch and a truck for each technician.</Empty> : null}
      {activeLocations.map((l) => {
        const rows = data.levels.filter((r) => r.location_id === l.id);
        return (
          <Card key={l.id} title={l.name} description={`${l.kind === "truck" ? `Truck${l.user_name ? ` for ${l.user_name}` : ""}` : "Warehouse"}, ${l.branch_name}`}>
            {rows.length === 0 ? (
              <Empty>Nothing here.</Empty>
            ) : (
              <Table headers={["Product", "On hand", "Cost each", "Value", ""]}>
                {rows.map((r) => (
                  <tr key={r.product_id} data-testid="stock-row">
                    <td className="py-2 pr-4">
                      {r.product_name}
                      {r.epa_reg_no ? <span className="block text-xs text-stone-500">EPA Reg. No. {r.epa_reg_no}</span> : null}
                    </td>
                    <td className="py-2 pr-4 tabular-nums" data-testid="stock-on-hand">
                      {r.on_hand} {r.unit.replace("_", " ")}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{formatCents(r.unit_cost_cents)}</td>
                    <td className="py-2 pr-4 tabular-nums">{formatCents(r.value_cents)}</td>
                    <td className="py-2 pr-4">{r.flag ? <Badge tone={r.flag === "negative" ? "bad" : "warn"}>{r.flag === "negative" ? "used more than loaded" : "low"}</Badge> : null}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        );
      })}

      {write ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Receive">
            <form action={receiveAction} className="grid gap-3" data-testid="receive-form">
              {hidden}
              <Field label="Product" htmlFor="r-product">
                <Select id="r-product" name="product_id" required>
                  {productOptions}
                </Select>
              </Field>
              <Field label="Into" htmlFor="r-location">
                <Select id="r-location" name="location_id" required>
                  {locationOptions}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Quantity" htmlFor="r-qty" hint="In the product's unit.">
                  <Input id="r-qty" name="quantity" inputMode="decimal" required />
                </Field>
                <Field label="Cost per unit" htmlFor="r-cost">
                  <Input id="r-cost" name="unit_cost" inputMode="decimal" required placeholder="64.00" />
                </Field>
              </div>
              <Field label="Supplier" htmlFor="r-vendor">
                <Input id="r-vendor" name="vendor" />
              </Field>
              <Field label="Reference" htmlFor="r-ref" hint="Packing slip or invoice number.">
                <Input id="r-ref" name="reference" />
              </Field>
              <Field label="Paid" htmlFor="r-paid">
                <Select id="r-paid" name="paid" defaultValue="on_account">
                  <option value="on_account">On account (owed to the supplier)</option>
                  <option value="now">Paid now from the bank</option>
                </Select>
              </Field>
              <Button type="submit">Receive</Button>
            </form>
          </Card>
          <Card title="Move">
            <form action={transferAction} className="grid gap-3" data-testid="transfer-form">
              {hidden}
              <Field label="Product" htmlFor="t-product">
                <Select id="t-product" name="product_id" required>
                  {productOptions}
                </Select>
              </Field>
              <Field label="From" htmlFor="t-from">
                <Select id="t-from" name="from_location_id" required>
                  {locationOptions}
                </Select>
              </Field>
              <Field label="To" htmlFor="t-to">
                <Select id="t-to" name="to_location_id" required defaultValue={activeLocations.find((l) => l.kind === "truck")?.id}>
                  {locationOptions}
                </Select>
              </Field>
              <Field label="Quantity" htmlFor="t-qty">
                <Input id="t-qty" name="quantity" inputMode="decimal" required />
              </Field>
              <Button type="submit">Move</Button>
            </form>
          </Card>
          <Card title="Count">
            <form action={countAction} className="grid gap-3" data-testid="count-form">
              {hidden}
              <Field label="Product" htmlFor="c-product">
                <Select id="c-product" name="product_id" required>
                  {productOptions}
                </Select>
              </Field>
              <Field label="At" htmlFor="c-location">
                <Select id="c-location" name="location_id" required>
                  {locationOptions}
                </Select>
              </Field>
              <Field label="Counted" htmlFor="c-qty" hint="What is there now, in the product's unit.">
                <Input id="c-qty" name="counted" inputMode="decimal" required />
              </Field>
              <Field label="Note" htmlFor="c-note">
                <Input id="c-note" name="note" />
              </Field>
              <Button type="submit">Save count</Button>
            </form>
          </Card>
        </div>
      ) : null}

      {write ? (
        <Card title="Locations" description="One warehouse per branch and one truck per technician; usage comes off the lead technician's truck.">
          <form action={saveLocation} className="grid gap-3 sm:grid-cols-5" data-testid="location-form">
            {hidden}
            <Field label="Kind" htmlFor="l-kind">
              <Select id="l-kind" name="kind" defaultValue="truck">
                <option value="truck">Truck</option>
                <option value="warehouse">Warehouse</option>
              </Select>
            </Field>
            <Field label="Name" htmlFor="l-name">
              <Input id="l-name" name="name" required />
            </Field>
            <Field label="Branch" htmlFor="l-branch">
              <Select id="l-branch" name="branch_id">
                {data.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Technician (trucks)" htmlFor="l-user">
              <Select id="l-user" name="user_id" defaultValue="">
                <option value="">None</option>
                {data.technicians.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name ?? "Member"}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="secondary">
                Add location
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card title="Movements" description="Every receipt, move, count and use, newest first. Nothing here is ever changed; a correction is a new movement.">
        {data.moves.length === 0 ? (
          <Empty>No movements yet.</Empty>
        ) : (
          <Table headers={["When", "What", "Product", "Quantity", "From", "To", "Value", "By"]}>
            {data.moves.map((m) => (
              <tr key={m.id} data-testid="movement-row">
                <td className="py-2 pr-4 text-sm">{formatInstantDate(m.occurred_at, active.tenantTimezone)}</td>
                <td className="py-2 pr-4 text-sm">
                  {KIND[m.kind] ?? m.kind}
                  {m.reference ? <span className="block text-xs text-stone-500">{m.vendor ? `${m.vendor}, ` : ""}{m.reference}</span> : null}
                </td>
                <td className="py-2 pr-4 text-sm">{m.product_name}</td>
                <td className="py-2 pr-4 text-sm tabular-nums">
                  {Number(m.quantity)} {m.unit.replace("_", " ")}
                </td>
                <td className="py-2 pr-4 text-sm">{m.from_name ?? ""}</td>
                <td className="py-2 pr-4 text-sm">{m.to_name ?? ""}</td>
                <td className="py-2 pr-4 text-sm tabular-nums">{formatCents(Number(m.value_cents))}</td>
                <td className="py-2 pr-4 text-sm">{m.by_name ?? ""}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
