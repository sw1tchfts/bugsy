// Inventory's database work (spec 18 rules 1 to 5) on the caller's connection: locations, receipts, transfers, counts,
// usage taken off the trucks when stops complete, and the levels. Receipts and counts run through definer functions
// that take the product's lock, then post to the ledger here.
import type postgres from "postgres";
import { dateInZone } from "@/lib/dates";
import { postEntry } from "@/lib/ledger/db";
import { stockAdjustmentLines, stockReceiptLines } from "@/lib/ledger/post";
import { type LocationKind, type StockFlag, levels, stockFlag, usageInStockUnit, valueCents } from "./stock";

// The unit conversion in app.record_usage mirrors lib/catalog/label-rates.ts; tests/unit/inventory.test.ts holds both.

type Sql = postgres.Sql | postgres.TransactionSql;

export type Location = { id: string; branch_id: string; branch_name: string; kind: LocationKind; name: string; user_id: string | null; user_name: string | null; active: boolean };

export async function listLocations(tx: Sql, tenantId: string): Promise<Location[]> {
  return tx<Location[]>`
    select l.id, l.branch_id, b.name as branch_name, l.kind, l.name, l.user_id, m.display_name as user_name, l.active
    from public.stock_locations l join public.branches b on b.id = l.branch_id
      left join public.memberships m on m.tenant_id = l.tenant_id and m.user_id = l.user_id
    where l.tenant_id = ${tenantId} order by l.active desc, l.kind desc, b.name, l.name`;
}

export type StockRow = {
  location_id: string;
  product_id: string;
  product_name: string;
  epa_reg_no: string | null;
  unit: string;
  unit_cost_cents: number;
  on_hand: number;
  value_cents: number;
  flag: StockFlag;
};

/** Levels per location and product the caller may see, valued at the current (moving average) cost. */
export async function stockLevels(tx: Sql, tenantId: string, locationIds?: readonly string[]): Promise<StockRow[]> {
  const ids = locationIds ? [...locationIds] : null;
  const moves = await tx<{ product_id: string; from_location_id: string | null; to_location_id: string | null; quantity: string }[]>`
    select product_id, from_location_id, to_location_id, quantity::text from public.stock_movements
    where tenant_id = ${tenantId} and (${ids}::uuid[] is null or from_location_id = any(${ids}::uuid[]) or to_location_id = any(${ids}::uuid[]))`;
  const products = await tx<{ product_id: string; name: string; epa_reg_no: string | null; unit: string; unit_cost_cents: string; truck_minimum: string | null; warehouse_minimum: string | null }[]>`
    select tp.product_id, p.name, p.epa_reg_no, tp.unit, tp.unit_cost_cents, tp.truck_minimum, tp.warehouse_minimum
    from public.tenant_products tp join public.products p on p.id = tp.product_id where tp.tenant_id = ${tenantId}`;
  const byProduct = new Map(products.map((p) => [p.product_id, p]));
  const kinds = new Map(
    (await tx<{ id: string; kind: LocationKind }[]>`select id, kind from public.stock_locations where tenant_id = ${tenantId}`).map((l) => [l.id, l.kind]),
  );
  const out: StockRow[] = [];
  for (const [key, onHand] of levels(moves)) {
    const [locationId, productId] = key.split(":");
    if (ids && !ids.includes(locationId)) continue;
    const p = byProduct.get(productId);
    if (!p) continue;
    const cost = Number(p.unit_cost_cents);
    out.push({
      location_id: locationId,
      product_id: productId,
      product_name: p.name,
      epa_reg_no: p.epa_reg_no,
      unit: p.unit,
      unit_cost_cents: cost,
      on_hand: onHand,
      value_cents: onHand > 0 ? valueCents(onHand, cost) : 0,
      flag: stockFlag(onHand, kinds.get(locationId) ?? "warehouse", p),
    });
  }
  return out.sort((a, b) => a.product_name.localeCompare(b.product_name));
}

