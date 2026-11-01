"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { str } from "@/lib/customers/forms";
import { errorCode } from "@/lib/db";

/** Spec 21 rule 2: which AI features the company uses, and how many calls a month it allows. */
export async function saveAiSettings(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "settings.write");
  const on = (k: string) => formData.get(k) === "on";
  const limit = Math.max(0, Math.min(100000, Math.round(Number(str(formData, "monthly_limit")) || 0)));
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`
      insert into public.ai_settings (tenant_id, enabled, summaries, label_reading, portal_answers, churn, monthly_limit)
      values (${tenantId}, ${on("enabled")}, ${on("summaries")}, ${on("label_reading")}, ${on("portal_answers")}, ${on("churn")}, ${limit})
      on conflict (tenant_id) do update set enabled = excluded.enabled, summaries = excluded.summaries, label_reading = excluded.label_reading,
        portal_answers = excluded.portal_answers, churn = excluded.churn, monthly_limit = excluded.monthly_limit`);
  } catch (err) {
    error = errorCode(err);
  }
  revalidatePath("/settings/ai");
  redirect(`/settings/ai?${error ? `error=${encodeURIComponent(error)}` : "note=AI+settings+saved."}`);
}
