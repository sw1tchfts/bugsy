"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { PRODUCT_UNITS, readProduct } from "@/lib/catalog/product-form";
import { str } from "@/lib/customers/forms";
import { errorCode } from "@/lib/db";
import { parseDollarsToCents } from "@/lib/money";

const PAGE = "/catalog/products";

function back(error: string | null): never {
  revalidatePath(PAGE);
  redirect(error ? `${PAGE}?error=${encodeURIComponent(error)}` : PAGE);
}

function readEnablement(formData: FormData): { enabled: boolean; unit: string; unit_cost_cents: number } | { error: string } {
  const unit = str(formData, "unit") || "fl_oz";
  if (!(PRODUCT_UNITS as readonly string[]).includes(unit)) return { error: "Pick the unit you buy the product in." };
  const raw = str(formData, "unit_cost");
  const cost = raw ? parseDollarsToCents(raw) : 0;
  if (cost === null) return { error: "Unit cost is dollars and cents, for example 11.50." };
  return { enabled: formData.get("enabled") === "true", unit, unit_cost_cents: cost };
}

/** Switches a product on or off for the company and records the unit and cost it buys it at. */
export async function setTenantProduct(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const productId = str(formData, "product_id");
  const { session } = await requirePermission(tenantId, "catalog.write");
  const read = readEnablement(formData);
  if ("error" in read) back(read.error);
  let error: string | null = null;
  try {
    await dbAs(session, (tx) =>
      tx`insert into public.tenant_products (tenant_id, product_id, enabled, unit, unit_cost_cents)
         values (${tenantId}, ${productId}, ${read.enabled}, ${read.unit}, ${read.unit_cost_cents})
         on conflict (tenant_id, product_id) do update set enabled = excluded.enabled, unit = excluded.unit, unit_cost_cents = excluded.unit_cost_cents`,
    );
  } catch (err) {
    error = errorCode(err);
  }
  back(error);
}

/** Adds a product the master list lacks. It stays private and unverified until the platform approves it. */
export async function createTenantProduct(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "catalog.write");
  const read = readProduct(formData);
  if ("error" in read) back(read.error);
  const enablement = readEnablement(formData);
  if ("error" in enablement) back(enablement.error);
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into public.products ${tx({ tenant_id: tenantId, ...read.value, label_rates: tx.json(read.value.label_rates) })} returning id`;
      await tx`insert into public.tenant_products (tenant_id, product_id, enabled, unit, unit_cost_cents)
               values (${tenantId}, ${row.id}, true, ${enablement.unit}, ${enablement.unit_cost_cents})`;
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(error);
}

/** Edits a product this company added while it is still unverified. */
export async function updateOwnProduct(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const productId = str(formData, "product_id");
  const { session } = await requirePermission(tenantId, "catalog.write");
  const read = readProduct(formData);
  if ("error" in read) back(read.error);
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const result = await tx`update public.products set ${tx({ ...read.value, label_rates: tx.json(read.value.label_rates) })}
        where id = ${productId} and tenant_id = ${tenantId} and verified_at is null`;
      if (result.count === 0) throw Object.assign(new Error("this product is already in the master list and is no longer yours to edit"), { code: "23514" });
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(error);
}

export async function archiveOwnProduct(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const productId = str(formData, "product_id");
  const { session } = await requirePermission(tenantId, "catalog.write");
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      await tx`update public.tenant_products set enabled = false where tenant_id = ${tenantId} and product_id = ${productId}`;
      await tx`update public.products set archived_at = now() where id = ${productId} and tenant_id = ${tenantId} and verified_at is null`;
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(error);
}

export type LabelReadState = { rows?: string; count?: number; note?: string | null; error?: string };

/**
 * Spec 21 rule 4: label text read into rate rows for the person to check. Nothing is saved here: the rows go into the
 * product form's label rates, and only the person's save stores them.
 */
export async function readLabelAction(_prev: LabelReadState, formData: FormData): Promise<LabelReadState> {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "catalog.write");
  const text = String(formData.get("label_text") ?? "").slice(0, 60_000);
  if (!text.trim()) return { error: "Paste the label's directions for use." };
  const productId = formData.get("product_id") ? str(formData, "product_id") : null;
  const { runAi } = await import("@/lib/ai/db");
  const outcome = await dbAs(session, (tx) => runAi(tx, tenantId, "label", productId, (p) => p.readLabel(text)));
  if (!outcome.ok) return { error: outcome.message };
  return { rows: JSON.stringify(outcome.value.rows), count: outcome.value.rows.length, note: outcome.value.note };
}