/** Rule 2: a receipt at its cost; the product's cost moves to the moving average; the ledger gains the inventory. */
export async function receiveStock(
  tx: Sql,
  tenantId: string,
  input: { product_id: string; location_id: string; quantity: number; unit_cost_cents: number; vendor: string | null; reference: string | null; paid: "now" | "on_account"; note: string | null },
  timeZone: string,
): Promise<{ movement_id: string; unit_cost_cents: number }> {
  const [{ r }] = await tx<{ r: { movement_id: string; unit_cost_cents: number; value_cents: number } }[]>`
    select app.stock_receive(${tenantId}, ${input.product_id}, ${input.location_id}, ${input.quantity}, ${input.unit_cost_cents},
                             ${input.vendor}, ${input.reference}, ${input.paid}, ${input.note}) as r`;
  const [p] = await tx<{ name: string }[]>`select name from public.products where id = ${input.product_id}`;
  await postEntry(tx, tenantId, {
    source_type: "stock_receipt",
    source_key: `stock_receipt:${r.movement_id}`,
    source_id: r.movement_id,
    posted_on: dateInZone(new Date(), timeZone),
    memo: `Received ${input.quantity} of ${p?.name ?? "a product"}${input.vendor ? ` from ${input.vendor}` : ""}${input.reference ? ` (${input.reference})` : ""}`,
    lines: stockReceiptLines(Number(r.value_cents), input.paid),
  });
  return { movement_id: r.movement_id, unit_cost_cents: Number(r.unit_cost_cents) };
}

/** Rule 4: moves stock between locations at the current cost; no ledger entry. */
export async function transferStock(tx: Sql, tenantId: string, input: { product_id: string; from_location_id: string; to_location_id: string; quantity: number; note: string | null }): Promise<string> {
  const [tp] = await tx<{ unit: string; unit_cost_cents: string }[]>`select unit, unit_cost_cents from public.tenant_products where tenant_id = ${tenantId} and product_id = ${input.product_id}`;
  if (!tp) throw Object.assign(new Error("Enable the product in the catalog first."), { code: "23514" });
  const [row] = await tx<{ id: string }[]>`
    insert into public.stock_movements (tenant_id, product_id, kind, from_location_id, to_location_id, quantity, unit, unit_cost_cents, value_cents, note)
    values (${tenantId}, ${input.product_id}, 'transfer', ${input.from_location_id}, ${input.to_location_id}, ${input.quantity}, ${tp.unit}, ${Number(tp.unit_cost_cents)},
            ${valueCents(input.quantity, Number(tp.unit_cost_cents))}, ${input.note})
    returning id`;
  return row.id;
}

/** Rule 4: what is there; the difference is one adjustment and one entry against chemical cost. */
export async function countStock(tx: Sql, tenantId: string, input: { location_id: string; product_id: string; counted: number; note: string | null }, timeZone: string): Promise<{ difference: number }> {
  const [{ r }] = await tx<{ r: { movement_id: string | null; difference: string | number; value_cents: number } }[]>`
    select app.stock_count(${tenantId}, ${input.location_id}, ${input.product_id}, ${input.counted}, ${input.note}) as r`;
  if (r.movement_id) {
    const [p] = await tx<{ name: string }[]>`select name from public.products where id = ${input.product_id}`;
    await postEntry(tx, tenantId, {
      source_type: "stock_adjustment",
      source_key: `stock_adjustment:${r.movement_id}`,
      source_id: r.movement_id,
      posted_on: dateInZone(new Date(), timeZone),
      memo: `Count of ${p?.name ?? "a product"}: ${Number(r.difference) > 0 ? "found" : "short"} ${Math.abs(Number(r.difference))}`,
      lines: stockAdjustmentLines(Number(r.value_cents)),
    });
  }
  return { difference: Number(r.difference) };
}

type UsageRow = { visit_product_id: string; visit_id: string; product_id: string; amount: string; amount_unit: string; stock_unit: string | null; unit_cost_cents: string | null; truck_id: string | null; warehouse_id: string | null; completed_at: Date };

async function usageCandidates(tx: Sql, tenantId: string, visitId: string | null): Promise<UsageRow[]> {
  return tx<UsageRow[]>`
    select vp.id as visit_product_id, v.id as visit_id, vp.product_id, vp.amount::text, vp.amount_unit, tp.unit as stock_unit, tp.unit_cost_cents::text,
           (select l.id from public.stock_locations l where l.tenant_id = v.tenant_id and l.kind = 'truck' and l.active and l.user_id = v.technician_id) as truck_id,
           (select l.id from public.stock_locations l where l.tenant_id = v.tenant_id and l.kind = 'warehouse' and l.active and l.branch_id = v.branch_id
             order by l.created_at limit 1) as warehouse_id,
           v.completed_at
    from public.visit_products vp
      join public.visits v on v.id = vp.visit_id
      join public.inventory_settings s on s.tenant_id = v.tenant_id
      left join public.tenant_products tp on tp.tenant_id = vp.tenant_id and tp.product_id = vp.product_id
      join public.tenants t on t.id = v.tenant_id
    where vp.tenant_id = ${tenantId} and v.status = 'completed' and not v.imported and (${visitId}::uuid is null or v.id = ${visitId}::uuid)
      and (v.completed_at at time zone t.timezone)::date >= s.tracking_since
      and not exists (select 1 from public.stock_movements m where m.visit_product_id = vp.id)
    order by v.completed_at, vp.id`;
}

