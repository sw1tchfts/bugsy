// Billing against the database (spec 08): invoices born from the agreement's billing mode, tax from the property's
// state and address, payments and their allocations, autopay through the gateway, collections and the settlement
// of a cancellation. Every function takes the transaction it runs in; the job, the actions and the seed share them.
import type postgres from "postgres";
import { billingSchedule } from "@/lib/agreements/billing";
import { loadAgreement, settlementFor } from "@/lib/agreements/db";
import type { PlannedVisit } from "@/lib/agreements/visits";
import { nextAttempt } from "@/lib/billing/autopay";
import { dueOn, installmentsDue, invoiceStatus, invoiceTotals, lateFee } from "@/lib/billing/invoices";
import { settlementDocuments } from "@/lib/billing/settlement";
import { type Statement, type StatementAllocation, type StatementInvoice, type StatementPayment, statement } from "@/lib/billing/statement";
import { type TaxClass, type TaxRate, ratesInForce, taxClassFor, taxForLine } from "@/lib/billing/tax";
import { addDays, addMonths, dateInZone, todayInZone } from "@/lib/dates";
import { type LedgerCounts, type LedgerRunOptions, postInvoice, postPayment, postRefund, postStraightLineSettlement, postVoid, runLedger, tenantTimeZone } from "@/lib/ledger/db";
import { queueInvoiceEmail } from "@/lib/messaging/db";
import { safely } from "@/lib/messaging/safely";
import { gatewayFor } from "@/lib/payments";
import { platformFeeBps } from "@/lib/payments/gateway";

type Sql = postgres.Sql | postgres.TransactionSql;

export type Settings = {
  tenant_id: string;
  late_fee_cents: number;
  late_fee_percent: string;
  grace_days: number;
  pause_when_past_due: boolean;
  autopay_retry_days: number[];
  invoice_footer: string | null;
  gateway: "local" | "stripe";
  gateway_account_id: string | null;
  gateway_onboarded_at: string | null;
};

const DEFAULTS: Omit<Settings, "tenant_id"> = { late_fee_cents: 0, late_fee_percent: "0", grace_days: 0, pause_when_past_due: false, autopay_retry_days: [3, 7], invoice_footer: null, gateway: "local", gateway_account_id: null, gateway_onboarded_at: null };

function normalizeSettings(row: Record<string, unknown>): Settings {
  return {
    tenant_id: String(row.tenant_id),
    late_fee_cents: Number(row.late_fee_cents ?? 0),
    late_fee_percent: String(row.late_fee_percent ?? "0"),
    grace_days: Number(row.grace_days ?? 0),
    pause_when_past_due: Boolean(row.pause_when_past_due),
    autopay_retry_days: Array.isArray(row.autopay_retry_days) ? (row.autopay_retry_days as number[]).map(Number) : [3, 7],
    invoice_footer: (row.invoice_footer as string | null) ?? null,
    gateway: row.gateway === "stripe" ? "stripe" : "local",
    gateway_account_id: (row.gateway_account_id as string | null) ?? null,
    gateway_onboarded_at: (row.gateway_onboarded_at as string | null) ?? null,
  };
}

/** The company's billing settings, or the defaults when none are saved yet (reads never write). */
export async function loadSettings(tx: Sql, tenantId: string): Promise<Settings> {
  const [row] = await tx<Record<string, unknown>[]>`select * from public.billing_settings where tenant_id = ${tenantId}`;
  return row ? normalizeSettings(row) : { tenant_id: tenantId, ...DEFAULTS };
}

