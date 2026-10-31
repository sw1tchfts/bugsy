"use server";

import { redirect } from "next/navigation";
import { listMemberships, requireSession } from "@/lib/auth/session";
import { setActiveTenantCookie } from "@/lib/tenancy/active-tenant";

/** Changes which company the pages show. Only a company the user belongs to can be chosen. */
export async function switchTenant(formData: FormData) {
  const session = await requireSession();
  const tenantId = String(formData.get("tenant_id") ?? "");
  const memberships = await listMemberships(session);
  if (memberships.some((m) => m.tenantId === tenantId)) await setActiveTenantCookie(tenantId);
  redirect("/");
}
