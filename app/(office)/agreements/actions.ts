"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { JobStep } from "@/lib/agreements/cadence";
import { redirect } from "next/navigation";
import { applyPriceIncrease as applyIncrease, bookReservice as bookReserviceRow, cancelAgreement as cancelRow, changeRecurringPrice, maintainTerms, renewAgreement as renewRow, syncVisits } from "@/lib/agreements/db";
import { readAgreementColumns } from "@/lib/agreements/forms";
import { can } from "@/lib/auth/permissions";
import { dbAs, requireMembership, requirePermission } from "@/lib/auth/session";
import { imageInfo } from "@/lib/commercial/image";
import { putFile } from "@/lib/files";
import { RELATIONSHIPS } from "@/lib/specialty/materials";
import { issuePrepayments, settleCancellation } from "@/lib/billing/db";
import { intOrNull, opt, str } from "@/lib/customers/forms";
import { addDays, isIsoDate, todayInZone } from "@/lib/dates";
import { errorCode } from "@/lib/db";
import { parseDollarsToCents } from "@/lib/money";

const LIST = "/agreements";

function detail(id: string) {
  return `${LIST}/${id}`;
}

function back(path: string, error: string | null): never {
  revalidatePath(LIST);
  revalidatePath(path);
  redirect(error ? `${path}?error=${encodeURIComponent(error)}` : path);
}

async function requesterIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

/** Saves a draft agreement. The detail page then shows its plan and lets the customer sign. */
export async function createAgreement(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session, membership } = await requirePermission(tenantId, "agreements.write");
  const accountId = str(formData, "account_id");
  const propertyId = str(formData, "property_id");
  const serviceTypeId = str(formData, "service_type_id");
  const returnTo = `${LIST}/new?${new URLSearchParams({ account_id: accountId, property_id: propertyId })}`;
  if (!accountId || !propertyId || !serviceTypeId) back(returnTo, "An agreement needs an account, a property and a service type.");
  const [plan] = await dbAs(session, (tx) => tx<{ job_plan: JobStep[] | null }[]>`select job_plan from public.service_types where id = ${serviceTypeId} and tenant_id = ${tenantId}`);
  const read = readAgreementColumns(formData, { jobSteps: plan?.job_plan ?? null });
  if ("error" in read) back(returnTo, read.error);
  let id: string | null = null;
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const [terms] = await tx<{ agreement_terms: string | null }[]>`select agreement_terms from public.tenants where id = ${tenantId}`;
      const [row] = await tx<{ id: string }[]>`
        insert into public.agreements ${tx({
          tenant_id: tenantId,
          account_id: accountId,
          property_id: propertyId,
          service_type_id: serviceTypeId,
          branch_id: opt(formData, "branch_id"),
          quote_id: opt(formData, "quote_id"),
          quote_option_id: opt(formData, "quote_option_id"),
          ...read.value,
          cadence_rule: tx.json(read.value.cadence_rule),
          terms_text: read.value.terms_text ?? terms?.agreement_terms ?? null,
        })} returning id`;
      id = row.id;
    });
  } catch (err) {
    error = errorCode(err);
  }
  if (error || !id) back(returnTo, error ?? "failed");
  void membership;
  back(detail(id), null);
}

/** Edits the plan. A signed agreement keeps its account, property and service type; its planned visits regenerate. */
export async function updateAgreement(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const agreementId = str(formData, "agreement_id");
  const { session } = await requirePermission(tenantId, "agreements.write");
  const [plan] = await dbAs(session, (tx) => tx<{ job_plan: JobStep[] | null }[]>`
    select st.job_plan from public.service_types st join public.agreements a on a.service_type_id = st.id where a.id = ${agreementId} and a.tenant_id = ${tenantId}`);
  const read = readAgreementColumns(formData, { jobSteps: plan?.job_plan ?? null });
  if ("error" in read) back(detail(agreementId), read.error);
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const [current] = await tx<{ status: string }[]>`select status from public.agreements where id = ${agreementId} and tenant_id = ${tenantId}`;
      if (!current) throw new Error("not found");
      if (!["draft", "active", "on_hold"].includes(current.status)) throw Object.assign(new Error("a cancelled or ended agreement does not change"), { code: "23514" });
      const columns: Record<string, unknown> = { ...read.value, cadence_rule: tx.json(read.value.cadence_rule) };
      if (current.status === "draft") {
        columns.service_type_id = str(formData, "service_type_id") || undefined;
        columns.property_id = str(formData, "property_id") || undefined;
        for (const key of Object.keys(columns)) if (columns[key] === undefined) delete columns[key];
      }
      await tx`update public.agreements set ${tx(columns)} where id = ${agreementId} and tenant_id = ${tenantId}`;
      if (current.status !== "draft") await syncVisits(tx, tenantId, agreementId);
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(detail(agreementId), error);
}

