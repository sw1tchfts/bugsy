"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { bookReservice } from "@/lib/agreements/db";
import { can } from "@/lib/auth/permissions";
import { dbAs, requireMembership } from "@/lib/auth/session";
import { opt, str } from "@/lib/customers/forms";
import { addDays, isIsoDate, todayInZone } from "@/lib/dates";
import { errorCode } from "@/lib/db";

function back(params: Record<string, string>): never {
  revalidatePath("/requests");
  redirect(`/requests?${new URLSearchParams(params).toString()}`);
}

async function handler(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const ctx = await requireMembership(tenantId);
  if (!(can(ctx.membership.permissions, "customers.write") || can(ctx.membership.permissions, "dispatch.write"))) back({ error: "forbidden" });
  return { ...ctx, tenantId };
}

/** Spec 16 rule 4: the office books the re-service a customer asked for, on the request's agreement. */
export async function bookRequestedReservice(formData: FormData) {
  const ctx = await handler(formData);
  const id = str(formData, "request_id");
  const today = todayInZone(ctx.membership.tenantTimezone);
  const start = opt(formData, "due_start") ?? today;
  if (!isIsoDate(start)) back({ error: "Pick when the re-service is due from." });
  let error: string | null = null;
  try {
    await dbAs(ctx.session, async (tx) => {
      const [r] = await tx<{ agreement_id: string | null; details: string | null; status: string }[]>`
        select agreement_id, details, status from public.service_requests where id = ${id} and tenant_id = ${ctx.tenantId} and kind = 'reservice' for update`;
      if (!r || r.status !== "open" || !r.agreement_id) throw Object.assign(new Error("That request is not open."), { code: "23514" });
      const visitId = await bookReservice(tx, ctx.tenantId, r.agreement_id, (r.details ?? "Customer request").slice(0, 200), start, addDays(start, 6));
      await tx`update public.service_requests set status = 'done', result_visit_id = ${visitId}, handled_by = ${ctx.session.userId}, handled_at = now(),
                 response = ${`Booked: we will come between ${start} and ${addDays(start, 6)}. Dispatch will set the day.`} where id = ${id}`;
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Re-service booked; it is on the dispatch board." });
}

/** Closes a request as done (after the office scheduled it) or declined, with the answer the customer sees. */
export async function answerRequest(formData: FormData) {
  const ctx = await handler(formData);
  const id = str(formData, "request_id");
  const status = str(formData, "status") === "declined" ? "declined" : "done";
  const response = (opt(formData, "response") ?? "").trim();
  if (status === "declined" && !response) back({ error: "Say why, so the customer knows." });
  let error: string | null = null;
  try {
    await dbAs(ctx.session, (tx) =>
      tx`update public.service_requests set status = ${status}, response = ${response || "Scheduled. You will get a reminder before the visit."}, handled_by = ${ctx.session.userId}, handled_at = now()
         where id = ${id} and tenant_id = ${ctx.tenantId} and status = 'open'`,
    );
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: status === "declined" ? "Declined." : "Marked done." });
}

/** Spec 21 rule 7: the office answers a portal question the assistant could not; the customer sees it in the portal. */
export async function answerPortalQuestion(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session, membership } = await requireMembership(tenantId);
  if (!can(membership.permissions, "customers.write")) back({ error: "forbidden" });
  const answer = str(formData, "office_answer").trim().slice(0, 4000);
  if (!answer) back({ error: "Write the answer." });
  let error: string | null = null;
  try {
    const r = await dbAs(session, (tx) => tx`
      update public.portal_questions set office_answer = ${answer}, status = 'answered_by_office', answered_by = auth.uid(), answered_at = now()
      where id = ${str(formData, "question_id")} and tenant_id = ${tenantId} and status = 'waiting'`);
    if (r.count === 0) error = "That question was already answered.";
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Answered. The customer sees it in the portal." });
}
