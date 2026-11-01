"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { scoreChurn } from "@/lib/ai/churn-db";
import { dbAs, requireSession } from "@/lib/auth/session";
import { str } from "@/lib/customers/forms";
import { errorCode } from "@/lib/db";
import { todayInZone } from "@/lib/dates";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";

/** Spec 21 rule 6: the daily scoring, run now by someone who may run it. */
export async function rescoreChurn(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const session = await requireSession();
  const { active } = await resolveActiveTenant(session);
  if (!active || active.tenantId !== tenantId) redirect("/reports/churn-risk");
  let note: string;
  try {
    const n = await dbAs(session, (tx) => scoreChurn(tx, tenantId, todayInZone(active.tenantTimezone), true));
    note = `${n} plan${n === 1 ? "" : "s"} scored.`;
  } catch (err) {
    note = errorCode(err) === "forbidden" ? "Your role does not allow scoring." : "Scoring did not finish; try again.";
  }
  revalidatePath("/reports/churn-risk");
  redirect(`/reports/churn-risk?note=${encodeURIComponent(note)}`);
}
