"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requireMembership } from "@/lib/auth/session";
import { str } from "@/lib/customers/forms";
import { errorCode } from "@/lib/db";
import { decideSupport, revokeSupport } from "@/lib/platform/db";

const PAGE = "/settings/support";

function go(path: string, params: Record<string, string | null>): never {
  revalidatePath(PAGE);
  revalidatePath("/", "layout");
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  redirect(`${path}${q ? `?${q}` : ""}`);
}

/** An owner approves or denies a support request (spec 13 rule 3); the database checks the owner. */
export async function decideSupportRequest(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const grantId = str(formData, "grant_id");
  const approve = str(formData, "decision") === "approve";
  const { session } = await requireMembership(tenantId);
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => decideSupport(tx, grantId, approve));
  } catch (err) {
    error = errorCode(err);
  }
  go(PAGE, error ? { error } : { note: approve ? "Support access approved. It ends on its own when the hours are up." : "Support request denied." });
}

/** An owner, or the support user, ends a live grant or withdraws a request (rule 3). */
export async function endSupportAccess(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const grantId = str(formData, "grant_id");
  const back = str(formData, "return_to") || PAGE;
  const { session } = await requireMembership(tenantId);
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => revokeSupport(tx, grantId));
  } catch (err) {
    error = errorCode(err);
  }
  go(back, error ? { error } : { note: "Support access ended." });
}
