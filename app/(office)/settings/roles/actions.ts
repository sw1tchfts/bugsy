"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ALL_PERMISSIONS } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { errorCode } from "@/lib/db";

const page = "/settings/roles";

function finish(error: string | null): never {
  revalidatePath(page);
  redirect(error ? `${page}?error=${encodeURIComponent(error)}` : page);
}

function permissionsFrom(formData: FormData): string[] {
  const allowed = new Set<string>([...ALL_PERMISSIONS, "*"]);
  return formData.getAll("permissions").map(String).filter((p) => allowed.has(p));
}

/** Copies a platform default role into the company so it can be edited. */
export async function copyDefaultRole(formData: FormData) {
  const tenantId = String(formData.get("tenant_id") ?? "");
  const roleId = String(formData.get("role_id") ?? "");
  const { session } = await requirePermission(tenantId, "settings.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) =>
      tx`insert into public.roles (tenant_id, key, name, description, permissions)
         select ${tenantId}, key, name, description, permissions from public.roles where id = ${roleId} and tenant_id is null`,
    );
  } catch (err) {
    error = errorCode(err);
  }
  finish(error);
}

export async function updateRole(formData: FormData) {
  const tenantId = String(formData.get("tenant_id") ?? "");
  const roleId = String(formData.get("role_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const permissions = permissionsFrom(formData);
  const { session } = await requirePermission(tenantId, "settings.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) =>
      tx`update public.roles set name = ${name}, permissions = ${permissions}
         where id = ${roleId} and tenant_id = ${tenantId}`,
    );
  } catch (err) {
    error = errorCode(err);
  }
  finish(error);
}

export async function deleteRole(formData: FormData) {
  const tenantId = String(formData.get("tenant_id") ?? "");
  const roleId = String(formData.get("role_id") ?? "");
  const { session } = await requirePermission(tenantId, "settings.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`delete from public.roles where id = ${roleId} and tenant_id = ${tenantId}`);
  } catch (err) {
    error = errorCode(err);
  }
  finish(error);
}
