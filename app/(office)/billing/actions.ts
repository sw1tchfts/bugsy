"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { addPaymentMethod, chargeInvoice, createInvoice, ensureSettings, issueInvoice, loadSettings, recordPayment, refundPayment, runBilling, voidInvoice } from "@/lib/billing/db";
import { intOrNull, opt, str } from "@/lib/customers/forms";
import { fromTenantLocal, isIsoDate, todayInZone } from "@/lib/dates";
import { errorCode } from "@/lib/db";
import { parseDollarsToCents } from "@/lib/money";
import { gatewayFor } from "@/lib/payments";
import { stripeConfigured } from "@/lib/payments/stripe";
import { paymentToken } from "@/lib/payments/token";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

const HOME = "/billing";

function go(path: string, params: Record<string, string | null | undefined>): never {
  revalidatePath(HOME);
  revalidatePath(path.split("?")[0]);
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) query.set(k, v);
  const q = query.toString();
  redirect(`${path}${q ? `?${q}` : ""}`);
}

const invoicePage = (id: string) => `${HOME}/invoices/${id}`;
const accountPage = (id: string) => `${HOME}/accounts/${id}`;

/** Runs the billing job for this company now. */
export async function runBillingNow(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "billing.write");
  const { active } = await requireActiveTenant();
  let note: string | null = null;
  let error: string | null = null;
  try {
    const c = await dbAs(session, (tx) => runBilling(tx, tenantId, active.tenantTimezone, new Date(), session.userId, { reclass: can(active.permissions, "gl.write"), payouts: true }));
    const posted = c.ledger.invoices + c.ledger.voids + c.ledger.visits + c.ledger.product_uses + c.ledger.payments + c.ledger.refunds + c.ledger.payouts + c.ledger.local_payouts + c.ledger.reclasses;
    note = `Job run: ${c.visits + c.installments + c.prepayments} invoice(s) issued, ${c.charged} autopay charge(s), ${c.failed} failed, ${c.statuses} status change(s), ${c.late_fees} late fee(s), ${posted} journal entr${posted === 1 ? "y" : "ies"} posted by the sweep.`;
  } catch (err) {
    error = errorCode(err);
  }
  go(HOME, { note, error });
}

/** Issues a draft: tax for today, the next number, the due date from the account's terms. */
export async function issueDraft(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const invoiceId = str(formData, "invoice_id");
  const { session } = await requirePermission(tenantId, "billing.write");
  const { active } = await requireActiveTenant();
  let error: string | null = null;
  try {
    const issued = await dbAs(session, (tx) => issueInvoice(tx, tenantId, invoiceId, todayInZone(active.tenantTimezone)));
    if (!issued) error = "This invoice is already issued.";
  } catch (err) {
    error = errorCode(err);
  }
  go(invoicePage(invoiceId), { error });
}

export async function setPoNumber(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const invoiceId = str(formData, "invoice_id");
  const po = opt(formData, "po_number");
  const { session } = await requirePermission(tenantId, "billing.write");
  let error: string | null = null;
  try {
    const result = await dbAs(session, (tx) => tx`update public.invoices set po_number = ${po} where id = ${invoiceId} and tenant_id = ${tenantId}`);
    if (result.count === 0) error = "Invoice not found.";
  } catch (err) {
    error = errorCode(err);
  }
  go(invoicePage(invoiceId), { error });
}

export async function voidInvoiceAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const invoiceId = str(formData, "invoice_id");
  const reason = str(formData, "reason").trim();
  const { session } = await requirePermission(tenantId, "billing.write");
  let error: string | null = null;
  if (!reason) error = "Voiding needs a reason.";
  else {
    try {
      await dbAs(session, (tx) => voidInvoice(tx, tenantId, invoiceId, reason, session.userId));
    } catch (err) {
      error = errorCode(err);
    }
  }
  go(invoicePage(invoiceId), { error });
}

/** A cash, check or other payment from the office, allocated oldest due first or to one invoice. */
export async function recordPaymentAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const accountId = str(formData, "account_id");
  const invoiceId = opt(formData, "invoice_id");
  const method = str(formData, "method");
  const amount = parseDollarsToCents(str(formData, "amount"));
  const receivedWall = opt(formData, "received_on");
  const returnTo = invoiceId ? invoicePage(invoiceId) : accountPage(accountId);
  const { session } = await requirePermission(tenantId, "billing.write");
  const { active } = await requireActiveTenant();
  let error: string | null = null;
  if (!["cash", "check", "other"].includes(method)) error = "Pick cash, check or other.";
  else if (amount === null || amount <= 0) error = "The amount is dollars and cents, for example 99.00.";
  else {
    const received = receivedWall ? fromTenantLocal(receivedWall, active.tenantTimezone) : new Date();
    if (!received) error = "The received date does not parse.";
    else {
      try {
        await dbAs(session, (tx) =>
          recordPayment(tx, tenantId, { account_id: accountId, method: method as "cash" | "check" | "other", amount_cents: amount, received_at: received, reference: opt(formData, "reference"), memo: opt(formData, "memo"), recorded_by: session.userId, invoice_id: invoiceId ?? null }),
        );
      } catch (err) {
        error = errorCode(err);
      }
    }
  }
  go(returnTo, { error });
}

