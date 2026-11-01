"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { opt, str } from "@/lib/customers/forms";
import { errorCode } from "@/lib/db";
import { countStock, receiveStock, transferStock } from "@/lib/inventory/db";
import { movementProblems } from "@/lib/inventory/stock";
import { parseDollarsToCents } from "@/lib/money";

function back(params: Record<string, string | null>): never {
  revalidatePath("/inventory");
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  redirect(`/inventory${q ? `?${q}` : ""}`);
}

const qty = (formData: FormData, key: string) => Number(str(formData, key).replace(/,/g, ""));

/** Spec 18: a warehouse for a branch or a truck for a technician. */
export async function saveLocation(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "inventory.write");
  const id = opt(formData, "location_id");
  const kind = str(formData, "kind") === "truck" ? "truck" : "warehouse";
  const name = str(formData, "name").trim();
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      if (id) {
        await tx`update public.stock_locations set name = ${name}, active = ${formData.get("active") === "true"} where id = ${id} and tenant_id = ${tenantId}`;
      } else {
        await tx`insert into public.stock_locations (tenant_id, branch_id, kind, name, user_id)
                 values (${tenantId}, ${str(formData, "branch_id")}, ${kind}, ${name}, ${kind === "truck" ? str(formData, "user_id") : null})`;
      }
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Location saved." });
}

/** Rule 2: product in, at its cost; the product's cost averages. */
export async function receiveAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session, membership } = await requirePermission(tenantId, "inventory.write");
  const quantity = qty(formData, "quantity");
  const cost = parseDollarsToCents(str(formData, "unit_cost"));
  const problems = movementProblems({ kind: "receipt", from: null, to: str(formData, "location_id"), quantity });
  if (problems.length) back({ error: problems.join(" ") });
  if (cost === null || cost < 0) back({ error: "Enter the cost per unit." });
  let error: string | null = null;
  let note: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const r = await receiveStock(
        tx,
        tenantId,
        {
          product_id: str(formData, "product_id"),
          location_id: str(formData, "location_id"),
          quantity,
          unit_cost_cents: cost as number,
          vendor: opt(formData, "vendor"),
          reference: opt(formData, "reference"),
          paid: str(formData, "paid") === "now" ? "now" : "on_account",
          note: opt(formData, "note"),
        },
        membership.tenantTimezone,
      );
      note = `Received. The product now costs $${(r.unit_cost_cents / 100).toFixed(2)} a unit on average.`;
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note });
}

/** Rule 4: stock moves between locations. */
export async function transferAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "inventory.write");
  const quantity = qty(formData, "quantity");
  const from = str(formData, "from_location_id");
  const to = str(formData, "to_location_id");
  const problems = movementProblems({ kind: "transfer", from, to, quantity });
  if (problems.length) back({ error: problems.join(" ") });
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => transferStock(tx, tenantId, { product_id: str(formData, "product_id"), from_location_id: from, to_location_id: to, quantity, note: opt(formData, "note") }));
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Moved." });
}

/** Rule 4: what is on the shelf or the truck; the difference posts at the current cost. */
export async function countAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session, membership } = await requirePermission(tenantId, "inventory.write");
  const counted = qty(formData, "counted");
  if (!Number.isFinite(counted) || counted < 0) back({ error: "Enter what is there, zero or more." });
  let error: string | null = null;
  let note: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const r = await countStock(tx, tenantId, { location_id: str(formData, "location_id"), product_id: str(formData, "product_id"), counted, note: opt(formData, "note") }, membership.tenantTimezone);
      note = r.difference === 0 ? "The count matches." : `Count saved: ${r.difference > 0 ? "found" : "short"} ${Math.abs(r.difference)}.`;
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note });
}

/** Low-stock levels for a product (spec 18 data: truck and warehouse minimums). */
export async function setMinimums(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "catalog.write");
  const num = (k: string) => {
    const v = opt(formData, k);
    return v === null ? null : Number(v);
  };
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`update public.tenant_products set truck_minimum = ${num("truck_minimum")}, warehouse_minimum = ${num("warehouse_minimum")}
                                   where tenant_id = ${tenantId} and product_id = ${str(formData, "product_id")}`);
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Minimums saved." });
}