/** The settings row, created on first write. */
export async function ensureSettings(tx: Sql, tenantId: string): Promise<Settings> {
  // Insert only when missing: a customer paying in the portal reads the row but may not write it (spec 16).
  const [exists] = await tx<{ id: string }[]>`select id from public.billing_settings where tenant_id = ${tenantId}`;
  if (!exists) await tx`insert into public.billing_settings (tenant_id) values (${tenantId}) on conflict (tenant_id) do nothing`;
  return loadSettings(tx, tenantId);
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export type LineDraft = {
  description: string;
  amount_cents: number;
  agreement_id?: string | null;
  visit_id?: string | null;
  /** When set, the service type's tax class for the property's state decides the tax; otherwise the line is not taxed. */
  service_type_id?: string | null;
  service_line?: string | null;
  /** What the line is, for the ledger: service (the default), a cancellation fee, a late fee, or an opening balance. */
  kind?: "service" | "fee" | "late_fee" | "opening";
};

export type InvoiceDraft = {
  kind?: "invoice" | "credit_memo";
  account_id: string;
  property_id: string | null;
  agreement_id?: string | null;
  visit_id?: string | null;
  source: "visit" | "installment" | "prepay" | "settlement" | "late_fee" | "manual" | "opening" | "materials";
  source_key: string;
  /** The business date the invoice is issued on; the draft stays a draft when `issue` is false. */
  issued_on: string;
  /** An opening balance keeps the old invoice's due date instead of the account's terms (spec 10 rule 11). */
  due_on?: string | null;
  /** The old system's invoice number. */
  external_ref?: string | null;
  memo?: string | null;
  po_number?: string | null;
  lines: LineDraft[];
  issue: boolean;
};

type TaxContext = {
  state_code: string | null;
  postal_code: string | null;
  account: { terms_days: number; po_required: boolean; tax_exempt_number: string | null; tax_exempt_expires_on: string | null };
  rates: TaxRate[];
  classByServiceType: Map<string, string>;
};

async function taxContext(tx: Sql, tenantId: string, accountId: string, propertyId: string | null, onDate: string, serviceTypeIds: string[]): Promise<TaxContext> {
  const [account] = await tx<TaxContext["account"][]>`select terms_days, po_required, tax_exempt_number, tax_exempt_expires_on from public.accounts where id = ${accountId} and tenant_id = ${tenantId}`;
  if (!account) throw Object.assign(new Error("account not found"), { code: "23514" });
  const [property] = propertyId
    ? await tx<{ state_code: string; postal_code: string }[]>`select state_code, postal_code from public.properties where id = ${propertyId} and tenant_id = ${tenantId}`
    : await tx<{ state_code: string; postal_code: string }[]>`select billing_state_code as state_code, billing_postal_code as postal_code from public.accounts where id = ${accountId}`;
  const state = property?.state_code ?? null;
  const postal = property?.postal_code ?? null;
  const rates = state && postal ? await tx<TaxRate[]>`select id, state_code, postal_code, jurisdiction_kind, jurisdiction_name, rate::text, effective_from, effective_to from public.tax_rates where state_code = ${state} and postal_code = ${postal.slice(0, 5)}` : [];
  const classByServiceType = new Map<string, string>();
  if (state && serviceTypeIds.length) {
    const rules = await tx<{ service_type_id: string; tax_class: string }[]>`
      select service_type_id, tax_class from public.service_type_state_rules where tenant_id = ${tenantId} and state_code = ${state} and service_type_id = any(${serviceTypeIds}::uuid[])`;
    for (const r of rules) classByServiceType.set(r.service_type_id, r.tax_class);
  }
  return { state_code: state, postal_code: postal, account, rates, classByServiceType };
}

function taxedLines(lines: readonly LineDraft[], ctx: TaxContext, onDate: string) {
  const inForce = ctx.state_code && ctx.postal_code ? ratesInForce(ctx.rates, ctx.state_code, ctx.postal_code, onDate) : [];
  return lines.map((l, i) => {
    const rule = l.service_type_id ? { tax_class: ctx.classByServiceType.get(l.service_type_id) ?? "unknown" } : null;
    const tax_class: TaxClass = l.service_type_id ? taxClassFor(rule, ctx.account, onDate) : taxClassFor({ tax_class: "exempt" }, ctx.account, onDate);
    const tax = taxForLine({ amount_cents: l.amount_cents, tax_class, rates: inForce });
    return { position: i + 1, ...l, tax_class, tax_rate: tax.rate, tax_breakdown: tax.breakdown, tax_cents: tax.tax_cents };
  });
}

/** Creates an invoice (and issues it when asked); a second call with the same source key returns the first. */
export async function createInvoice(tx: Sql, tenantId: string, draft: InvoiceDraft): Promise<{ id: string; created: boolean }> {
  const [existing] = await tx<{ id: string }[]>`select id from public.invoices where tenant_id = ${tenantId} and source_key = ${draft.source_key}`;
  if (existing) return { id: existing.id, created: false };
  const ctx = await taxContext(tx, tenantId, draft.account_id, draft.property_id, draft.issued_on, draft.lines.map((l) => l.service_type_id).filter((id): id is string => Boolean(id)));
  const lines = taxedLines(draft.lines, ctx, draft.issued_on);
  const totals = invoiceTotals(lines);
  const [row] = await tx<{ id: string }[]>`
    insert into public.invoices ${tx({
      tenant_id: tenantId,
      kind: draft.kind ?? "invoice",
      account_id: draft.account_id,
      property_id: draft.property_id,
      agreement_id: draft.agreement_id ?? null,
      visit_id: draft.visit_id ?? null,
      status: "draft",
      terms_days: ctx.account.terms_days,
      po_number: draft.po_number ?? null,
      subtotal_cents: totals.subtotal_cents,
      tax_cents: totals.tax_cents,
      total_cents: totals.total_cents,
      memo: draft.memo ?? null,
      source: draft.source,
      source_key: draft.source_key,
      external_ref: draft.external_ref ?? null,
      tax_unconfirmed: lines.some((l) => l.tax_class === "unknown"),
    })}
    on conflict (tenant_id, source_key) do nothing returning id`;
  if (!row) {
    const [again] = await tx<{ id: string }[]>`select id from public.invoices where tenant_id = ${tenantId} and source_key = ${draft.source_key}`;
    return { id: again.id, created: false };
  }
  for (const l of lines) {
    await tx`insert into public.invoice_lines ${tx({
      tenant_id: tenantId,
      invoice_id: row.id,
      position: l.position,
      agreement_id: l.agreement_id ?? null,
      visit_id: l.visit_id ?? null,
      service_type_id: l.service_type_id ?? null,
      service_line: l.service_line ?? null,
      kind: l.kind ?? "service",
      description: l.description,
      amount_cents: l.amount_cents,
      tax_class: l.tax_class,
      tax_rate: l.tax_rate,
      tax_breakdown: tx.json(l.tax_breakdown),
      tax_cents: l.tax_cents,
    })}`;
  }
  // A PO-required account keeps the invoice as a draft until the office puts the PO number on it (rule 6); an opening
  // balance was the old system's invoice and issues as it was.
  if (draft.issue && (draft.source === "opening" || !(ctx.account.po_required && !draft.po_number))) await issueInvoice(tx, tenantId, row.id, draft.issued_on, draft.due_on ?? null);
  return { id: row.id, created: true };
}

/** Draft to issued: tax recomputed for the issue date, then the number and due date come from the trigger. */
export async function issueInvoice(tx: Sql, tenantId: string, invoiceId: string, issuedOn: string, dueOnOverride: string | null = null): Promise<boolean> {
  const [inv] = await tx<{ status: string; account_id: string; property_id: string | null; terms_days: number; po_number: string | null; kind: string; source: string }[]>`
    select status, account_id, property_id, terms_days, po_number, kind, source from public.invoices where id = ${invoiceId} and tenant_id = ${tenantId}`;
  if (!inv || inv.status !== "draft") return false;
  const [account] = await tx<{ po_required: boolean; terms_days: number }[]>`select po_required, terms_days from public.accounts where id = ${inv.account_id}`;
  if (account?.po_required && !inv.po_number && inv.source !== "opening") throw Object.assign(new Error("this account needs a PO number on every invoice"), { code: "23514" });
  const lines = await tx<{ id: string; description: string; amount_cents: string | number; agreement_id: string | null; visit_id: string | null; service_type_id: string | null; service_line: string | null }[]>`
    select id, description, amount_cents, agreement_id, visit_id, service_type_id, service_line from public.invoice_lines where invoice_id = ${invoiceId} order by position`;
  const ctx = await taxContext(tx, tenantId, inv.account_id, inv.property_id, issuedOn, lines.map((l) => l.service_type_id).filter((id): id is string => Boolean(id)));
  const taxed = taxedLines(lines.map((l) => ({ ...l, amount_cents: Number(l.amount_cents) })), ctx, issuedOn);
  for (const [i, l] of taxed.entries()) {
    await tx`update public.invoice_lines set tax_class = ${l.tax_class}, tax_rate = ${l.tax_rate}, tax_breakdown = ${tx.json(l.tax_breakdown)}, tax_cents = ${l.tax_cents} where id = ${lines[i].id}`;
  }
  const totals = invoiceTotals(taxed);
  await tx`
    update public.invoices
    set status = 'issued', issued_on = ${issuedOn}, due_on = ${dueOnOverride ?? dueOn(issuedOn, account?.terms_days ?? inv.terms_days)}, terms_days = ${account?.terms_days ?? inv.terms_days},
        subtotal_cents = ${totals.subtotal_cents}, tax_cents = ${totals.tax_cents}, total_cents = ${totals.total_cents}, tax_unconfirmed = ${taxed.some((l) => l.tax_class === "unknown")}
    where id = ${invoiceId} and tenant_id = ${tenantId} and status = 'draft'`;
  // The books follow in the same transaction (spec 09 rule 2), and the customer gets the invoice by email (spec 11).
  await postInvoice(tx, tenantId, invoiceId);
  await safely(tx, "invoice email", (t) => queueInvoiceEmail(t, tenantId, invoiceId));
  return true;
}

export async function voidInvoice(tx: Sql, tenantId: string, invoiceId: string, reason: string, userId: string | null): Promise<void> {
  const result = await tx`update public.invoices set status = 'void', void_reason = ${reason}, voided_by = ${userId} where id = ${invoiceId} and tenant_id = ${tenantId} and status <> 'void'`;
  if (result.count === 0) throw Object.assign(new Error("invoice not found or already void"), { code: "23514" });
  await postVoid(tx, tenantId, invoiceId, todayInZone(await tenantTimeZone(tx, tenantId)));
}

type VisitForInvoice = {
  id: string;
  sequence: number;
  kind: string;
  price_cents: string | number;
  account_id: string;
  property_id: string;
  agreement_id: string | null;
  service_type_id: string;
  service_type_name: string;
  service_line: string;
  billing_mode: string | null;
  departed_at: string | null;
  completed_at: string | null;
  status: string;
  imported: boolean;
};

/** The per-visit invoice at completion (rule 2): only priced visits on per-visit agreements, or one-time visits. */
export async function invoiceForVisit(tx: Sql, tenantId: string, visitId: string, timeZone: string): Promise<{ id: string; created: boolean } | null> {
  const [v] = await tx<VisitForInvoice[]>`
    select v.id, v.sequence, v.kind, v.price_cents, v.account_id, v.property_id, v.agreement_id, v.service_type_id, st.name as service_type_name, st.service_line,
           ag.billing_mode, v.departed_at, v.completed_at, v.status, v.imported
    from public.visits v join public.service_types st on st.id = v.service_type_id left join lateral app.visit_agreement(v.id) ag on true
    where v.id = ${visitId} and v.tenant_id = ${tenantId}`;
  // A visit done before Bugsy was billed by the old system (spec 10 rule 8).
  if (!v || v.status !== "completed" || v.imported || Number(v.price_cents) <= 0) return null;
  // The completion runs under the technician's session, which cannot read agreements: app.visit_agreement answers for
  // the crew. An agreement whose mode is still unknown is not billed per visit.
  if (v.agreement_id && v.billing_mode !== "per_visit") return null;
  const issuedOn = dateInZone(v.departed_at ?? v.completed_at ?? new Date(), timeZone);
  return createInvoice(tx, tenantId, {
    account_id: v.account_id,
    property_id: v.property_id,
    agreement_id: v.agreement_id,
    visit_id: v.id,
    source: "visit",
    source_key: `visit:${v.id}`,
    issued_on: issuedOn,
    lines: [{ description: `${v.service_type_name}, visit ${v.sequence} on ${issuedOn}`, amount_cents: Number(v.price_cents), agreement_id: v.agreement_id, visit_id: v.id, service_type_id: v.service_type_id, service_line: v.service_line }],
    issue: true,
  });
}

async function plannedFor(tx: Sql, tenantId: string, agreementId: string): Promise<PlannedVisit[]> {
  const visits = await tx<{ kind: string; sequence: number; due_start: string; due_end: string; price_cents: string | number; status: string }[]>`
    select kind, sequence, due_start, due_end, price_cents, status from public.visits where agreement_id = ${agreementId} and tenant_id = ${tenantId} order by sequence`;
  return visits
    .filter((v) => (v.kind === "initial" || v.kind === "recurring") && v.status !== "cancelled" && v.status !== "skipped")
    .map((v) => ({ kind: v.kind as "initial" | "recurring", sequence: v.sequence, due_start: v.due_start, due_end: v.due_end, price_cents: Number(v.price_cents), interior_only: false }));
}

type AgreementBilling = { id: string; number: number; account_id: string; property_id: string; service_type_id: string; service_type_name: string; service_line: string; billing_mode: string; starts_on: string; term_months: number; renewals: number; signed_at: string | null; cancelled_on: string | null; cutover_on: string | null };

/** Signed agreements on the mode, cancelled ones included: their installments up to the cancellation date still bill (rule 3). */
async function agreementsToBill(tx: Sql, tenantId: string, mode: "flat_monthly" | "annual_prepay", agreementId: string | null = null): Promise<AgreementBilling[]> {
  return tx<AgreementBilling[]>`
    select a.id, a.number, a.account_id, a.property_id, a.service_type_id, st.name as service_type_name, st.service_line, a.billing_mode, a.starts_on, a.term_months, a.renewals, a.signed_at, a.cancelled_on, a.cutover_on
    from public.agreements a join public.service_types st on st.id = a.service_type_id
    where a.tenant_id = ${tenantId} and a.billing_mode = ${mode} and a.status in ('active', 'ended', 'cancelled') and a.signed_at is not null
      and (${agreementId}::uuid is null or a.id = ${agreementId}::uuid)`;
}

/** Flat monthly: one invoice per installment whose date has come (rule 3). */
export async function issueInstallments(tx: Sql, tenantId: string, today: string, agreementId: string | null = null): Promise<number> {
  let created = 0;
  for (const a of await agreementsToBill(tx, tenantId, "flat_monthly", agreementId)) {
    const planned = await plannedFor(tx, tenantId, a.id);
    const schedule = billingSchedule({ billing_mode: "flat_monthly", starts_on: a.starts_on, term_months: a.term_months, renewals: a.renewals }, planned);
    const count = schedule.length;
    for (const due of installmentsDue(a.id, schedule, today)) {
      if (a.cancelled_on && due.date > a.cancelled_on) continue;
      // Installments before an imported agreement's go-live were billed by the old system (spec 10 rule 8).
      if (a.cutover_on && due.date < a.cutover_on) continue;
      const made = await createInvoice(tx, tenantId, {
        account_id: a.account_id,
        property_id: a.property_id,
        agreement_id: a.id,
        source: "installment",
        source_key: due.source_key,
        issued_on: due.date,
        lines: [{ description: `${a.service_type_name}: installment ${due.index + 1} of ${count} (agreement #${a.number})`, amount_cents: due.amount_cents, agreement_id: a.id, service_type_id: a.service_type_id, service_line: a.service_line }],
        issue: true,
      });
      if (made.created) created += 1;
    }
  }
  return created;
}

/** Annual prepay: the term's total on its start date or at signing, one invoice per term (rule 4). */
export async function issuePrepayments(tx: Sql, tenantId: string, today: string, timeZone: string): Promise<number> {
  let created = 0;
  for (const a of await agreementsToBill(tx, tenantId, "annual_prepay")) {
    const planned = await plannedFor(tx, tenantId, a.id);
    const signedOn = a.signed_at ? dateInZone(a.signed_at, timeZone) : a.starts_on;
    for (let term = 0; term <= a.renewals; term += 1) {
      const termStart = addMonths(a.starts_on, term * a.term_months);
      const termEnd = addDays(addMonths(a.starts_on, (term + 1) * a.term_months), -1);
      const total = planned.filter((v) => v.due_start >= termStart && v.due_start <= termEnd).reduce((sum, v) => sum + v.price_cents, 0);
      const issuedOn = termStart > signedOn ? termStart : signedOn;
      if (total <= 0 || issuedOn > today) continue;
      if (a.cancelled_on && termStart > a.cancelled_on) continue;
      if (a.cutover_on && termStart < a.cutover_on) continue;
      const made = await createInvoice(tx, tenantId, {
        account_id: a.account_id,
        property_id: a.property_id,
        agreement_id: a.id,
        source: "prepay",
        source_key: term === 0 ? `prepay:${a.id}` : `prepay:${a.id}:${term}`,
        issued_on: issuedOn,
        lines: [{ description: `${a.service_type_name}: prepaid term ${termStart} to ${termEnd} (agreement #${a.number})`, amount_cents: total, agreement_id: a.id, service_type_id: a.service_type_id, service_line: a.service_line }],
        issue: true,
      });
      if (made.created) created += 1;
    }
  }
  return created;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export type OpenInvoice = { id: string; number: number | null; due_on: string; total_cents: number; paid_cents: number; open_cents: number };

export async function openInvoices(tx: Sql, tenantId: string, accountId: string): Promise<OpenInvoice[]> {
  const rows = await tx<{ id: string; number: number | null; due_on: string; total_cents: string | number; paid_cents: string | number }[]>`
    select id, number, due_on, total_cents, paid_cents from public.invoices
    where tenant_id = ${tenantId} and account_id = ${accountId} and kind = 'invoice' and status in ('issued', 'partially_paid', 'past_due') and total_cents > paid_cents
    order by due_on, issued_on, number`;
  return rows.map((r) => ({ id: r.id, number: r.number, due_on: r.due_on, total_cents: Number(r.total_cents), paid_cents: Number(r.paid_cents), open_cents: Number(r.total_cents) - Number(r.paid_cents) }));
}

async function allocate(tx: Sql, tenantId: string, paymentId: string, accountId: string, amountCents: number, invoiceId: string | null): Promise<number> {
  let left = amountCents;
  const targets = invoiceId ? (await openInvoices(tx, tenantId, accountId)).filter((i) => i.id === invoiceId) : await openInvoices(tx, tenantId, accountId);
  let allocated = 0;
  for (const inv of targets) {
    if (left <= 0) break;
    const amount = Math.min(left, inv.open_cents);
    if (amount <= 0) continue;
    await tx`insert into public.payment_allocations (tenant_id, payment_id, invoice_id, amount_cents) values (${tenantId}, ${paymentId}, ${inv.id}, ${amount})`;
    left -= amount;
    allocated += amount;
  }
  return allocated;
}

export type PaymentInput = {
  account_id: string;
  method: "cash" | "check" | "other";
  amount_cents: number;
  received_at: Date;
  reference?: string | null;
  memo?: string | null;
  visit_id?: string | null;
  recorded_by: string | null;
  /** Allocate to this invoice only (the stop's own invoice for a technician), else oldest due first. */
  invoice_id?: string | null;
  /** False leaves the money as credit on the account (a stop with no invoice of its own); the job applies it later. */
  allocate?: boolean;
};

/** A cash, check or other payment, recorded and allocated (rule 7). */
export async function recordPayment(tx: Sql, tenantId: string, input: PaymentInput): Promise<{ payment_id: string; allocated_cents: number }> {
  if (!Number.isInteger(input.amount_cents) || input.amount_cents <= 0) throw Object.assign(new Error("a payment is a positive number of cents"), { code: "23514" });
  const [row] = await tx<{ id: string }[]>`
    insert into public.payments ${tx({
      tenant_id: tenantId,
      account_id: input.account_id,
      kind: "payment",
      method: input.method,
      status: "succeeded",
      amount_cents: input.amount_cents,
      reference: input.reference ?? null,
      received_at: input.received_at,
      visit_id: input.visit_id ?? null,
      recorded_by: input.recorded_by,
      memo: input.memo ?? null,
    })} returning id`;
  const allocated_cents = input.allocate === false ? 0 : await allocate(tx, tenantId, row.id, input.account_id, input.amount_cents, input.invoice_id ?? null);
  await postPayment(tx, tenantId, row.id, await tenantTimeZone(tx, tenantId));
  return { payment_id: row.id, allocated_cents };
}

/** Unallocated credit on the account goes to the next open invoices (rule 7). */
export async function allocateCredit(tx: Sql, tenantId: string, accountId: string): Promise<number> {
  const credits = await tx<{ id: string; unallocated: string | number }[]>`
    select p.id, p.amount_cents - coalesce((select sum(a.amount_cents) from public.payment_allocations a where a.payment_id = p.id), 0)
                 - coalesce((select sum(r.amount_cents) from public.payments r where r.refund_of = p.id and r.status = 'succeeded'), 0) as unallocated
    from public.payments p where p.tenant_id = ${tenantId} and p.account_id = ${accountId} and p.kind = 'payment' and p.status = 'succeeded'
    order by p.received_at`;
  let allocated = 0;
  for (const c of credits) {
    const left = Number(c.unallocated);
    if (left > 0) allocated += await allocate(tx, tenantId, c.id, accountId, left, null);
  }
  return allocated;
}

type MethodRow = { id: string; gateway: "local" | "stripe"; gateway_payment_method_id: string; kind: string; last4: string; autopay: boolean; is_default: boolean; status: string };

async function gatewayCustomer(tx: Sql, tenantId: string, accountId: string, settings: Settings): Promise<string> {
  const gateway = gatewayFor(settings);
  const [account] = await tx<{ name: string; email: string | null; gateway_customer_id: string | null }[]>`select name, email, gateway_customer_id from public.accounts where id = ${accountId} and tenant_id = ${tenantId}`;
  if (!account) throw Object.assign(new Error("account not found"), { code: "23514" });
  const id = await gateway.ensureCustomer({ account_id: settings.gateway_account_id, existing_customer_id: account.gateway_customer_id, name: account.name, email: account.email });
  if (id !== account.gateway_customer_id) await tx`select app.set_account_gateway_customer(${tenantId}, ${accountId}, ${id})`;
  return id;
}

/** Spec 13: a suspended or archived company takes no money and saves no cards; refuse before the gateway is called. */
async function assertTenantActive(tx: Sql, tenantId: string): Promise<void> {
  const [t] = await tx<{ status: string }[]>`select status from public.tenants where id = ${tenantId}`;
  if (!t || t.status !== "active") throw Object.assign(new Error("this company is read only"), { code: "42501" });
}

/** Saves a tokenized card or bank account on the customer; the token never reaches the database. */
export async function addPaymentMethod(tx: Sql, tenantId: string, input: { account_id: string; token: string; autopay: boolean; added_by: string | null }): Promise<string> {
  await assertTenantActive(tx, tenantId);
  const settings = await ensureSettings(tx, tenantId);
  const gateway = gatewayFor(settings);
  const customer = await gatewayCustomer(tx, tenantId, input.account_id, settings);
  const saved = await gateway.savePaymentMethod({ account_id: settings.gateway_account_id, customer_id: customer, token: input.token });
  const [row] = await tx<{ id: string }[]>`
    insert into public.payment_methods ${tx({
      tenant_id: tenantId,
      account_id: input.account_id,
      gateway: gateway.kind,
      gateway_payment_method_id: saved.gateway_payment_method_id,
      kind: saved.kind,
      brand: saved.brand,
      last4: saved.last4,
      exp_month: saved.exp_month,
      exp_year: saved.exp_year,
      autopay: input.autopay,
      is_default: true,
      status: "active",
      added_by: input.added_by,
    })}
    on conflict (tenant_id, gateway, gateway_payment_method_id) do update set status = 'active', autopay = excluded.autopay, is_default = true, brand = excluded.brand, last4 = excluded.last4, exp_month = excluded.exp_month, exp_year = excluded.exp_year
    returning id`;
  return row.id;
}

export type ChargeOutcome = { ok: boolean; payment_id: string | null; error: string | null };

/** Charges a saved method for an open invoice through the gateway and allocates the money on success (rules 8 and 13). */
export async function chargeInvoice(
  tx: Sql,
  tenantId: string,
  invoiceId: string,
  options: { payment_method_id?: string | null; idempotency_key: string; recorded_by: string | null; post?: boolean },
): Promise<ChargeOutcome> {
  const [tenant] = await tx<{ status: string }[]>`select status from public.tenants where id = ${tenantId}`;
  if (!tenant || tenant.status !== "active") return { ok: false, payment_id: null, error: "this company is read only" };
  const settings = await ensureSettings(tx, tenantId);
  const gateway = gatewayFor(settings);
  const [inv] = await tx<{ id: string; number: number | null; account_id: string; status: string; kind: string; total_cents: string | number; paid_cents: string | number }[]>`
    select id, number, account_id, status, kind, total_cents, paid_cents from public.invoices where id = ${invoiceId} and tenant_id = ${tenantId}`;
  if (!inv || inv.kind !== "invoice" || !["issued", "partially_paid", "past_due"].includes(inv.status)) return { ok: false, payment_id: null, error: "this invoice is not open" };
  const open = Number(inv.total_cents) - Number(inv.paid_cents);
  if (open <= 0) return { ok: false, payment_id: null, error: "nothing is open on this invoice" };
  const [method] = options.payment_method_id
    ? await tx<MethodRow[]>`select id, gateway, gateway_payment_method_id, kind, last4, autopay, is_default, status from public.payment_methods where id = ${options.payment_method_id} and tenant_id = ${tenantId} and account_id = ${inv.account_id}`
    : await tx<MethodRow[]>`select id, gateway, gateway_payment_method_id, kind, last4, autopay, is_default, status from public.payment_methods where tenant_id = ${tenantId} and account_id = ${inv.account_id} and status = 'active' and is_default order by created_at desc limit 1`;
  if (!method || method.status !== "active") return { ok: false, payment_id: null, error: "no active payment method" };
  const customer = await gatewayCustomer(tx, tenantId, inv.account_id, settings);
  const result = await gateway.charge({
    account_id: settings.gateway_account_id,
    customer_id: customer,
    payment_method_id: method.gateway_payment_method_id,
    method_last4: method.last4,
    amount_cents: open,
    description: `Invoice #${inv.number ?? ""}`,
    idempotency_key: options.idempotency_key,
    platform_fee_bps: platformFeeBps(),
  });
  const [payment] = await tx<{ id: string }[]>`
    insert into public.payments ${tx({
      tenant_id: tenantId,
      account_id: inv.account_id,
      kind: "payment",
      method: method.kind === "us_bank_account" ? "us_bank_account" : "card",
      status: result.status === "succeeded" ? "succeeded" : result.status === "pending" ? "pending" : "failed",
      amount_cents: open,
      gateway: gateway.kind,
      gateway_payment_id: result.gateway_payment_id,
      payment_method_id: method.id,
      failure_reason: result.failure_reason,
      received_at: new Date(),
      recorded_by: options.recorded_by,
      memo: `Invoice #${inv.number ?? ""}`,
    })}
    on conflict (tenant_id, gateway, gateway_payment_id) where gateway_payment_id is not null do update set status = excluded.status, failure_reason = excluded.failure_reason
    returning id`;
  if (result.status !== "succeeded") return { ok: false, payment_id: payment.id, error: result.failure_reason ?? result.status };
  await allocate(tx, tenantId, payment.id, inv.account_id, open, inv.id);
  // A customer paying in the portal is not a member and cannot post: the ledger job's sweep posts it (spec 16).
  if (options.post !== false) await postPayment(tx, tenantId, payment.id, await tenantTimeZone(tx, tenantId));
  return { ok: true, payment_id: payment.id, error: null };
}

/** Refunds part or all of a payment: a refund row, the gateway where the money came that way, allocations reduced. */
export async function refundPayment(
  tx: Sql,
  tenantId: string,
  paymentId: string,
  amountCents: number,
  memo: string | null,
  recordedBy: string | null,
  options: { keepAllocations?: boolean } = {},
): Promise<{ refund_id: string }> {
  const [p] = await tx<{ id: string; account_id: string; method: string; status: string; kind: string; amount_cents: string | number; gateway: string | null; gateway_payment_id: string | null; refunded: string | number }[]>`
    select p.id, p.account_id, p.method, p.status, p.kind, p.amount_cents, p.gateway, p.gateway_payment_id,
           coalesce((select sum(r.amount_cents) from public.payments r where r.refund_of = p.id and r.status = 'succeeded'), 0) as refunded
    from public.payments p where p.id = ${paymentId} and p.tenant_id = ${tenantId}`;
  if (!p || p.kind !== "payment" || p.status !== "succeeded") throw Object.assign(new Error("only a succeeded payment is refunded"), { code: "23514" });
  const refundable = Number(p.amount_cents) - Number(p.refunded);
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > refundable) throw Object.assign(new Error(`a refund is between 1 cent and the ${refundable} cents still on this payment`), { code: "23514" });
  let gatewayId: string | null = null;
  if (p.gateway && p.gateway_payment_id && (p.method === "card" || p.method === "us_bank_account")) {
    const settings = await ensureSettings(tx, tenantId);
    const result = await gatewayFor(settings).refund({ account_id: settings.gateway_account_id, gateway_payment_id: p.gateway_payment_id, amount_cents: amountCents, idempotency_key: `refund:${paymentId}:${Number(p.refunded) + amountCents}` });
    if (result.status === "failed") throw Object.assign(new Error(`the gateway refused the refund: ${result.failure_reason ?? "unknown"}`), { code: "23514" });
    gatewayId = result.gateway_refund_id;
  }
  // The invoices this payment covered give the money back, newest allocation first, unless a credit memo already did.
  let left = options.keepAllocations ? 0 : amountCents;
  const released: { invoice_id: string; cents: number }[] = [];
  const allocations = await tx<{ id: string; invoice_id: string; amount_cents: string | number }[]>`select id, invoice_id, amount_cents from public.payment_allocations where payment_id = ${paymentId} order by created_at desc`;
  for (const a of allocations) {
    if (left <= 0) break;
    const amount = Number(a.amount_cents);
    if (amount <= left) {
      await tx`delete from public.payment_allocations where id = ${a.id}`;
      released.push({ invoice_id: a.invoice_id, cents: amount });
      left -= amount;
    } else {
      await tx`update public.payment_allocations set amount_cents = ${amount - left} where id = ${a.id}`;
      released.push({ invoice_id: a.invoice_id, cents: left });
      left = 0;
    }
  }
  const [refund] = await tx<{ id: string }[]>`
    insert into public.payments ${tx({
      tenant_id: tenantId,
      account_id: p.account_id,
      kind: "refund",
      method: p.method,
      status: "succeeded",
      amount_cents: amountCents,
      gateway: p.gateway,
      gateway_payment_id: gatewayId,
      refund_of: paymentId,
      received_at: new Date(),
      recorded_by: recordedBy,
      memo,
      released_allocations: tx.json(released),
    })} returning id`;
  if (Number(p.refunded) + amountCents >= Number(p.amount_cents)) await tx`update public.payments set status = 'refunded' where id = ${paymentId}`;
  await postRefund(tx, tenantId, refund.id, await tenantTimeZone(tx, tenantId));
  return { refund_id: refund.id };
}

// ---------------------------------------------------------------------------
// Collections and the job
// ---------------------------------------------------------------------------

type AutopayCounts = { charged: number; failed: number; skipped: number };

/** Charges open invoices on their due dates and retries failures per the settings (rule 8). */
export async function runAutopay(tx: Sql, tenantId: string, settings: Settings, today: string, timeZone: string, recordedBy: string | null = null): Promise<AutopayCounts> {
  const counts: AutopayCounts = { charged: 0, failed: 0, skipped: 0 };
  const due = await tx<{ id: string; account_id: string; due_on: string; method_id: string | null; method_status: string | null }[]>`
    select i.id, i.account_id, i.due_on,
           (select m.id from public.payment_methods m where m.account_id = i.account_id and m.autopay and m.is_default order by (m.status = 'active') desc, m.created_at desc limit 1) as method_id,
           (select m.status from public.payment_methods m where m.account_id = i.account_id and m.autopay and m.is_default order by (m.status = 'active') desc, m.created_at desc limit 1) as method_status
    from public.invoices i
    where i.tenant_id = ${tenantId} and i.kind = 'invoice' and i.status in ('issued', 'partially_paid', 'past_due') and i.total_cents > i.paid_cents and i.due_on <= ${today}
    order by i.due_on`;
  for (const inv of due) {
    if (!inv.method_id) continue;
    // The retry clock counts business days in the company's zone from the day of the last attempt.
    const attempts = (
      await tx<{ attempt: number; scheduled_for: string; attempted_at: string | Date | null; result: "succeeded" | "failed" | "skipped" | null }[]>`
        select attempt, scheduled_for, attempted_at, result from public.autopay_attempts where invoice_id = ${inv.id} order by attempt`
    ).map((a) => ({ ...a, attempted_at: a.attempted_at ? dateInZone(a.attempted_at, timeZone) : null }));
    const next = nextAttempt(attempts, inv.due_on, settings.autopay_retry_days, today);
    if (!next) continue;
    const [attempt] = await tx<{ id: string }[]>`
      insert into public.autopay_attempts (tenant_id, invoice_id, payment_method_id, attempt, scheduled_for, attempted_at)
      values (${tenantId}, ${inv.id}, ${inv.method_id}, ${next.attempt}, ${next.scheduled_for}, now())
      on conflict (invoice_id, attempt) do nothing returning id`;
    if (!attempt) continue;
    if (inv.method_status !== "active") {
      await tx`update public.autopay_attempts set result = 'skipped', error = 'payment method removed' where id = ${attempt.id}`;
      counts.skipped += 1;
      continue;
    }
    const outcome = await chargeInvoice(tx, tenantId, inv.id, { payment_method_id: inv.method_id, idempotency_key: `autopay:${inv.id}:${next.attempt}`, recorded_by: recordedBy });
    await tx`update public.autopay_attempts set result = ${outcome.ok ? "succeeded" : "failed"}, payment_id = ${outcome.payment_id}, error = ${outcome.error} where id = ${attempt.id}`;
    if (outcome.ok) counts.charged += 1;
    else counts.failed += 1;
  }
  return counts;
}

/** Past due and back: the status each open invoice should carry today (rule 9). */
export async function refreshStatuses(tx: Sql, tenantId: string, settings: Settings, today: string): Promise<number> {
  const open = await tx<{ id: string; kind: "invoice" | "credit_memo"; status: string; total_cents: string | number; paid_cents: string | number; due_on: string | null }[]>`
    select id, kind, status, total_cents, paid_cents, due_on from public.invoices where tenant_id = ${tenantId} and status in ('issued', 'partially_paid', 'past_due')`;
  let changed = 0;
  for (const i of open) {
    const next = invoiceStatus({ kind: i.kind, status: i.status as "issued", total_cents: Number(i.total_cents), paid_cents: Number(i.paid_cents), due_on: i.due_on, today, grace_days: settings.grace_days });
    if (next !== i.status) {
      await tx`update public.invoices set status = ${next} where id = ${i.id}`;
      changed += 1;
    }
  }
  return changed;
}

/** One late fee invoice per past-due invoice, the first time it is past due (rule 11). */
export async function applyLateFees(tx: Sql, tenantId: string, settings: Settings, today: string): Promise<number> {
  if (settings.late_fee_cents <= 0 && Number(settings.late_fee_percent) <= 0) return 0;
  const pastDue = await tx<{ id: string; number: number | null; account_id: string; property_id: string | null; agreement_id: string | null; total_cents: string | number; paid_cents: string | number }[]>`
    select id, number, account_id, property_id, agreement_id, total_cents, paid_cents from public.invoices
    where tenant_id = ${tenantId} and kind = 'invoice' and status = 'past_due' and source not in ('late_fee', 'opening')`;
  let created = 0;
  for (const inv of pastDue) {
    const fee = lateFee(Number(inv.total_cents) - Number(inv.paid_cents), settings);
    if (fee <= 0) continue;
    const made = await createInvoice(tx, tenantId, {
      account_id: inv.account_id,
      property_id: inv.property_id,
      agreement_id: inv.agreement_id,
      source: "late_fee",
      source_key: `late_fee:${inv.id}`,
      issued_on: today,
      lines: [{ description: `Late fee on invoice #${inv.number ?? ""}`, amount_cents: fee, kind: "late_fee" }],
      issue: true,
    });
    if (made.created) created += 1;
  }
  return created;
}

