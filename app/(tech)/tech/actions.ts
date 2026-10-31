"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requireMembership } from "@/lib/auth/session";
import { errorCode } from "@/lib/db";
import { LOCALES } from "@/lib/tech/i18n";

/** The technician's language, saved on their membership. */
export async function setLocale(formData: FormData) {
  const tenantId = String(formData.get("tenant_id") ?? "");
  const locale = String(formData.get("locale") ?? "en");
  const { session } = await requireMembership(tenantId);
  if (!(LOCALES as readonly string[]).includes(locale)) redirect("/tech");
  try {
    // Members cannot update their membership row directly; this function changes the locale and nothing else.
    await dbAs(session, (tx) => tx`select app.set_my_locale(${tenantId}, ${locale})`);
  } catch (err) {
    errorCode(err);
  }
  revalidatePath("/tech");
  redirect("/tech");
}
