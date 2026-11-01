"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { intOrNull, opt, str } from "@/lib/customers/forms";
import { errorCode } from "@/lib/db";

const PAGE = "/settings/portal";

function back(params: Record<string, string>): never {
  revalidatePath(PAGE);
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}`);
}

const ids = (formData: FormData, key: string) => formData.getAll(key).map(String).filter((v) => /^[0-9a-f-]{36}$/i.test(v));

/** The office's rules for the portal (spec 16 rules 4 and 5). */
export async function savePortalSettings(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "settings.write");
  const notice = intOrNull(formData, "reschedule_notice_hours") ?? 24;
  const stops = intOrNull(formData, "max_stops_per_day") ?? 18;
  if (notice < 0 || notice > 336 || stops < 1 || stops > 60) back({ error: "Notice is 0 to 336 hours; a day holds 1 to 60 stops." });
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`
      insert into public.portal_settings (tenant_id, allow_reschedule, reschedule_notice_hours, max_stops_per_day, allow_requests, requestable_service_type_ids)
      values (${tenantId}, ${formData.get("allow_reschedule") === "on"}, ${notice}, ${stops}, ${formData.get("allow_requests") === "on"}, ${ids(formData, "requestable")})
      on conflict (tenant_id) do update set allow_reschedule = excluded.allow_reschedule, reschedule_notice_hours = excluded.reschedule_notice_hours,
        max_stops_per_day = excluded.max_stops_per_day, allow_requests = excluded.allow_requests, requestable_service_type_ids = excluded.requestable_service_type_ids`);
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Portal rules saved." });
}

/** Spec 16 rule 8: a booking form the company puts on its website. */
export async function createLeadForm(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "settings.write");
  const name = str(formData, "name").trim();
  if (!name) back({ error: "Name the form." });
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`
      insert into public.lead_forms (tenant_id, name, service_type_ids, ask_preferred_date, thank_you)
      values (${tenantId}, ${name.slice(0, 100)}, ${ids(formData, "service_type_ids")}, ${formData.get("ask_preferred_date") === "on"}, ${opt(formData, "thank_you")})`);
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Form created. Copy its snippet onto your website." });
}

export async function toggleLeadForm(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "settings.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`update public.lead_forms set active = not active where id = ${str(formData, "form_id")} and tenant_id = ${tenantId}`);
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Saved." });
}
