"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requirePlatformAdmin } from "@/lib/auth/session";
import { EPA_EXEMPT } from "@/lib/catalog/epa";
import { readProduct } from "@/lib/catalog/product-form";
import { errorCode } from "@/lib/db";

const PAGE = "/admin/products";

function back(error: string | null): never {
  revalidatePath(PAGE);
  revalidatePath("/catalog/products");
  redirect(error ? `${PAGE}?error=${encodeURIComponent(error)}` : PAGE);
}

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function createMasterProduct(formData: FormData) {
  const session = await requirePlatformAdmin();
  const read = readProduct(formData);
  if ("error" in read) back(read.error);
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      if (read.value.epa_reg_no !== EPA_EXEMPT) {
        const [dup] = await tx<{ name: string }[]>`select name from public.products where tenant_id is null and epa_reg_no = ${read.value.epa_reg_no}`;
        if (dup) throw Object.assign(new Error(`${read.value.epa_reg_no} is already in the master list as ${dup.name}`), { code: "23514" });
      }
      await tx`insert into public.products ${tx({ tenant_id: null, ...read.value, label_rates: tx.json(read.value.label_rates) })}`;
      await tx`update public.products set verified_at = now(), verified_by = auth.uid() where tenant_id is null and verified_at is null`;
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(error);
}

export async function updateMasterProduct(formData: FormData) {
  const session = await requirePlatformAdmin();
  const productId = field(formData, "product_id");
  const read = readProduct(formData);
  if ("error" in read) back(read.error);
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`update public.products set ${tx({ ...read.value, label_rates: tx.json(read.value.label_rates) })} where id = ${productId} and tenant_id is null`);
  } catch (err) {
    error = errorCode(err);
  }
  back(error);
}

/** Moves a product a company added into the master list: verified, shared with everyone, same id. */
export async function approveProduct(formData: FormData) {
  const session = await requirePlatformAdmin();
  const productId = field(formData, "product_id");
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const result = await tx`update public.products set tenant_id = null, verified_at = now(), verified_by = auth.uid() where id = ${productId} and tenant_id is not null`;
      if (result.count === 0) throw Object.assign(new Error("that product is not awaiting approval"), { code: "23514" });
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(error);
}

export async function archiveProduct(formData: FormData) {
  const session = await requirePlatformAdmin();
  const productId = field(formData, "product_id");
  const archive = formData.get("archive") === "true";
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`update public.products set archived_at = ${archive ? new Date() : null} where id = ${productId}`);
  } catch (err) {
    error = errorCode(err);
  }
  back(error);
}
