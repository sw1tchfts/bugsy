import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AgreementFields } from "@/components/agreements/agreement-fields";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Table, Textarea, errorMessage } from "@/components/ui";
import { billingSchedule } from "@/lib/agreements/billing";
import { BILLING_MODE_LABELS, CADENCE_LABELS, endsOn } from "@/lib/agreements/cadence";
import { loadAgreement, settlementFor } from "@/lib/agreements/db";
import { AGREEMENT_STATUS_LABELS, VISIT_KIND_LABELS, VISIT_STATUS_LABELS } from "@/lib/agreements/forms";
import { type PlannedVisit, contractTotalCents, planVisits } from "@/lib/agreements/visits";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { addDays, formatBusinessDate, formatInstant, isIsoDate, todayInZone } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { bookReservice, cancelAgreement, changeAgreementPrice, renewAgreement, signAgreement, updateAgreement } from "../actions";

export const metadata: Metadata = { title: "Agreement" };

type Detail = {
  account_name: string;
  property_name: string | null;
  property_address: string;
  service_type_name: string;
  branch_name: string | null;
  quote_number: number | null;
  signed_at: string | null;
  signed_name: string | null;
  signer_name: string | null;
  cancelled_on: string | null;
  cancel_reason_name: string | null;
  cancel_note: string | null;
  save_offer_made: boolean;
  save_outcome: string | null;
  terms_text: string | null;
  notes: string | null;
  created_at: string;
};

type Visit = {
  id: string;
  kind: keyof typeof VISIT_KIND_LABELS;
  sequence: number;
  due_start: string;
  due_end: string;
  scheduled_for: string | null;
  status: keyof typeof VISIT_STATUS_LABELS;
  price_cents: string;
  interior_only: boolean;
  reservice_reason: string | null;
  completed_at: string | null;
};

type Change = { id: string; old_recurring_price_cents: string; new_recurring_price_cents: string; effective_on: string; reason: string; notified_at: string | null; created_at: string };
type Contact = { id: string; name: string; role: string };
type Reason = { id: string; name: string };

const STATUS_TONE = { draft: "neutral", active: "good", on_hold: "warn", cancelled: "bad", ended: "neutral" } as const;
const VISIT_TONE: Record<Visit["status"], "neutral" | "good" | "warn" | "bad"> = { planned: "neutral", scheduled: "warn", en_route: "warn", in_progress: "warn", completed: "good", skipped: "neutral", cancelled: "bad" };

