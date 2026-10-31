"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { errorCode } from "@/lib/db";

const page = "/settings/branches";

export async function createBranch(formData: FormData) {
  const tenantId = String(formData.get("tenant_id") ?? "");
  const { session } = await requirePermission(tenantId, "settings.write");
  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const stateCode = String(formData.get("state_code") ?? "").trim().toUpperCase();
  const license = String(formData.get("business_license_number") ?? "").trim() || null;
  const yearRaw = String(formData.get("license_year") ?? "").trim();
  const licenseYear = yearRaw ? Number.parseInt(yearRaw, 10) : null;

  let error: string | null = null;
  try {
    await dbAs(session, (tx) =>
      tx`insert into public.branches (tenant_id, name, address, state_code, business_license_number, license_year)
         values (${tenantId}, ${name}, ${address}, ${stateCode}, ${license}, ${licenseYear})`,
    );
  } catch (err) {
    error = errorCode(err);
  }
  revalidatePath(page);
  redirect(error ? `${page}?error=${encodeURIComponent(error)}` : page);
}

export async function setBranchArchived(formData: FormData) {
  const tenantId = String(formData.get("tenant_id") ?? "");
  const branchId = String(formData.get("branch_id") ?? "");
  const archive = formData.get("archive") === "true";
  const { session } = await requirePermission(tenantId, "settings.write");

  let error: string | null = null;
  try {
    await dbAs(session, (tx) =>
      tx`update public.branches set archived_at = ${archive ? new Date() : null}
         where id = ${branchId} and tenant_id = ${tenantId}`,
    );
  } catch (err) {
    error = errorCode(err);
  }
  revalidatePath(page);
  redirect(error ? `${page}?error=${encodeURIComponent(error)}` : page);
}
