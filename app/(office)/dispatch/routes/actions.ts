"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { str } from "@/lib/customers/forms";
import { isIsoDate, todayInZone } from "@/lib/dates";
import { errorCode } from "@/lib/db";
import { loadDay } from "@/lib/routing/db";
import { applyAssign, applyOptimize } from "@/lib/routing/db";
import { optimizeDay } from "@/lib/routing/optimize";
import { scheduleVisit } from "@/lib/dispatch/db";

function back(params: Record<string, string | null>): never {
  revalidatePath("/dispatch/routes");
  revalidatePath("/dispatch");
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  redirect(`/dispatch/routes${q ? `?${q}` : ""}`);
}

/** Rules 2 and 6: the previewed order, if the day is unchanged. */
export async function applyOptimizeAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "dispatch.write");
  const date = str(formData, "date");
  const technicianId = str(formData, "technician_id");
  const keep = { day: date, branch: formData.get("branch") ? str(formData, "branch") : null };
  if (!isIsoDate(date)) back({ error: "Pick a day." });
  let error: string | null = null;
  let note: string | null = null;
  try {
    const r = await dbAs(session, (tx) => applyOptimize(tx, tenantId, technicianId, date, str(formData, "fingerprint")));
    note = `Day reordered: ${r.miles_before} to ${r.miles_after} miles.`;
  } catch (err) {
    error = errorCode(err);
  }
  back({ ...keep, ...(error ? { error } : { note }) });
}

/** Rules 4 and 6: the chosen assignments, each through the dispatch check again. */
export async function applyAssignAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session, membership } = await requirePermission(tenantId, "dispatch.write");
  const date = str(formData, "date");
  const branchId = str(formData, "branch");
  const chosen = formData
    .getAll("placement")
    .map(String)
    .map((v) => v.split(":"))
    .filter((p) => p.length === 2)
    .map(([visit_id, technician_id]) => ({ visit_id, technician_id }));
  if (chosen.length === 0) back({ day: date, branch: branchId, error: "Tick the assignments to make." });
  let error: string | null = null;
  let note: string | null = null;
  try {
    const r = await dbAs(session, (tx) => applyAssign(tx, tenantId, branchId, date, todayInZone(membership.tenantTimezone), chosen));
    note = `${r.scheduled} visit(s) scheduled${r.refused.length ? `; refused: ${r.refused.join("; ")}` : ""}.`;
  } catch (err) {
    error = errorCode(err);
  }
  back({ day: date, branch: branchId, ...(error ? { error } : { note }) });
}

/** Rule 5: a fill-in onto the technician's day, through the dispatch check, then the day in its best order. */
export async function fillInAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session, membership } = await requirePermission(tenantId, "dispatch.write");
  const date = str(formData, "date");
  const technicianId = str(formData, "technician_id");
  const keep = { day: date, branch: formData.get("branch") ? str(formData, "branch") : null };
  let error: string | null = null;
  let note: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const r = await scheduleVisit(tx, tenantId, str(formData, "visit_id"), technicianId, date, todayInZone(membership.tenantTimezone));
      if (!r.ok) throw Object.assign(new Error(r.blockers[0]?.message ?? "refused"), { code: "23514" });
      const day = await loadDay(tx, tenantId, technicianId, date);
      for (const [i, s] of optimizeDay(day.start, day.stops).entries()) await tx`update public.visits set route_position = ${i + 1} where id = ${s.id} and status = 'scheduled'`;
      note = r.warnings.length ? `Scheduled. ${r.warnings.map((w) => w.message).join(" ")}` : "Scheduled and placed where it adds the least driving.";
    });
  } catch (err) {
    error = errorCode(err);
  }
  back({ ...keep, ...(error ? { error } : { note }) });
}
