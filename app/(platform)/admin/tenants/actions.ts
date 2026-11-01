"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, listMemberships, requirePlatformAdmin } from "@/lib/auth/session";
import { errorCode } from "@/lib/db";
import { requestSupport, revokeSupport } from "@/lib/platform/db";
import { type GrantAccess, checkRequest } from "@/lib/platform/support";
import { setActiveTenantCookie } from "@/lib/tenancy/active-tenant";

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

function back(params: Record<string, string | null>): never {
  revalidatePath(page);
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  redirect(`${page}${q ? `?${q}` : ""}`);
}

/** Active, suspended or archived, with the reason the company sees (spec 13 rules 7 and 8). */
export async function setTenantStatus(formData: FormData) {
  const session = await requirePlatformAdmin();
  const tenantId = String(formData.get("tenant_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;
  let error: string | null = null;
  if (status !== "active" && !reason) error = "Say why the company is suspended or archived.";
  else {
    try {
      await dbAs(session, (tx) => tx`update public.tenants set status = ${status}, status_reason = ${status === "active" ? null : reason} where id = ${tenantId}`);
    } catch (err) {
      error = errorCode(err);
    }
  }
  back(error ? { error } : { note: `Status saved: ${status}.` });
}

/** Asks the company's owners for support access (rule 2). */
export async function requestSupportAccess(formData: FormData) {
  const session = await requirePlatformAdmin();
  const tenantId = String(formData.get("tenant_id") ?? "");
  const access = String(formData.get("access") ?? "") as GrantAccess;
  const hours = Number(formData.get("hours") ?? 0);
  const reason = String(formData.get("reason") ?? "");
  const problems = checkRequest({ access, hours, reason });
  let error: string | null = problems.join(" ") || null;
  if (!error) {
    try {
      await dbAs(session, (tx) => requestSupport(tx, tenantId, access, hours, reason));
    } catch (err) {
      error = errorCode(err);
    }
  }
  back(error ? { error } : { note: "Request sent. The company's owners see it on every page until they answer." });
}

/** Opens a company under a live grant: the office app then shows its data, every page logged (rules 1 and 5). */
export async function openSupportCompany(formData: FormData) {
  const session = await requirePlatformAdmin();
  const tenantId = String(formData.get("tenant_id") ?? "");
  const membership = (await listMemberships(session)).find((m) => m.tenantId === tenantId && m.support);
  if (!membership) back({ error: "There is no live access to that company." });
  await setActiveTenantCookie(tenantId);
  redirect("/");
}

/** Withdraws a request or ends a live grant early (rule 3). */
export async function endMySupport(formData: FormData) {
  const session = await requirePlatformAdmin();
  const grantId = String(formData.get("grant_id") ?? "");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => revokeSupport(tx, grantId));
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Access ended." });
}

/** Deletes an archived company's data once retention allows (rule 8); the database refuses anything sooner. */
export async function purgeCompany(formData: FormData) {
  const session = await requirePlatformAdmin();
  const tenantId = String(formData.get("tenant_id") ?? "");
  const confirm = String(formData.get("confirm") ?? "").trim();
  const name = String(formData.get("name") ?? "");
  let error: string | null = null;
  if (confirm !== name) error = "Type the company's name to confirm.";
  else {
    try {
      await dbAs(session, (tx) => tx`select app.purge_tenant(${tenantId})`);
    } catch (err) {
      const e = err as { message?: string };
      error = e.message?.includes("retention") || e.message?.includes("archived") ? e.message : errorCode(err);
    }
  }
  back(error ? { error } : { note: `${name} was purged.` });
}
