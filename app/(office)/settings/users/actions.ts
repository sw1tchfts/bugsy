"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { errorCode } from "@/lib/db";

const page = "/settings/users";

function finish(error: string | null): never {
  revalidatePath(page);
  redirect(error ? `${page}?error=${encodeURIComponent(error)}` : page);
}

function branchScope(formData: FormData): string[] | null {
  const ids = formData.getAll("branch_ids").map(String).filter(Boolean);
  return ids.length ? ids : null;
}

export async function inviteUser(formData: FormData) {
  const tenantId = String(formData.get("tenant_id") ?? "");
  const { session } = await requirePermission(tenantId, "users.write");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const roleId = String(formData.get("role_id") ?? "");
  const branches = branchScope(formData);

  let error: string | null = null;
  try {
    await dbAs(session, (tx) =>
      tx`insert into public.invitations (tenant_id, email, role_id, branch_ids)
         values (${tenantId}, ${email}, ${roleId}, ${branches})`,
    );
  } catch (err) {
    error = errorCode(err);
  }
  finish(error);
}

export async function revokeInvitation(formData: FormData) {
  const tenantId = String(formData.get("tenant_id") ?? "");
  const invitationId = String(formData.get("invitation_id") ?? "");
  const { session } = await requirePermission(tenantId, "users.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`delete from public.invitations where id = ${invitationId} and tenant_id = ${tenantId}`);
  } catch (err) {
    error = errorCode(err);
  }
  finish(error);
}

export async function changeMemberRole(formData: FormData) {
  const tenantId = String(formData.get("tenant_id") ?? "");
  const membershipId = String(formData.get("membership_id") ?? "");
  const roleId = String(formData.get("role_id") ?? "");
  const { session } = await requirePermission(tenantId, "users.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) =>
      tx`update public.memberships set role_id = ${roleId} where id = ${membershipId} and tenant_id = ${tenantId}`,
    );
  } catch (err) {
    error = errorCode(err);
  }
  finish(error);
}

export async function removeMember(formData: FormData) {
  const tenantId = String(formData.get("tenant_id") ?? "");
  const membershipId = String(formData.get("membership_id") ?? "");
  const { session } = await requirePermission(tenantId, "users.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`delete from public.memberships where id = ${membershipId} and tenant_id = ${tenantId}`);
  } catch (err) {
    error = errorCode(err);
  }
  finish(error);
}