/**
 * Rules 1 and 3: each application line at a completed stop comes off the lead technician's truck (or the visit's
 * branch warehouse) once, in the product's unit, at the current cost. The database works the quantity out from the
 * record (app.record_usage), so any member's job run can take it and nobody can send a different figure.
 */
export async function recordUsage(tx: Sql, tenantId: string, visitId: string | null): Promise<{ recorded: number; unconverted: number }> {
  const [{ r }] = await tx<{ r: { recorded: number; unconverted: number } }[]>`select app.record_usage(${tenantId}, ${visitId}::uuid) as r`;
  return { recorded: Number(r.recorded), unconverted: Number(r.unconverted) };
}

/** Application lines that could not come off the shelves: units that do not convert into the product's unit. */
export async function unconvertedUsage(tx: Sql, tenantId: string): Promise<{ visit_id: string; product_name: string; amount: string; amount_unit: string; stock_unit: string }[]> {
  const rows = await usageCandidates(tx, tenantId, null);
  const out: { visit_id: string; product_name: string; amount: string; amount_unit: string; stock_unit: string }[] = [];
  for (const u of rows) {
    if (!u.stock_unit || usageInStockUnit(u.amount, u.amount_unit, u.stock_unit) !== null) continue;
    const [p] = await tx<{ name: string }[]>`select name from public.products where id = ${u.product_id}`;
    out.push({ visit_id: u.visit_id, product_name: p?.name ?? "Product", amount: u.amount, amount_unit: u.amount_unit, stock_unit: u.stock_unit });
  }
  return out;
}

export type MovementRow = {
  id: string;
  kind: string;
  product_name: string;
  quantity: string;
  unit: string;
  unit_cost_cents: string;
  value_cents: string;
  from_name: string | null;
  to_name: string | null;
  vendor: string | null;
  reference: string | null;
  paid: string | null;
  note: string | null;
  visit_id: string | null;
  occurred_at: Date;
  by_name: string | null;
};

export async function movementLog(tx: Sql, tenantId: string, filters: { location_id?: string | null; product_id?: string | null; limit?: number }): Promise<MovementRow[]> {
  return tx<MovementRow[]>`
    select m.id, m.kind, p.name as product_name, m.quantity::text, m.unit, m.unit_cost_cents::text, m.value_cents::text,
           f.name as from_name, t.name as to_name, m.vendor, m.reference, m.paid, m.note, m.visit_id, m.occurred_at, mb.display_name as by_name
    from public.stock_movements m join public.products p on p.id = m.product_id
      left join public.stock_locations f on f.id = m.from_location_id
      left join public.stock_locations t on t.id = m.to_location_id
      left join public.memberships mb on mb.tenant_id = m.tenant_id and mb.user_id = m.created_by
    where m.tenant_id = ${tenantId}
      and (${filters.location_id ?? null}::uuid is null or m.from_location_id = ${filters.location_id ?? null}::uuid or m.to_location_id = ${filters.location_id ?? null}::uuid)
      and (${filters.product_id ?? null}::uuid is null or m.product_id = ${filters.product_id ?? null}::uuid)
    order by m.occurred_at desc, m.created_at desc limit ${filters.limit ?? 200}`;
}

/** The technician app's truck screen: the person's active truck and what is on it (spec 18, MOB-08). */
export async function truckStock(tx: Sql, tenantId: string, userId: string): Promise<{ location_id: string; name: string; items: StockRow[] } | null> {
  const [truck] = await tx<{ id: string; name: string }[]>`
    select id, name from public.stock_locations where tenant_id = ${tenantId} and kind = 'truck' and active and user_id = ${userId}`;
  if (!truck) return null;
  return { location_id: truck.id, name: truck.name, items: await stockLevels(tx, tenantId, [truck.id]) };
}