export default async function AgreementPage({ params, searchParams }: { params: Promise<{ agreementId: string }>; searchParams: Promise<{ error?: string; cancel_on?: string }> }) {
  const { session, active } = await requireActiveTenant();
  const { agreementId } = await params;
  const { error, cancel_on } = await searchParams;
  const tenantId = active.tenantId;
  const canWrite = can(active.permissions, "agreements.write");
  const today = todayInZone(active.tenantTimezone);
  const cancelOn = cancel_on && isIsoDate(cancel_on) ? cancel_on : today;

  const data = await dbAs(session, async (tx) => {
    const agreement = await loadAgreement(tx, tenantId, agreementId);
    if (!agreement) return null;
    const [detail] = await tx<Detail[]>`
      select ac.name as account_name, p.name as property_name, p.normalized_address as property_address, st.name as service_type_name, b.name as branch_name,
             q.number as quote_number, a.signed_at, a.signed_name, c.name as signer_name, a.cancelled_on, cr.name as cancel_reason_name, a.cancel_note,
             a.save_offer_made, a.save_outcome, a.terms_text, a.notes, a.created_at
      from public.agreements a
        join public.accounts ac on ac.id = a.account_id
        join public.properties p on p.id = a.property_id
        join public.service_types st on st.id = a.service_type_id
        left join public.branches b on b.id = a.branch_id
        left join public.quotes q on q.id = a.quote_id
        left join public.contacts c on c.id = a.signed_by_contact_id
        left join public.cancel_reasons cr on cr.id = a.cancel_reason_id
      where a.id = ${agreementId} and a.tenant_id = ${tenantId}`;
    const visits = await tx<Visit[]>`
      select id, kind, sequence, due_start, due_end, scheduled_for, status, price_cents, interior_only, reservice_reason, completed_at
      from public.visits where agreement_id = ${agreementId} and tenant_id = ${tenantId} order by due_start, sequence`;
    const changes = await tx<Change[]>`
      select id, old_recurring_price_cents, new_recurring_price_cents, effective_on, reason, notified_at, created_at
      from public.agreement_price_changes where agreement_id = ${agreementId} and tenant_id = ${tenantId} order by effective_on desc, created_at desc`;
    const contacts = await tx<Contact[]>`
      select id, name, role from public.contacts where tenant_id = ${tenantId} and archived_at is null
        and (account_id = ${agreement.account_id} or property_id = ${agreement.property_id}) order by case role when 'primary' then 0 when 'billing' then 1 else 2 end, name`;
    const reasons = await tx<Reason[]>`select id, name from public.cancel_reasons where tenant_id = ${tenantId} and active order by name`;
    const settlement = ["active", "on_hold"].includes(agreement.status) ? await settlementFor(tx, tenantId, agreementId, cancelOn) : null;
    return { agreement, detail, visits, changes, contacts, reasons, settlement };
  });
  if (!data) notFound();
  const { agreement, detail, visits, changes, contacts, reasons, settlement } = data;

  // Drafts show the plan they will generate; signed agreements show the visits they have.
  let preview: PlannedVisit[] = [];
  let previewError: string | null = null;
  if (agreement.status === "draft") {
    try {
      preview = planVisits(agreement);
    } catch (err) {
      previewError = err instanceof Error ? err.message : "The plan could not be built.";
    }
  }
  // Once an agreement is cancelled or ended, the visits its cancellation removed were still part of the contract it had.
  const closed = agreement.status === "cancelled" || agreement.status === "ended";
  const planForBilling: PlannedVisit[] =
    agreement.status === "draft"
      ? preview
      : visits
          .filter((v) => (v.kind === "initial" || v.kind === "recurring") && v.status !== "skipped" && (closed || v.status !== "cancelled"))
          .map((v) => ({ kind: v.kind as "initial" | "recurring", sequence: v.sequence, due_start: v.due_start, due_end: v.due_end, price_cents: Number(v.price_cents), interior_only: v.interior_only }));
  const schedule = billingSchedule(agreement, planForBilling);
  const contractTotal = contractTotalCents(planForBilling);
  const editable = canWrite && ["draft", "active", "on_hold"].includes(agreement.status);
  const hidden = (
    <>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="agreement_id" value={agreement.id} />
    </>
  );

  return (
    <>
      <div>
        <p className="text-sm text-stone-500">
          <Link href="/agreements" className="hover:underline">
            Agreements
          </Link>
          {" / "}
          <Link href={`/customers/${agreement.account_id}`} className="hover:underline">
            {detail.account_name}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">
          Agreement #{agreement.number} <Badge tone={STATUS_TONE[agreement.status]}>{AGREEMENT_STATUS_LABELS[agreement.status]}</Badge>
        </h1>
        <p className="text-sm text-stone-600">
          {detail.service_type_name} at{" "}
          <Link href={`/customers/properties/${agreement.property_id}`} className="underline">
            {detail.property_name ? `${detail.property_name}, ` : ""}
            {detail.property_address}
          </Link>
          . {CADENCE_LABELS[agreement.cadence]}, {BILLING_MODE_LABELS[agreement.billing_mode].toLowerCase()}, {agreement.term_months}-month term from {formatBusinessDate(agreement.starts_on)} to{" "}
          {formatBusinessDate(agreement.ends_on)}
          {agreement.renewals ? ` (renewed ${agreement.renewals} time${agreement.renewals === 1 ? "" : "s"})` : ""}. Initial {formatCents(agreement.initial_price_cents)}, recurring {formatCents(agreement.recurring_price_cents)}; contract total{" "}
          {formatCents(contractTotal)}.{detail.branch_name ? ` Branch: ${detail.branch_name}.` : ""}
          {detail.quote_number ? ` From quote #${detail.quote_number}.` : ""}
          {detail.signed_at ? ` Signed ${formatInstant(detail.signed_at, active.tenantTimezone)} by ${detail.signed_name}${detail.signer_name ? ` (${detail.signer_name})` : ""}.` : ""}
          {detail.cancelled_on ? ` Cancelled ${formatBusinessDate(detail.cancelled_on)}: ${detail.cancel_reason_name ?? "no reason"}${detail.cancel_note ? `, ${detail.cancel_note}` : ""}${detail.save_offer_made ? ` (save offer ${detail.save_outcome ?? "made"})` : ""}.` : ""}
        </p>
      </div>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      {agreement.status === "draft" && canWrite ? (
        <Card title="Sign" description="The customer types their name and agrees to the terms. Consent to electronic notices is recorded on their contact. Signing activates the agreement and generates its visits.">
          {detail.terms_text ? <pre className="mb-4 whitespace-pre-wrap rounded border border-stone-200 bg-stone-50 p-3 font-sans text-sm text-stone-700">{detail.terms_text}</pre> : <p className="mb-4 text-sm text-stone-500">No terms text on this agreement. Set the company&apos;s default under Settings.</p>}
          <form action={signAgreement} className="grid gap-4 sm:grid-cols-2">
            {hidden}
            <Field label="Customer's typed name" htmlFor="signed_name">
              <Input id="signed_name" name="signed_name" required maxLength={120} />
            </Field>
            <Field label="Signing as" htmlFor="signed_by_contact_id">
              <Select id="signed_by_contact_id" name="signed_by_contact_id" defaultValue={contacts[0]?.id ?? ""}>
                <option value="">Not a listed contact</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.role.replace("_", " ")})
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="agree_terms" value="true" required /> The customer agrees to the terms above
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="consent_notices" value="true" defaultChecked /> The customer consents to notices by email or text
            </label>
            <div className="sm:col-span-2">
              <Button type="submit">Sign and activate</Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card
        title={agreement.status === "draft" ? "Planned visits (preview)" : "Visits"}
        description={agreement.status === "draft" ? "What signing will generate. Each visit is due any day in its window." : "Every visit on this agreement. Dispatch gives planned visits a date; the technician app completes them."}
      >
        {previewError ? <Notice kind="error">{previewError}</Notice> : null}
        {agreement.status === "draft" ? (
          preview.length === 0 ? (
            <Empty>No visits in this plan.</Empty>
          ) : (
            <Table headers={["#", "Kind", "Due window", "Price", ""]}>
              {preview.map((v) => (
                <tr key={v.sequence}>
                  <td className="py-2 pr-4 tabular-nums">{v.sequence}</td>
                  <td className="py-2 pr-4">{VISIT_KIND_LABELS[v.kind]}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {formatBusinessDate(v.due_start)} to {formatBusinessDate(v.due_end)}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{formatCents(v.price_cents)}</td>
                  <td className="py-2 pr-4">{v.interior_only ? <Badge>interior only</Badge> : null}</td>
                </tr>
              ))}
            </Table>
          )
        ) : visits.length === 0 ? (
          <Empty>No visits.</Empty>
        ) : (
          <Table headers={["#", "Kind", "Due window", "Scheduled", "Status", "Price", ""]}>
            {visits.map((v) => (
              <tr key={v.id} className={v.status === "cancelled" ? "text-stone-400" : ""}>
                <td className="py-2 pr-4 tabular-nums">{v.sequence}</td>
                <td className="py-2 pr-4">
                  {VISIT_KIND_LABELS[v.kind]}
                  {v.reservice_reason ? <span className="block text-xs text-stone-500">{v.reservice_reason}</span> : null}
                </td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  {formatBusinessDate(v.due_start)} to {formatBusinessDate(v.due_end)}
                </td>
                <td className="py-2 pr-4">{v.scheduled_for ? formatBusinessDate(v.scheduled_for) : ""}</td>
                <td className="py-2 pr-4">
                  <Badge tone={VISIT_TONE[v.status]}>{VISIT_STATUS_LABELS[v.status]}</Badge>
                </td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(v.price_cents)}</td>
                <td className="py-2 pr-4">{v.interior_only ? <Badge>interior only</Badge> : null}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Billing schedule" description={`${BILLING_MODE_LABELS[agreement.billing_mode]}: ${schedule.length} billing event${schedule.length === 1 ? "" : "s"} totalling ${formatCents(contractTotal)}. Invoices themselves come from billing (spec 08).`}>
        {schedule.length === 0 ? (
          <Empty>Nothing to bill.</Empty>
        ) : (
          <ul className="grid gap-1 text-sm sm:grid-cols-3 lg:grid-cols-4">
            {schedule.map((e, i) => (
              <li key={i} className="flex justify-between rounded border border-stone-100 px-2 py-1">
                <span>{agreement.billing_mode === "per_visit" ? `Visit ${e.visit_sequence}, from ${formatBusinessDate(e.date)}` : formatBusinessDate(e.date)}</span>
                <span className="tabular-nums">{formatCents(e.amount_cents)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {agreement.status === "active" && canWrite ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Book a re-service" description="Free return visit, due within a week unless you pick a later start.">
            <form action={bookReservice} className="grid gap-3">
              {hidden}
              <Field label="What the customer is seeing" htmlFor="reservice_reason">
                <Input id="reservice_reason" name="reservice_reason" required maxLength={200} placeholder="Ants back in the kitchen" />
              </Field>
              <Field label="Due from" htmlFor="due_start">
                <Input id="due_start" name="due_start" type="date" defaultValue={today} />
              </Field>
              <div>
                <Button type="submit" variant="secondary">
                  Book re-service
                </Button>
              </div>
            </form>
          </Card>
          <Card title="Change the recurring price" description="Future planned and scheduled visits from the effective date take the new price. Bulk yearly increases live under Agreements.">
            <form action={changeAgreementPrice} className="grid gap-3">
              {hidden}
              <Field label="New recurring price ($)" htmlFor="new_recurring_price">
                <Input id="new_recurring_price" name="new_recurring_price" inputMode="decimal" required defaultValue={(agreement.recurring_price_cents / 100).toFixed(2)} />
              </Field>
              <Field label="Effective on" htmlFor="effective_on">
                <Input id="effective_on" name="effective_on" type="date" defaultValue={today} />
              </Field>
              <div>
                <Button type="submit" variant="secondary">
                  Change price
                </Button>
              </div>
            </form>
          </Card>
          <Card title="Renew" description={`Extends the term to ${formatBusinessDate(endsOn({ ...agreement, renewals: agreement.renewals + 1 }))} and plans the next term's visits at the current prices.${agreement.auto_renew ? " This agreement also renews itself within 30 days of its end." : ""}`}>
            <form action={renewAgreement}>
              {hidden}
              <Button type="submit" variant="secondary">
                Renew for another term
              </Button>
            </form>
          </Card>
        </div>
      ) : null}

      {changes.length ? (
        <Card title="Price changes" description="Each change is recorded for the customer notice (spec 11).">
          <Table headers={["Effective", "From", "To", "Reason", "Customer told"]}>
            {changes.map((c) => (
              <tr key={c.id}>
                <td className="py-2 pr-4">{formatBusinessDate(c.effective_on)}</td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(c.old_recurring_price_cents)}</td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(c.new_recurring_price_cents)}</td>
                <td className="py-2 pr-4">{c.reason.replace("_", " ")}</td>
                <td className="py-2 pr-4">{c.notified_at ? formatInstant(c.notified_at, active.tenantTimezone) : "not yet"}</td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}

      {canWrite && ["draft", "active", "on_hold"].includes(agreement.status) ? (
        <Card title="Cancel" description="Pick the reason and say whether a save offer was made. Visits still ahead of the date are cancelled; what was delivered but not billed, or billed but not delivered, settles through billing (spec 08).">
          {settlement ? (
            <div className="mb-4 grid gap-2 text-sm sm:grid-cols-4">
              <div className="rounded border border-stone-200 p-2">
                <p className="text-stone-500">Billed through {formatBusinessDate(cancelOn)}</p>
                <p className="text-lg font-semibold tabular-nums">{formatCents(settlement.billedCents)}</p>
              </div>
              <div className="rounded border border-stone-200 p-2">
                <p className="text-stone-500">Delivered (completed visits)</p>
                <p className="text-lg font-semibold tabular-nums">{formatCents(settlement.recognizedCents)}</p>
              </div>
              <div className="rounded border border-stone-200 p-2">
                <p className="text-stone-500">{settlement.finalInvoiceCents > 0 ? "Final invoice" : "Refund"}</p>
                <p className="text-lg font-semibold tabular-nums">{formatCents(settlement.finalInvoiceCents > 0 ? settlement.finalInvoiceCents : settlement.refundCents)}</p>
              </div>
              <div className="rounded border border-stone-200 p-2">
                <p className="text-stone-500">Cancellation fee</p>
                <p className="text-lg font-semibold tabular-nums">{formatCents(settlement.feeCents)}</p>
              </div>
            </div>
          ) : null}
          <form action={cancelAgreement} className="grid gap-4 sm:grid-cols-2">
            {hidden}
            <Field label="Effective on" htmlFor="cancel_effective_on" hint="Change the date and save to preview a different settlement.">
              <Input id="cancel_effective_on" name="effective_on" type="date" defaultValue={cancelOn} />
            </Field>
            <Field label="Reason" htmlFor="cancel_reason_id">
              <Select id="cancel_reason_id" name="cancel_reason_id" defaultValue="" required={agreement.status !== "draft"}>
                <option value="">{agreement.status === "draft" ? "Dropping a draft" : "Pick a reason"}</option>
                {reasons.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Note" htmlFor="cancel_note">
                <Textarea id="cancel_note" name="cancel_note" rows={2} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="save_offer_made" value="true" /> A save offer was made
            </label>
            <Field label="Save outcome" htmlFor="save_outcome">
              <Select id="save_outcome" name="save_outcome" defaultValue="">
                <option value="">Not applicable</option>
                <option value="saved">Saved (stays a customer another way)</option>
                <option value="lost">Lost</option>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" variant="danger">
                {agreement.status === "draft" ? "Drop draft" : "Cancel agreement"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {editable ? (
        <Card title={agreement.status === "draft" ? "Edit the draft" : "Edit the plan"} description={agreement.status === "draft" ? "Anything can change until it is signed." : "The account, property and service type are fixed once signed. Planned visits regenerate around anything already scheduled or completed."}>
          <form action={updateAgreement} className="grid gap-4 sm:grid-cols-2">
            {hidden}
            <AgreementFields prefix="edit" values={{ ...agreement, terms_text: detail.terms_text, notes: detail.notes }} locked={agreement.status !== "draft"} />
            <div className="sm:col-span-2">
              <Button type="submit">Save changes</Button>
            </div>
          </form>
        </Card>
      ) : null}

      <p className="text-xs text-stone-500">
        Created {formatInstant(detail.created_at, active.tenantTimezone)}. Visits due in the next week: {visits.filter((v) => v.status === "planned" && v.due_start <= addDays(today, 7) && v.due_end >= today).length}.
      </p>
    </>
  );
}
