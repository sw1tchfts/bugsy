"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { intOrNull, opt, str } from "@/lib/customers/forms";
import { errorCode } from "@/lib/db";
import { type Step, TRIGGERS, stepProblems } from "@/lib/growth/sequences";
import { parseDollarsToCents } from "@/lib/money";

const PAGE = "/settings/growth";
function back(params: Record<string, string>): never {
  revalidatePath(PAGE);
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}`);
}

/** Rule 8: a sequence with its trigger's settings and up to three steps from the form. */
export async function createSequence(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "messages.manage");
  const trigger = str(formData, "trigger");
  if (!(TRIGGERS as readonly string[]).includes(trigger)) back({ error: "Pick what starts the sequence." });
  const steps: Step[] = [];
  for (const i of [1, 2, 3]) {
    const body = str(formData, `body_${i}`).trim();
    if (!body) continue;
    steps.push({ delay_days: intOrNull(formData, `delay_${i}`) ?? 0, channel: str(formData, `channel_${i}`) === "sms" ? "sms" : "email", subject: opt(formData, `subject_${i}`), body });
  }
  const problems = stepProblems(steps);
  if (problems.length) back({ error: problems.join(" ") });
  const settings = {
    days: intOrNull(formData, "days") ?? undefined,
    month: intOrNull(formData, "month") ?? undefined,
    service_type_id: opt(formData, "service_type_id") ?? undefined,
  };
  if (trigger === "seasonal_upsell" && (!settings.month || !settings.service_type_id)) back({ error: "A seasonal upsell needs its month and the service to offer." });
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`
      insert into public.sequences (tenant_id, name, trigger, settings, steps) values (${tenantId}, ${str(formData, "name").trim() || "Sequence"}, ${trigger}, ${tx.json(settings)}, ${tx.json(steps)})`);
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Sequence on. The messaging job enrolls and sends." });
}

export async function toggleSequence(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "messages.manage");
  await dbAs(session, (tx) => tx`update public.sequences set active = not active where id = ${str(formData, "sequence_id")} and tenant_id = ${tenantId}`);
  back({ note: "Saved." });
}

/** Rules 9 and 10: surveys on or off, and the referral credit. */
export async function saveGrowthSettings(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "settings.write");
  const credit = parseDollarsToCents(str(formData, "referral_credit") || "0");
  if (credit === null) back({ error: "The referral credit is a dollar amount." });
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`
      insert into public.growth_settings (tenant_id, referral_credit_cents, survey_enabled) values (${tenantId}, ${credit}, ${formData.get("survey_enabled") === "on"})
      on conflict (tenant_id) do update set referral_credit_cents = excluded.referral_credit_cents, survey_enabled = excluded.survey_enabled`);
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Saved." });
}
