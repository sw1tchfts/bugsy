"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { opt, str } from "@/lib/customers/forms";
import { errorCode } from "@/lib/db";

function back(params: Record<string, string | null>): never {
  revalidatePath("/settings/routing");
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  redirect(`/settings/routing${q ? `?${q}` : ""}`);
}

const time = (v: string) => (/^\d{2}:\d{2}$/.test(v) ? v : null);

/** Spec 19: the company's speed, day and fill-in radius, and how long positions are kept. */
export async function saveRouteSettings(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "settings.write");
  const mph = Number(str(formData, "average_speed_mph"));
  const fill = Number(str(formData, "fill_in_miles"));
  const days = Number(str(formData, "position_days"));
  const [start, morning, afternoon] = [time(str(formData, "day_starts_at")), time(str(formData, "morning_ends_at")), time(str(formData, "afternoon_ends_at"))];
  if (!start || !morning || !afternoon) back({ error: "Enter the times as hours and minutes." });
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`
      insert into public.route_settings (tenant_id, average_speed_mph, day_starts_at, morning_ends_at, afternoon_ends_at, fill_in_miles, position_days)
      values (${tenantId}, ${mph}, ${start}, ${morning}, ${afternoon}, ${fill}, ${days})
      on conflict (tenant_id) do update set average_speed_mph = excluded.average_speed_mph, day_starts_at = excluded.day_starts_at, morning_ends_at = excluded.morning_ends_at,
        afternoon_ends_at = excluded.afternoon_ends_at, fill_in_miles = excluded.fill_in_miles, position_days = excluded.position_days`);
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Routing settings saved." });
}

/** The route's start and end: the branch on the map. */
export async function saveBranchPoint(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "settings.write");
  const lat = opt(formData, "lat");
  const lng = opt(formData, "lng");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`update public.branches set lat = ${lat === null ? null : Number(lat)}, lng = ${lng === null ? null : Number(lng)} where id = ${str(formData, "branch_id")} and tenant_id = ${tenantId}`);
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Branch location saved." });
}
