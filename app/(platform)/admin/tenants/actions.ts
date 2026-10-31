"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requirePlatformAdmin } from "@/lib/auth/session";
import { errorCode } from "@/lib/db";

const page = "/admin/tenants";

/** Creates a company and an owner invitation for its first user. */
export async function createTenant(formData: FormData) {
  const session = await requirePlatformAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const legalName = String(formData.get("legal_name") ?? "").trim() || null;
  const timezone = String(formData.get("timezone") ?? "").trim();
  const ownerEmail = String(formData.get("owner_email") ?? "").trim().toLowerCase();

  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const [tenant] = await tx<{ id: string }[]>`
        insert into public.tenants (name, legal_name, timezone) values (${name}, ${legalName}, ${timezone}) returning id`;
      const [owner] = await tx<{ id: string }[]>`select id from public.roles where tenant_id is null and key = 'owner'`;
      await tx`insert into public.invitations (tenant_id, email, role_id) values (${tenant.id}, ${ownerEmail}, ${owner.id})`;
    });
  } catch (err) {
    error = errorCode(err);
  }
  revalidatePath(page);
  redirect(error ? `${page}?error=${encodeURIComponent(error)}` : page);
}

export async function setTenantStatus(formData: FormData) {
  const session = await requirePlatformAdmin();
  const tenantId = String(formData.get("tenant_id") ?? "");
  const status = String(formData.get("status") ?? "");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`update public.tenants set status = ${status} where id = ${tenantId}`);
  } catch (err) {
    error = errorCode(err);
  }
  revalidatePath(page);
  redirect(error ? `${page}?error=${encodeURIComponent(error)}` : page);
}