/** Charges a saved method for an open invoice from the office. */
export async function chargeInvoiceAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const invoiceId = str(formData, "invoice_id");
  const methodId = opt(formData, "payment_method_id");
  const { session } = await requirePermission(tenantId, "billing.write");
  let error: string | null = null;
  let note: string | null = null;
  try {
    const outcome = await dbAs(session, (tx) => chargeInvoice(tx, tenantId, invoiceId, { payment_method_id: methodId, idempotency_key: `charge:${invoiceId}:${crypto.randomUUID()}`, recorded_by: session.userId }));
    if (outcome.ok) note = "Charged.";
    else error = `The charge did not go through: ${outcome.error ?? "unknown"}.`;
  } catch (err) {
    error = errorCode(err);
  }
  go(invoicePage(invoiceId), { error, note });
}

export async function refundPaymentAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const paymentId = str(formData, "payment_id");
  const accountId = str(formData, "account_id");
  const amount = parseDollarsToCents(str(formData, "amount"));
  const returnTo = opt(formData, "return_to") ?? accountPage(accountId);
  const { session } = await requirePermission(tenantId, "billing.write");
  let error: string | null = null;
  if (amount === null || amount <= 0) error = "The refund is dollars and cents.";
  else {
    try {
      await dbAs(session, (tx) => refundPayment(tx, tenantId, paymentId, amount, opt(formData, "memo"), session.userId));
    } catch (err) {
      error = errorCode(err);
    }
  }
  go(returnTo, { error });
}

/** A card or bank account for the customer: Stripe's field hands over a payment method id; the local gateway takes the digits. */
export async function addPaymentMethodAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const accountId = str(formData, "account_id");
  const autopay = formData.get("autopay") === "true";
  const { session } = await requirePermission(tenantId, "billing.write");
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const settings = await loadSettings(tx, tenantId);
      const t = paymentToken(gatewayFor(settings).kind, {
        kind: opt(formData, "kind"),
        number: opt(formData, "number"),
        month: opt(formData, "exp_month"),
        year: opt(formData, "exp_year"),
        token: opt(formData, "payment_token"),
      });
      if (!t.ok) throw Object.assign(new Error(t.error), { code: "23514" });
      if (!t.token) throw Object.assign(new Error("Enter the card or account."), { code: "23514" });
      await addPaymentMethod(tx, tenantId, { account_id: accountId, token: t.token, autopay, added_by: session.userId });
    });
  } catch (err) {
    error = errorCode(err);
  }
  go(accountPage(accountId), { error });
}

export async function setAutopay(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const accountId = str(formData, "account_id");
  const methodId = str(formData, "payment_method_id");
  const on = formData.get("autopay") === "true";
  const { session } = await requirePermission(tenantId, "billing.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`update public.payment_methods set autopay = ${on}, is_default = case when ${on} then true else is_default end where id = ${methodId} and tenant_id = ${tenantId} and account_id = ${accountId}`);
  } catch (err) {
    error = errorCode(err);
  }
  go(accountPage(accountId), { error });
}

export async function removePaymentMethod(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const accountId = str(formData, "account_id");
  const methodId = str(formData, "payment_method_id");
  const { session } = await requirePermission(tenantId, "billing.write");
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const [m] = await tx<{ gateway_payment_method_id: string }[]>`select gateway_payment_method_id from public.payment_methods where id = ${methodId} and tenant_id = ${tenantId}`;
      const settings = await ensureSettings(tx, tenantId);
      if (m) await gatewayFor(settings).detachPaymentMethod({ account_id: settings.gateway_account_id, gateway_payment_method_id: m.gateway_payment_method_id });
      await tx`update public.payment_methods set status = 'removed', autopay = false, is_default = false where id = ${methodId} and tenant_id = ${tenantId} and account_id = ${accountId}`;
    });
  } catch (err) {
    error = errorCode(err);
  }
  go(accountPage(accountId), { error });
}

