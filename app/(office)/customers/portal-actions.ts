"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { opt, str } from "@/lib/customers/forms";
import { errorCode } from "@/lib/db";
import { queuePortalInvite } from "@/lib/messaging/db";
import { safely } from "@/lib/messaging/safely";

async function origin(): Promise<string> {
  const h = await headers();
  return h.get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

function back(accountId: string, params: Record<string, string>): never {
  const page = `/customers/${accountId}`;
  revalidatePath(page);
  redirect(`${page}?${new URLSearchParams(params).toString()}#portal`);
}

/** Spec 16 rule 1: the office invites a contact to the portal for this account, all properties or the chosen ones. */
export async function invitePortalUser(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const accountId = str(formData, "account_id");
  const { session, membership } = await requirePermission(tenantId, "customers.write");
  const contactId = opt(formData, "contact_id");
  const properties = formData.getAll("property_ids").map(String).filter((v) => /^[0-9a-f-]{36}$/i.test(v));
  let email = (opt(formData, "email") ?? "").trim().toLowerCase();
  let error: string | null = null;
  let link: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      let name = email;
      if (contactId) {
        const [c] = await tx<{ name: string; email: string | null }[]>`select name, email from public.contacts where id = ${contactId} and tenant_id = ${tenantId} and account_id = ${accountId}`;
        if (!c) throw Object.assign(new Error("That contact is not on this account."), { code: "23514" });
        email = email || (c.email ?? "");
        name = c.name;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error("An invitation needs an email address."), { code: "23514" });
      const [row] = await tx<{ id: string; token: string }[]>`
        insert into public.portal_users (tenant_id, account_id, contact_id, email, property_ids)
        values (${tenantId}, ${accountId}, ${contactId}, ${email}, ${properties.length ? properties : null}) returning id, token`;
      link = `${await origin()}/portal/invite/${row.token}`;
      const url = link;
      await safely(tx, "portal invitation", (t) => queuePortalInvite(t, tenantId, { portal_user_id: row.id, email, name, contact_id: contactId, account_id: accountId, url }, membership.tenantTimezone));
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(accountId, error ? { error } : { note: `Invitation sent to ${email}.` });
}

/** Rule 9: turning a portal user off ends their access at once; turning them back on needs them to have accepted. */
export async function setPortalUserStatus(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const accountId = str(formData, "account_id");
  const { session } = await requirePermission(tenantId, "customers.write");
  const id = str(formData, "portal_user_id");
  const status = str(formData, "status");
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      if (status === "disabled") {
        await tx`update public.portal_users set status = 'disabled' where id = ${id} and tenant_id = ${tenantId} and account_id = ${accountId}`;
      } else {
        await tx`update public.portal_users set status = case when user_id is null then 'invited' else 'active' end
                 where id = ${id} and tenant_id = ${tenantId} and account_id = ${accountId} and status = 'disabled'`;
      }
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(accountId, error ? { error } : { note: status === "disabled" ? "Portal access turned off." : "Portal access turned back on." });
}
