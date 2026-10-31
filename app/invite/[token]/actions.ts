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
      await tx`select app.accept_invitation(${token}::uuid)`;
      const [row] = await tx<{ tenant_id: string }[]>`select tenant_id from public.invitations where token = ${token}::uuid`;
      tenantId = row?.tenant_id ?? null;
    });
  } catch {
    redirect(`/invite/${encodeURIComponent(token)}?error=invitation`);
  }
  if (tenantId) await setActiveTenantCookie(tenantId);
  redirect("/");
}
