"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { opt, str } from "@/lib/customers/forms";
import { isIsoDate, todayInZone } from "@/lib/dates";
import { errorCode } from "@/lib/db";
import { ARRIVAL_WINDOWS, CREW_ROLES, type CheckResult, type CrewRole } from "@/lib/dispatch/checks";
import { loadCrew, moveDay, reorderVisit as reorderRow, scheduleVisit as scheduleRow, setCrew, unscheduleVisit as unscheduleRow } from "@/lib/dispatch/db";

const BOARD = "/dispatch";

function visitPage(id: string) {
  return `${BOARD}/visits/${id}`;
}

/** Redirects back with blockers as the error and warnings as a note. */
function finish(path: string, result: CheckResult | null, error: string | null = null): never {
  revalidatePath(BOARD);
  revalidatePath(path);
  const params = new URLSearchParams();
  const url = new URL(path, "http://x");
  for (const [k, v] of url.searchParams) params.set(k, v);
  if (error) params.set("error", error);
  else if (result && !result.ok) params.set("error", result.blockers.map((b) => b.message).join(" "));
  else if (result?.warnings.length) params.set("warn", result.warnings.map((w) => w.message).join(" "));
  const query = params.toString();
  redirect(`${url.pathname}${query ? `?${query}` : ""}`);
}

export type BoardResult = { ok: boolean; blockers: string[]; warnings: string[] };

function toBoardResult(result: CheckResult): BoardResult {
  return { ok: result.ok, blockers: result.blockers.map((b) => b.message), warnings: result.warnings.map((w) => w.message) };
}

/** Called by the drag and drop board: schedules and reports, no redirect. */
export async function scheduleVisitJson(input: { tenantId: string; visitId: string; technicianId: string; date: string }): Promise<BoardResult> {
  const { session, membership } = await requirePermission(input.tenantId, "dispatch.write");
  if (!isIsoDate(input.date)) return { ok: false, blockers: ["Pick a date."], warnings: [] };
  try {
    const result = await dbAs(session, (tx) => scheduleRow(tx, input.tenantId, input.visitId, input.technicianId, input.date, todayInZone(membership.tenantTimezone)));
    revalidatePath(BOARD);
    return toBoardResult(result);
  } catch (err) {
    return { ok: false, blockers: [errorCode(err)], warnings: [] };
  }
}

export async function reorderVisitJson(input: { tenantId: string; visitId: string; direction: "up" | "down" }): Promise<BoardResult> {
  const { session, membership } = await requirePermission(input.tenantId, "dispatch.write");
  try {
    const result = await dbAs(session, (tx) => reorderRow(tx, input.tenantId, input.visitId, input.direction, todayInZone(membership.tenantTimezone)));
    revalidatePath(BOARD);
    return toBoardResult(result);
  } catch (err) {
    return { ok: false, blockers: [errorCode(err)], warnings: [] };
  }
}

export async function unscheduleVisitJson(input: { tenantId: string; visitId: string }): Promise<BoardResult> {
  const { session } = await requirePermission(input.tenantId, "dispatch.write");
  try {
    await dbAs(session, (tx) => unscheduleRow(tx, input.tenantId, input.visitId));
    revalidatePath(BOARD);
    return { ok: true, blockers: [], warnings: [] };
  } catch (err) {
    return { ok: false, blockers: [errorCode(err)], warnings: [] };
  }
}

/** The form fallback on every card and on the visit page. */
export async function scheduleVisit(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const visitId = str(formData, "visit_id");
  const technicianId = str(formData, "technician_id");
  const date = str(formData, "date");
  const returnTo = opt(formData, "return_to") ?? BOARD;
  const { session, membership } = await requirePermission(tenantId, "dispatch.write");
  if (!technicianId || !isIsoDate(date)) finish(returnTo, null, "Pick a technician and a date.");
  let result: CheckResult | null = null;
  let error: string | null = null;
  try {
    result = await dbAs(session, (tx) => scheduleRow(tx, tenantId, visitId, technicianId, date, todayInZone(membership.tenantTimezone)));
  } catch (err) {
    error = errorCode(err);
  }
  finish(returnTo, result, error);
}

export async function unscheduleVisit(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const visitId = str(formData, "visit_id");
  const returnTo = opt(formData, "return_to") ?? BOARD;
  const { session } = await requirePermission(tenantId, "dispatch.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => unscheduleRow(tx, tenantId, visitId));
  } catch (err) {
    error = errorCode(err);
  }
  finish(returnTo, null, error);
}

export async function reorderVisit(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const visitId = str(formData, "visit_id");
  const direction = str(formData, "direction") === "up" ? "up" : "down";
  const returnTo = opt(formData, "return_to") ?? BOARD;
  const { session, membership } = await requirePermission(tenantId, "dispatch.write");
  let result: CheckResult | null = null;
  let error: string | null = null;
  try {
    result = await dbAs(session, (tx) => reorderRow(tx, tenantId, visitId, direction, todayInZone(membership.tenantTimezone)));
  } catch (err) {
    error = errorCode(err);
  }
  finish(returnTo, result, error);
}

