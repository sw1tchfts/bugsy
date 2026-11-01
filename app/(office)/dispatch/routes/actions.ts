"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { str } from "@/lib/customers/forms";
import { isIsoDate, todayInZone } from "@/lib/dates";
import { errorCode } from "@/lib/db";
import { applyAssign, applyOptimize, proposeAssign, proposeOptimize, scheduleFillIn } from "@/lib/routing/db";

function back(params: Record<string, string | null>): never {
  revalidatePath("/dispatch/routes");
  revalidatePath("/dispatch");
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  redirect(`/dispatch/routes${q ? `?${q}` : ""}`);
}

const keep = (formData: FormData) => ({ day: str(formData, "date"), branch: formData.get("branch") ? str(formData, "branch") : null });

/** Rules 2, 3 and 6: the shorter order for a technician's day, recorded as a run to preview; nothing moves yet. */
export async function proposeOptimizeAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "dispatch.write");
  const date = str(formData, "date");
  if (!isIsoDate(date)) back({ error: "Pick a day." });
  let error: string | null = null;
  let run: string | null = null;
  try {
    run = await dbAs(session, (tx) => proposeOptimize(tx, tenantId, str(formData, "technician_id"), date));
  } catch (err) {
    error = errorCode(err);
  }
  back({ ...keep(formData), ...(error ? { error } : { run }) });
}

/** Rules 2 and 6: the previewed order, if the day is unchanged. */
export async function applyOptimizeAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "dispatch.write");
  let error: string | null = null;
  let note: string | null = null;
  try {
    const r = await dbAs(session, (tx) => applyOptimize(tx, tenantId, str(formData, "run_id")));
    note = `Day reordered: ${r.miles_before} to ${r.miles_after} miles.`;
  } catch (err) {
    error = errorCode(err);
  }
  back({ ...keep(formData), ...(error ? { error } : { note }) });
}

/** Rule 4: the branch day's suggested assignments, recorded as a run to preview. */
export async function proposeAssignAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session, membership } = await requirePermission(tenantId, "dispatch.write");
  const date = str(formData, "date");
  const branchId = str(formData, "branch");
  if (!isIsoDate(date)) back({ error: "Pick a day." });
  let error: string | null = null;
  let run: string | null = null;
  try {
    run = await dbAs(session, (tx) => proposeAssign(tx, tenantId, branchId, date, todayInZone(membership.tenantTimezone)));
  } catch (err) {
    error = errorCode(err);
  }
  back({ ...keep(formData), ...(error ? { error } : { run }) });
}

/** Rules 4 and 6: the ticked assignments of a run, each through the dispatch check again. */
export async function applyAssignAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session, membership } = await requirePermission(tenantId, "dispatch.write");
  const runId = str(formData, "run_id");
  const chosen = formData.getAll("placement").map(String);
  if (chosen.length === 0) back({ ...keep(formData), run: runId, error: "Tick the assignments to make." });
  let error: string | null = null;
  let note: string | null = null;
  try {
    const r = await dbAs(session, (tx) => applyAssign(tx, tenantId, runId, todayInZone(membership.tenantTimezone), chosen));
    note = `${r.scheduled} visit(s) scheduled${r.refused.length ? `; refused: ${r.refused.join("; ")}` : ""}.`;
  } catch (err) {
    error = errorCode(err);
  }
  back({ ...keep(formData), ...(error ? { error } : { note }) });
}

/** Rule 5: a fill-in onto the technician's day, through the dispatch check, inserted where it adds the least driving. */
export async function fillInAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session, membership } = await requirePermission(tenantId, "dispatch.write");
  const date = str(formData, "date");
  const technicianId = str(formData, "technician_id");
  let error: string | null = null;
  let note: string | null = null;
  try {
    const r = await dbAs(session, (tx) => scheduleFillIn(tx, tenantId, technicianId, date, str(formData, "visit_id"), todayInZone(membership.tenantTimezone)));
    if (!r.ok) error = r.blockers[0]?.message ?? "refused";
    else note = `Scheduled as stop ${r.position}, where it adds the least driving.${r.warnings.length ? ` ${r.warnings.map((w) => w.message).join(" ")}` : ""}`;
  } catch (err) {
    error = errorCode(err);
  }
  back({ ...keep(formData), fill: technicianId, ...(error ? { error } : { note }) });
}
