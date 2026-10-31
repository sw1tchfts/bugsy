"use server";

import { redirect } from "next/navigation";
import { dbAs, requireSession } from "@/lib/auth/session";
import { setActiveTenantCookie } from "@/lib/tenancy/active-tenant";

export async function acceptInvitation(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const session = await requireSession();
  let tenantId: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      // The function returns the new membership; the member can read that row whatever their role.
      const [accepted] = await tx<{ membership_id: string }[]>`select app.accept_invitation(${token}::uuid) as membership_id`;
      const [row] = await tx<{ tenant_id: string }[]>`select tenant_id from public.memberships where id = ${accepted.membership_id}`;
      tenantId = row?.tenant_id ?? null;
    });
  } catch {
    redirect(`/invite/${encodeURIComponent(token)}?error=invitation`);
  }
  if (tenantId) await setActiveTenantCookie(tenantId);
  redirect("/");
}