/** The customer signs: typed name, agreement to the terms and consent to electronic notices (rule 3). */
export async function signAgreement(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const agreementId = str(formData, "agreement_id");
  const { session, membership } = await requirePermission(tenantId, "agreements.write");
  const signedName = str(formData, "signed_name");
  const contactId = opt(formData, "signed_by_contact_id");
  const agreed = formData.get("agree_terms") === "true";
  const consent = formData.get("consent_notices") === "true";
  if (!signedName || !agreed) back(detail(agreementId), "Signing needs the customer's typed name and agreement to the terms.");
  const ip = await requesterIp();
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const [current] = await tx<{ status: string; number: number; signed_at: string | null; terms_text: string | null }[]>`
        select status, number, signed_at, terms_text from public.agreements where id = ${agreementId} and tenant_id = ${tenantId}`;
      if (!current) throw new Error("not found");
      if (current.signed_at) throw Object.assign(new Error("this agreement is already signed"), { code: "23514" });
      if (!current.terms_text?.trim()) throw Object.assign(new Error("this agreement has no terms to agree to; add them to the agreement or set the company's terms under Settings"), { code: "23514" });
      await tx`
        update public.agreements set status = 'active', signed_at = now(), signed_name = ${signedName}, signed_by_contact_id = ${contactId}, signed_ip = ${ip}
        where id = ${agreementId} and tenant_id = ${tenantId}`;
      await syncVisits(tx, tenantId, agreementId);
      // Annual prepay bills at signing when the term has started (spec 08 rule 4); installments wait for the job.
      await issuePrepayments(tx, tenantId, todayInZone(membership.tenantTimezone), membership.tenantTimezone);
      if (consent && contactId) {
        await tx`
          update public.contacts set e_notice_consent_at = coalesce(e_notice_consent_at, now()),
                 e_notice_consent_note = coalesce(e_notice_consent_note, ${`e-signed agreement #${current.number}`})
          where id = ${contactId} and tenant_id = ${tenantId}`;
      }
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(detail(agreementId), error);
}

export async function bookReservice(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const agreementId = str(formData, "agreement_id");
  const { session, membership } = await requirePermission(tenantId, "agreements.write");
  const reason = str(formData, "reservice_reason");
  const dueStart = opt(formData, "due_start") ?? todayInZone(membership.tenantTimezone);
  if (!reason) back(detail(agreementId), "Say what the customer is seeing, so the technician knows what to treat.");
  if (!isIsoDate(dueStart)) back(detail(agreementId), "The re-service date is not a date.");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => bookReserviceRow(tx, tenantId, agreementId, reason, dueStart, addDays(dueStart, 6)));
  } catch (err) {
    error = errorCode(err);
  }
  back(detail(agreementId), error);
}

export async function changeAgreementPrice(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const agreementId = str(formData, "agreement_id");
  const { session, membership } = await requirePermission(tenantId, "agreements.write");
  const newPrice = parseDollarsToCents(str(formData, "new_recurring_price"));
  const effectiveOn = opt(formData, "effective_on") ?? todayInZone(membership.tenantTimezone);
  if (newPrice === null) back(detail(agreementId), "The new price is dollars and cents.");
  if (!isIsoDate(effectiveOn)) back(detail(agreementId), "The effective date is not a date.");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => changeRecurringPrice(tx, tenantId, agreementId, newPrice, effectiveOn, "manual"));
  } catch (err) {
    error = errorCode(err);
  }
  back(detail(agreementId), error);
}

export async function renewAgreement(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const agreementId = str(formData, "agreement_id");
  const { session } = await requirePermission(tenantId, "agreements.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => renewRow(tx, tenantId, agreementId));
  } catch (err) {
    error = errorCode(err);
  }
  back(detail(agreementId), error);
}

export async function runAutoRenewals(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session, membership } = await requirePermission(tenantId, "agreements.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => maintainTerms(tx, tenantId, todayInZone(membership.tenantTimezone)));
  } catch (err) {
    error = errorCode(err);
  }
  back(`${LIST}?view=renewals`, error);
}

export async function cancelAgreement(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const agreementId = str(formData, "agreement_id");
  const { session, membership } = await requirePermission(tenantId, "agreements.write");
  const effectiveOn = opt(formData, "effective_on") ?? todayInZone(membership.tenantTimezone);
  const reasonId = opt(formData, "cancel_reason_id");
  const saveOutcome = opt(formData, "save_outcome");
  if (!isIsoDate(effectiveOn)) back(detail(agreementId), "The cancellation date is not a date.");
  if (saveOutcome && saveOutcome !== "saved" && saveOutcome !== "lost") back(detail(agreementId), "The save outcome is saved or lost.");
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      // The day the last visit was actually done, not the start of its window.
      const [current] = await tx<{ status: string; last_completed: string | null }[]>`
        select a.status, (select max(coalesce(v.scheduled_for, v.due_start))::text from public.visits v where v.agreement_id = a.id and v.status = 'completed') as last_completed
        from public.agreements a where a.id = ${agreementId} and a.tenant_id = ${tenantId}`;
      if (!current) throw new Error("not found");
      if (current.status !== "draft" && !reasonId) throw Object.assign(new Error("cancelling an agreement needs a reason"), { code: "23514" });
      if (current.last_completed && effectiveOn < current.last_completed) throw Object.assign(new Error("the cancellation date cannot be before the last completed visit"), { code: "23514" });
      // The settlement the preview promised becomes money: a final invoice, or a credit memo and refund (spec 08 rule 12).
      // It settles before the visits are cancelled, so the plan it reads is the plan the preview read.
      if (current.status === "active" || current.status === "on_hold") await settleCancellation(tx, tenantId, agreementId, effectiveOn, session.userId);
      await cancelRow(tx, tenantId, agreementId, {
        effectiveOn,
        reasonId,
        note: opt(formData, "cancel_note"),
        saveOfferMade: formData.get("save_offer_made") === "true",
        saveOutcome: (saveOutcome as "saved" | "lost" | null) ?? null,
      });
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(detail(agreementId), error);
}

export async function createCancelReason(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "agreements.write");
  const name = str(formData, "name");
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (!name || !key) back(`${LIST}?view=reasons`, "A reason needs a name.");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`insert into public.cancel_reasons (tenant_id, key, name) values (${tenantId}, ${key}, ${name})`);
  } catch (err) {
    error = errorCode(err);
  }
  back(`${LIST}?view=reasons`, error);
}

export async function toggleCancelReason(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const reasonId = str(formData, "reason_id");
  const active = formData.get("active") === "true";
  const { session } = await requirePermission(tenantId, "agreements.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`update public.cancel_reasons set active = ${active} where id = ${reasonId} and tenant_id = ${tenantId}`);
  } catch (err) {
    error = errorCode(err);
  }
  back(`${LIST}?view=reasons`, error);
}

const INCREASES = `${LIST}/price-increases`;

/** Saves a bulk increase without applying it, so the page can show what it would change. */
export async function createPriceIncrease(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "agreements.write");
  const kind = str(formData, "kind");
  const effectiveOn = str(formData, "effective_on");
  const percent = str(formData, "percent");
  const amount = parseDollarsToCents(str(formData, "amount") || "0");
  const rounding = str(formData, "rounding") === "dollar" ? "dollar" : "cent";
  if (!["percent", "amount"].includes(kind)) back(INCREASES, "Pick a percent or an amount.");
  if (!isIsoDate(effectiveOn)) back(INCREASES, "An effective date is required.");
  if (kind === "percent" && !(Number(percent) > 0)) back(INCREASES, "The percent must be above zero.");
  if (kind === "amount" && !(amount !== null && amount > 0)) back(INCREASES, "The amount must be above zero.");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) =>
      tx`insert into public.price_increases ${tx({
        tenant_id: tenantId,
        kind,
        percent: kind === "percent" ? percent : null,
        amount_cents: kind === "amount" ? amount : null,
        effective_on: effectiveOn,
        service_type_id: opt(formData, "service_type_id"),
        branch_id: opt(formData, "branch_id"),
        billing_mode: opt(formData, "billing_mode"),
        rounding,
        notes: opt(formData, "notes"),
      })}`,
    );
  } catch (err) {
    error = errorCode(err);
  }
  back(INCREASES, error);
}

export async function applyPriceIncrease(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const increaseId = str(formData, "increase_id");
  const { session } = await requirePermission(tenantId, "agreements.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => applyIncrease(tx, tenantId, increaseId));
  } catch (err) {
    error = errorCode(err);
  }
  back(INCREASES, error);
}

export async function deletePriceIncrease(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const increaseId = str(formData, "increase_id");
  const { session } = await requirePermission(tenantId, "agreements.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`delete from public.price_increases where id = ${increaseId} and tenant_id = ${tenantId} and applied_at is null`);
  } catch (err) {
    error = errorCode(err);
  }
  back(INCREASES, error);
}

export async function updateAgreementTerms(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "settings.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`update public.tenants set agreement_terms = ${opt(formData, "agreement_terms")} where id = ${tenantId}`);
  } catch (err) {
    error = errorCode(err);
  }
  revalidatePath("/settings/terms");
  redirect(error ? `/settings/terms?error=${encodeURIComponent(error)}` : "/settings/terms");
}

/** Lets the "edit a draft" form reuse the create validation without a database round trip. */
export async function previewPlanIssues(formData: FormData): Promise<string | null> {
  const read = readAgreementColumns(formData);
  return "error" in read ? read.error : null;
}

export { intOrNull as _agreementIntOrNull };

/** Spec 15 rule 3: the landowner's written authorization for a wildlife job, with the signed form when there is one. */
export async function recordAuthorization(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const agreementId = str(formData, "agreement_id");
  const ctx = await requireMembership(tenantId);
  const perms = ctx.membership.permissions;
  if (!(can(perms, "customers.write") || can(perms, "agreements.write") || can(perms, "dispatch.write"))) back(detail(agreementId), "forbidden");
  const signer = str(formData, "signer_name").trim();
  const relationship = str(formData, "relationship");
  const signedOn = str(formData, "signed_on");
  if (!signer || !(RELATIONSHIPS as readonly string[]).includes(relationship) || !isIsoDate(signedOn)) back(detail(agreementId), "An authorization needs who signed, their relationship to the property and the date.");
  const file = formData.get("file");
  let upload: { type: string; data: Uint8Array } | null = null;
  if (file instanceof File && file.size > 0) {
    const data = new Uint8Array(await file.arrayBuffer());
    const type = signedFormType(data);
    if (!type) back(detail(agreementId), "The signed form is a PDF, PNG, JPEG or WebP file.");
    upload = { type: type!, data };
  }
  let error: string | null = null;
  try {
    await dbAs(ctx.session, async (tx) => {
      const fileId = upload ? await putFile(tx, tenantId, { kind: "document", contentType: upload.type, data: upload.data }) : null;
      await tx`insert into public.job_authorizations (tenant_id, agreement_id, signer_name, relationship, signed_on, scope, file_id)
               values (${tenantId}, ${agreementId}, ${signer}, ${relationship}, ${signedOn}, ${opt(formData, "scope")}, ${fileId})`;
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(detail(agreementId), error);
}

/** A signed form's type read from its bytes: a PDF or a raster image, never anything that could run in the browser. */
function signedFormType(data: Uint8Array): string | null {
  if (data.length > 4 && data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) return "application/pdf";
  return imageInfo(data)?.type ?? null;
}