/** The cancellation's money (rule 12): a final invoice, or a credit memo refunded to the original card when there was one. */
export async function settleCancellation(tx: Sql, tenantId: string, agreementId: string, effectiveOn: string, recordedBy: string | null): Promise<{ invoices: number; refunded_cents: number }> {
  const agreement = await loadAgreement(tx, tenantId, agreementId);
  if (!agreement) throw new Error("agreement not found");
  const [st] = await tx<{ name: string; service_line: string }[]>`select name, service_line from public.service_types where id = ${agreement.service_type_id}`;
  // The installments the schedule counts as billed through the effective date are invoiced first, so the position the
  // preview shows is the position the books carry (rules 3 and 12).
  if (agreement.billing_mode === "flat_monthly") await issueInstallments(tx, tenantId, effectiveOn, agreementId);
  const preview = await settlementFor(tx, tenantId, agreementId, effectiveOn);
  const documents = settlementDocuments(preview, { number: agreement.number, service_type_name: st?.name ?? "Service" });
  let invoices = 0;
  let refunded = 0;
  for (const [i, doc] of documents.entries()) {
    const made = await createInvoice(tx, tenantId, {
      kind: doc.kind,
      account_id: agreement.account_id,
      property_id: agreement.property_id,
      agreement_id: agreementId,
      source: "settlement",
      source_key: i === 0 ? `settlement:${agreementId}` : `settlement:${agreementId}:${i}`,
      issued_on: effectiveOn,
      memo: `Cancellation effective ${effectiveOn}`,
      lines: doc.lines.map((l) => ({ description: l.description, amount_cents: l.amount_cents, kind: l.kind, agreement_id: agreementId, service_type_id: l.taxable ? agreement.service_type_id : null, service_line: st?.service_line ?? null })),
      issue: true,
    });
    if (made.created) invoices += 1;
    if (made.created && doc.kind === "credit_memo") {
      // Money that came by card or bank goes back the same way, newest payment first, up to the credit.
      let left = -doc.lines.reduce((sum, l) => sum + l.amount_cents, 0);
      const gatewayPayments = await tx<{ id: string; amount_cents: string | number; refunded: string | number }[]>`
        select p.id, p.amount_cents, coalesce((select sum(r.amount_cents) from public.payments r where r.refund_of = p.id and r.status = 'succeeded'), 0) as refunded
        from public.payments p
        where p.tenant_id = ${tenantId} and p.account_id = ${agreement.account_id} and p.kind = 'payment' and p.status = 'succeeded' and p.gateway_payment_id is not null
          and exists (select 1 from public.payment_allocations a join public.invoices i on i.id = a.invoice_id where a.payment_id = p.id and i.agreement_id = ${agreementId})
        order by p.received_at desc`;
      for (const p of gatewayPayments) {
        if (left <= 0) break;
        const amount = Math.min(left, Number(p.amount_cents) - Number(p.refunded));
        if (amount <= 0) continue;
        // The credit memo is the document that offsets the prepay invoice; the refund leaves its allocations alone so the
        // invoice stays paid and autopay never charges it again.
        await refundPayment(tx, tenantId, p.id, amount, `Cancellation of agreement #${agreement.number}`, recordedBy, { keepAllocations: true });
        refunded += amount;
        left -= amount;
      }
    }
  }
  // A warranty's books recognize exactly what the settlement says was earned (spec 15 rule 2).
  await postStraightLineSettlement(tx, tenantId, agreementId, effectiveOn, preview.recognizedCents);
  return { invoices, refunded_cents: refunded };
}

