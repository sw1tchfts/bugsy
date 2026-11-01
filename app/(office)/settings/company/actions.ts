"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { str } from "@/lib/customers/forms";
import { errorCode } from "@/lib/db";

/** The company's display and legal names (spec 13 checklist: company details). */
export async function saveCompanyDetails(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const name = str(formData, "name").trim();
  const legalName = str(formData, "legal_name").trim() || null;
  const { session } = await requirePermission(tenantId, "settings.write");
  let error: string | null = null;
  if (!name) error = "The company needs a name.";
  else {
    try {
      await dbAs(session, (tx) => tx`update public.tenants set name = ${name}, legal_name = ${legalName} where id = ${tenantId}`);
    } catch (err) {
      error = errorCode(err);
    }
  }
  revalidatePath("/", "layout");
  redirect(`/settings/company${error ? `?error=${encodeURIComponent(error)}` : "?note=saved"}`);
}