export async function skipVisit(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const visitId = str(formData, "visit_id");
  const reason = str(formData, "skip_reason");
  const returnTo = opt(formData, "return_to") ?? BOARD;
  const { session } = await requirePermission(tenantId, "dispatch.write");
  if (!reason) finish(returnTo, null, "Say why the visit is skipped.");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`update public.visits set status = 'skipped', skip_reason = ${reason} where id = ${visitId} and tenant_id = ${tenantId} and status in ('planned', 'scheduled')`);
  } catch (err) {
    error = errorCode(err);
  }
  finish(returnTo, null, error);
}

/** Weather day: a technician's whole day moves to another date (rule 8). */
export async function moveTechnicianDay(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const technicianId = str(formData, "technician_id");
  const from = str(formData, "from");
  const to = str(formData, "to");
  const append = formData.get("append") === "true";
  const returnTo = opt(formData, "return_to") ?? BOARD;
  const { session, membership } = await requirePermission(tenantId, "dispatch.write");
  if (!isIsoDate(from) || !isIsoDate(to) || from === to) finish(returnTo, null, "Pick a different date to move the day to.");
  let error: string | null = null;
  let note: string | null = null;
  try {
    const moved = await dbAs(session, (tx) => moveDay(tx, tenantId, technicianId, from, to, todayInZone(membership.tenantTimezone), append));
    if (moved.refused.length) note = `${moved.moved.length} moved; ${moved.refused.length} stayed on ${from}: ${moved.refused.map((r) => r.issues.join(" ")).join(" ")}`;
  } catch (err) {
    error = errorCode(err);
  }
  if (note && !error) finish(returnTo, { ok: true, blockers: [], warnings: [{ code: "partial", message: note }] });
  finish(returnTo, null, error);
}

export async function setArrivalWindow(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const visitId = str(formData, "visit_id");
  const window = str(formData, "arrival_window");
  const { session } = await requirePermission(tenantId, "dispatch.write");
  if (!(ARRIVAL_WINDOWS as readonly string[]).includes(window)) finish(visitPage(visitId), null, "Pick an arrival window.");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`update public.visits set arrival_window = ${window} where id = ${visitId} and tenant_id = ${tenantId}`);
  } catch (err) {
    error = errorCode(err);
  }
  finish(visitPage(visitId), null, error);
}

export async function setDispatchNotes(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const visitId = str(formData, "visit_id");
  const { session } = await requirePermission(tenantId, "dispatch.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`update public.visits set dispatch_notes = ${opt(formData, "dispatch_notes")} where id = ${visitId} and tenant_id = ${tenantId}`);
  } catch (err) {
    error = errorCode(err);
  }
  finish(visitPage(visitId), null, error);
}

export async function addCrewMember(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const visitId = str(formData, "visit_id");
  const userId = str(formData, "user_id");
  const role = str(formData, "role") as CrewRole;
  const { session, membership } = await requirePermission(tenantId, "dispatch.write");
  if (!userId || !CREW_ROLES.includes(role)) finish(visitPage(visitId), null, "Pick a person and a role.");
  let result: CheckResult | null = null;
  let error: string | null = null;
  try {
    result = await dbAs(session, async (tx) => {
      const current = (await loadCrew(tx, tenantId, visitId)).filter((c) => c.user_id !== userId);
      const next = role === "lead" ? [{ user_id: userId, role }, ...current.filter((c) => c.role !== "lead")] : [...current, { user_id: userId, role }];
      if (!next.some((c) => c.role === "lead")) return { ok: false, blockers: [{ code: "one_lead", message: "Schedule the visit with a lead technician first." }], warnings: [] };
      return setCrew(tx, tenantId, visitId, next, todayInZone(membership.tenantTimezone));
    });
  } catch (err) {
    error = errorCode(err);
  }
  finish(visitPage(visitId), result, error);
}

export async function removeCrewMember(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const visitId = str(formData, "visit_id");
  const userId = str(formData, "user_id");
  const { session, membership } = await requirePermission(tenantId, "dispatch.write");
  let result: CheckResult | null = null;
  let error: string | null = null;
  try {
    result = await dbAs(session, async (tx) => {
      const current = await loadCrew(tx, tenantId, visitId);
      if (current.find((c) => c.user_id === userId)?.role === "lead") {
        return { ok: false, blockers: [{ code: "one_lead", message: "The lead comes off by unscheduling the visit or by scheduling it with another technician." }], warnings: [] };
      }
      return setCrew(tx, tenantId, visitId, current.filter((c) => c.user_id !== userId), todayInZone(membership.tenantTimezone));
    });
  } catch (err) {
    error = errorCode(err);
  }
  finish(visitPage(visitId), result, error);
}

export async function setDisplayName(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const membershipId = str(formData, "membership_id");
  const { session } = await requirePermission(tenantId, "users.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`update public.memberships set display_name = ${opt(formData, "display_name")} where id = ${membershipId} and tenant_id = ${tenantId}`);
  } catch (err) {
    error = errorCode(err);
  }
  revalidatePath("/settings/users");
  redirect(error ? `/settings/users?error=${encodeURIComponent(error)}` : "/settings/users");
}