export type BillingCounts = { visits: number; installments: number; prepayments: number; allocated_cents: number; charged: number; failed: number; skipped: number; statuses: number; late_fees: number; ledger: LedgerCounts };

/** The billing job: idempotent, safe every hour (spec 08). */
export async function runBilling(
  tx: Sql,
  tenantId: string,
  timeZone: string,
  now = new Date(),
  recordedBy: string | null = null,
  ledger: LedgerRunOptions = { reclass: true, payouts: true },
): Promise<BillingCounts> {
  const settings = await ensureSettings(tx, tenantId);
  const today = dateInZone(now, timeZone);
  const counts: BillingCounts = { visits: 0, installments: 0, prepayments: 0, allocated_cents: 0, charged: 0, failed: 0, skipped: 0, statuses: 0, late_fees: 0, ledger: { invoices: 0, voids: 0, visits: 0, product_uses: 0, unpriced: 0, payments: 0, refunds: 0, payouts: 0, local_payouts: 0, reclasses: 0, straight_line: 0 } };
  const unbilled = await tx<{ id: string }[]>`
    select v.id from public.visits v left join public.agreements a on a.id = v.agreement_id
    where v.tenant_id = ${tenantId} and v.status = 'completed' and not v.imported and v.price_cents > 0 and (a.id is null or a.billing_mode = 'per_visit')
      and not exists (select 1 from public.invoices i where i.tenant_id = v.tenant_id and i.source_key = 'visit:' || v.id)`;
  for (const v of unbilled) {
    const made = await invoiceForVisit(tx, tenantId, v.id, timeZone);
    if (made?.created) counts.visits += 1;
  }
  counts.installments = await issueInstallments(tx, tenantId, today);
  counts.prepayments = await issuePrepayments(tx, tenantId, today, timeZone);
  const accounts = await tx<{ account_id: string }[]>`
    select distinct p.account_id from public.payments p where p.tenant_id = ${tenantId} and p.kind = 'payment' and p.status = 'succeeded'
      and p.amount_cents > coalesce((select sum(a.amount_cents) from public.payment_allocations a where a.payment_id = p.id), 0) + coalesce((select sum(r.amount_cents) from public.payments r where r.refund_of = p.id and r.status = 'succeeded'), 0)`;
  for (const a of accounts) counts.allocated_cents += await allocateCredit(tx, tenantId, a.account_id);
  const autopay = await runAutopay(tx, tenantId, settings, today, timeZone, recordedBy);
  counts.charged = autopay.charged;
  counts.failed = autopay.failed;
  counts.skipped = autopay.skipped;
  counts.statuses = await refreshStatuses(tx, tenantId, settings, today);
  counts.late_fees = await applyLateFees(tx, tenantId, settings, today);
  // The ledger's share of the job (spec 09): anything the inline postings missed, payouts, and period-end reclasses.
  counts.ledger = await runLedger(tx, tenantId, timeZone, today, settings.gateway, ledger);
  return counts;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function statementFor(tx: Sql, tenantId: string, accountId: string, today: string, timeZone?: string): Promise<Statement & { invoices: StatementInvoice[]; payments: StatementPayment[] }> {
  const invoices = (
    await tx<(Omit<StatementInvoice, "total_cents" | "paid_cents"> & { total_cents: string | number; paid_cents: string | number })[]>`
      select id, number, kind, status, issued_on, due_on, total_cents, paid_cents, source, memo from public.invoices where tenant_id = ${tenantId} and account_id = ${accountId} order by issued_on, number`
  ).map((i) => ({ ...i, total_cents: Number(i.total_cents), paid_cents: Number(i.paid_cents) }));
  const payments = (
    await tx<(Omit<StatementPayment, "amount_cents"> & { amount_cents: string | number })[]>`
      select id, kind, method, status, amount_cents, received_at, reference, refund_of from public.payments where tenant_id = ${tenantId} and account_id = ${accountId} order by received_at`
  ).map((p) => ({ ...p, amount_cents: Number(p.amount_cents) }));
  const allocations = (
    await tx<(Omit<StatementAllocation, "amount_cents"> & { amount_cents: string | number })[]>`
      select a.payment_id, a.invoice_id, a.amount_cents from public.payment_allocations a join public.payments p on p.id = a.payment_id where a.tenant_id = ${tenantId} and p.account_id = ${accountId}`
  ).map((a) => ({ ...a, amount_cents: Number(a.amount_cents) }));
  return { ...statement(invoices, payments, allocations, today, timeZone), invoices, payments };
}

export type TaxReportRow = { state_code: string; jurisdiction: string; kind: string; rate: string; taxable_cents: number; tax_cents: number; invoices: number };

/** Tax collected by jurisdiction for the issue dates in range, from the breakdown each line kept. */
export async function taxReport(tx: Sql, tenantId: string, from: string, to: string): Promise<TaxReportRow[]> {
  const rows = await tx<{ state_code: string; jurisdiction: string; kind: string; rate: string; taxable_cents: string | number; tax_cents: string | number; invoices: string | number }[]>`
    select p.state_code, b.value->>'name' as jurisdiction, b.value->>'kind' as kind, b.value->>'rate' as rate,
           sum(l.amount_cents) as taxable_cents, sum((b.value->>'cents')::bigint) as tax_cents, count(distinct i.id) as invoices
    from public.invoice_lines l
      join public.invoices i on i.id = l.invoice_id
      left join public.properties p on p.id = i.property_id
      cross join lateral jsonb_array_elements(l.tax_breakdown) b
    where l.tenant_id = ${tenantId} and i.status not in ('draft', 'void') and i.issued_on between ${from} and ${to} and l.tax_class = 'taxable'
    group by p.state_code, b.value->>'name', b.value->>'kind', b.value->>'rate'
    order by p.state_code, b.value->>'kind', b.value->>'name'`;
  return rows.map((r) => ({ state_code: r.state_code ?? "", jurisdiction: r.jurisdiction, kind: r.kind, rate: r.rate, taxable_cents: Number(r.taxable_cents), tax_cents: Number(r.tax_cents), invoices: Number(r.invoices) }));
}