export async function saveBillingSettings(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "billing.write");
  const lateFee = parseDollarsToCents(str(formData, "late_fee") || "0");
  const percent = Number(str(formData, "late_fee_percent") || "0");
  const grace = intOrNull(formData, "grace_days") ?? 0;
  const retry = str(formData, "retry_days").split(/[,\s]+/).map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0);
  let error: string | null = null;
  if (lateFee === null || lateFee < 0) error = "The late fee is dollars and cents.";
  else if (!Number.isFinite(percent) || percent < 0 || percent > 100) error = "The late fee percent is between 0 and 100.";
  else if (grace < 0 || grace > 90) error = "Grace days are between 0 and 90.";
  else {
    try {
      await dbAs(session, async (tx) => {
        await ensureSettings(tx, tenantId);
        await tx`update public.billing_settings set late_fee_cents = ${lateFee}, late_fee_percent = ${percent}, grace_days = ${grace}, pause_when_past_due = ${formData.get("pause_when_past_due") === "true"},
                 autopay_retry_days = ${retry.length ? retry : [3, 7]}, invoice_footer = ${opt(formData, "invoice_footer")} where tenant_id = ${tenantId}`;
      });
    } catch (err) {
      error = errorCode(err);
    }
  }
  go(`${HOME}/settings`, { error });
}

/** Connects the company's Stripe account when keys exist; the local gateway otherwise. */
export async function connectGateway(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "billing.write");
  const { active } = await requireActiveTenant();
  let error: string | null = null;
  let onboarding: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const settings = await ensureSettings(tx, tenantId);
      const kind = stripeConfigured() ? "stripe" : "local";
      await tx`update public.billing_settings set gateway = ${kind} where tenant_id = ${tenantId}`;
      const gateway = gatewayFor({ gateway: kind });
      const [tenant] = await tx<{ name: string }[]>`select name from public.tenants where id = ${tenantId}`;
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:3000";
      const account = settings.gateway_account_id && settings.gateway === kind
        ? { account_id: settings.gateway_account_id, onboarding_url: null }
        : await gateway.connectAccount({ id: tenantId, name: tenant?.name ?? active.tenantName, email: session.email ?? null, return_url: `${base}/billing/settings`, refresh_url: `${base}/billing/settings` });
      await tx`update public.billing_settings set gateway_account_id = ${account.account_id}, gateway_onboarded_at = case when ${kind === "local"} then coalesce(gateway_onboarded_at, now()) else gateway_onboarded_at end where tenant_id = ${tenantId}`;
      onboarding = account.onboarding_url;
    });
  } catch (err) {
    error = errorCode(err);
  }
  if (onboarding) redirect(onboarding);
  go(`${HOME}/settings`, { error });
}

export async function setTaxExemption(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const accountId = str(formData, "account_id");
  const number = opt(formData, "tax_exempt_number");
  const expires = opt(formData, "tax_exempt_expires_on");
  const { session } = await requirePermission(tenantId, "billing.write");
  let error: string | null = null;
  if (expires && !isIsoDate(expires)) error = "The expiry is a date.";
  else {
    try {
      await dbAs(session, (tx) => tx`select app.set_account_tax_exemption(${tenantId}, ${accountId}, ${number}, ${expires}, null)`);
    } catch (err) {
      error = errorCode(err);
    }
  }
  go(accountPage(accountId), { error });
}

/** A one-off invoice typed by the office: one or more lines, taxed by the service type when one is picked. */
export async function createManualInvoice(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const accountId = str(formData, "account_id");
  const propertyId = opt(formData, "property_id");
  const serviceTypeId = opt(formData, "service_type_id");
  const description = str(formData, "description").trim();
  const amount = parseDollarsToCents(str(formData, "amount"));
  const issueNow = formData.get("issue") === "true";
  const issuedOn = opt(formData, "issued_on");
  const { session } = await requirePermission(tenantId, "billing.write");
  const { active } = await requireActiveTenant();
  let error: string | null = null;
  let invoiceId: string | null = null;
  if (!description) error = "Describe the charge.";
  else if (amount === null || amount <= 0) error = "The amount is dollars and cents.";
  else if (issuedOn && !isIsoDate(issuedOn)) error = "The issue date is a date.";
  else {
    try {
      invoiceId = await dbAs(session, async (tx) => {
        const [st] = serviceTypeId ? await tx<{ service_line: string }[]>`select service_line from public.service_types where id = ${serviceTypeId} and tenant_id = ${tenantId}` : [];
        const made = await createInvoice(tx, tenantId, {
          account_id: accountId,
          property_id: propertyId ?? null,
          source: "manual",
          source_key: `manual:${crypto.randomUUID()}`,
          issued_on: issuedOn ?? todayInZone(active.tenantTimezone),
          memo: opt(formData, "memo"),
          po_number: opt(formData, "po_number"),
          lines: [{ description, amount_cents: amount, service_type_id: serviceTypeId ?? null, service_line: st?.service_line ?? null }],
          issue: issueNow,
        });
        return made.id;
      });
    } catch (err) {
      error = errorCode(err);
    }
  }
  go(invoiceId ? invoicePage(invoiceId) : accountPage(accountId), { error });
}
