"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requireMembership, requirePermission } from "@/lib/auth/session";
import { opt, str } from "@/lib/customers/forms";
import { fromTenantLocal } from "@/lib/dates";
import { errorCode } from "@/lib/db";
import { addEntry, clock, correctEntry } from "@/lib/payroll/db";

function back(params: Record<string, string | null>): never {
  revalidatePath("/time");
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  redirect(`/time${q ? `?${q}` : ""}`);
}

/** Rule 6: the signed-in person clocks themselves in or out from the office. */
export async function clockAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requireMembership(tenantId);
  const direction = str(formData, "direction") === "out" ? "out" : "in";
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => clock(tx, tenantId, session.userId, direction, new Date(), "office"));
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: direction === "in" ? "Clocked in." : "Clocked out." });
}

/** Rule 7: a correction with its reason; an entry in an exported period cannot change. */
export async function correctAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session, membership } = await requirePermission(tenantId, "payroll.write");
  const tz = membership.tenantTimezone;
  const start = fromTenantLocal(str(formData, "started_at"), tz);
  const endText = opt(formData, "ended_at");
  const end = endText ? fromTenantLocal(endText, tz) : null;
  if (!start || (endText && !end)) back({ error: "Enter the times as a day and a time." });
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => correctEntry(tx, tenantId, { id: str(formData, "entry_id"), started_at: start as Date, ended_at: end, reason: str(formData, "reason") }));
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Time corrected." });
}

export async function addAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session, membership } = await requirePermission(tenantId, "payroll.write");
  const tz = membership.tenantTimezone;
  const start = fromTenantLocal(str(formData, "started_at"), tz);
  const end = fromTenantLocal(str(formData, "ended_at"), tz);
  if (!start || !end) back({ error: "Enter the times as a day and a time." });
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => addEntry(tx, tenantId, { user_id: str(formData, "user_id"), started_at: start as Date, ended_at: end as Date, reason: str(formData, "reason") }));
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Time added." });
}
