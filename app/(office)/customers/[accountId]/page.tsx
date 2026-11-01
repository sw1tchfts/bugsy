import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContactForm } from "@/components/customers/contact-form";
import { PropertyForm } from "@/components/customers/property-form";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Table, Textarea, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { BILLING_MODE_LABELS, type BillingMode, CADENCE_LABELS, type Cadence } from "@/lib/agreements/cadence";
import { AGREEMENT_STATUS_LABELS } from "@/lib/agreements/forms";
import { statementFor } from "@/lib/billing/db";
import { formatBusinessDate, formatInstant, todayInZone } from "@/lib/dates";
import { timeline } from "@/lib/messaging/db";
import { replyAction, sendMessageAction } from "@/app/(office)/messages/actions";
import { createQuote } from "@/app/(office)/quotes/actions";
import { archiveAccount, archiveContact, setContactConsent, updateAccount } from "../actions";

export const metadata: Metadata = { title: "Account" };

type Account = {
  id: string; name: string; type: string; email: string | null; phone: string | null; terms_days: number; po_required: boolean; notes: string | null;
  status: string; billing_line1: string | null; billing_line2: string | null; billing_city: string | null; billing_state_code: string | null; billing_postal_code: string | null;
  archived_at: string | null; created_at: string; past_due_since: string | null;
};
type Property = { id: string; name: string | null; normalized_address: string; property_type: string; geocode_status: string; unit_count: number | null; archived_at: string | null };
type Contact = { id: string; name: string; role: string; email: string | null; phone: string | null; property_id: string | null; unit_label: string | null; e_notice_consent_at: string | null; sms_opt_in: boolean };
type Quote = { id: string; number: number; status: string; created_at: string; best_total: number | null; options: number };
type AgreementSummary = {
  id: string; number: number; status: keyof typeof AGREEMENT_STATUS_LABELS; cadence: Cadence; billing_mode: BillingMode; recurring_price_cents: string;
  starts_on: string; ends_on: string; service_type_name: string; property_name: string | null; open_visits: number;
};
const AGREEMENT_TONE: Record<AgreementSummary["status"], "neutral" | "good" | "warn" | "bad"> = { draft: "neutral", active: "good", on_hold: "warn", cancelled: "bad", ended: "neutral" };

const STATUS_TONE: Record<string, "neutral" | "good" | "warn" | "bad"> = { draft: "neutral", sent: "warn", accepted: "good", declined: "bad", expired: "neutral" };

export default async function AccountPage({ params, searchParams }: { params: Promise<{ accountId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { accountId } = await params;
  const { error } = await searchParams;
  const { session, active } = await requireActiveTenant();
  const tenantId = active.tenantId;
  const canWrite = can(active.permissions, "customers.write");
  const canQuote = can(active.permissions, "agreements.write");

  const data = await dbAs(session, async (tx) => {
    const [account] = await tx<Account[]>`select * from public.accounts where id = ${accountId} and tenant_id = ${tenantId}`;
    if (!account) return null;
    const properties = await tx<Property[]>`
      select id, name, normalized_address, property_type, geocode_status, unit_count, archived_at from public.properties
      where account_id = ${accountId} and tenant_id = ${tenantId} order by archived_at nulls first, created_at`;
    const contacts = await tx<Contact[]>`
      select c.id, c.name, c.role, c.email, c.phone, c.property_id, u.label as unit_label, c.e_notice_consent_at, c.sms_opt_in
      from public.contacts c left join public.units u on u.id = c.unit_id
      where c.tenant_id = ${tenantId} and c.archived_at is null
        and (c.account_id = ${accountId} or c.property_id in (select id from public.properties where account_id = ${accountId}))
      order by c.role, c.name`;
    const quotes = await tx<Quote[]>`
      select q.id, q.number, q.status, q.created_at,
             (select min(o.total_cents) from public.quote_options o where o.quote_id = q.id) as best_total,
             (select count(*)::int from public.quote_options o where o.quote_id = q.id) as options
      from public.quotes q where q.tenant_id = ${tenantId} and (q.account_id = ${accountId} or q.lead_id in (select id from public.leads where account_id = ${accountId}))
      order by q.created_at desc`;
    const agreements = await tx<AgreementSummary[]>`
      select a.id, a.number, a.status, a.cadence, a.billing_mode, a.recurring_price_cents, a.starts_on, a.ends_on, st.name as service_type_name, p.name as property_name,
             (select count(*)::int from public.visits v where v.agreement_id = a.id and v.status in ('planned', 'scheduled')) as open_visits
      from public.agreements a join public.service_types st on st.id = a.service_type_id join public.properties p on p.id = a.property_id
      where a.tenant_id = ${tenantId} and a.account_id = ${accountId} and a.archived_at is null
      order by case a.status when 'active' then 0 when 'draft' then 1 else 2 end, a.created_at desc`;
    return { account, properties, contacts, quotes, agreements };
  });
  if (!data) notFound();
  const { account, properties, contacts, quotes, agreements } = data;
  const billing = can(active.permissions, "billing.read") ? await dbAs(session, (tx) => statementFor(tx, tenantId, accountId, todayInZone(active.tenantTimezone), active.tenantTimezone)) : null;
  const messages = await dbAs(session, (tx) => timeline(tx, tenantId, accountId));
  const canMessage = can(active.permissions, "messages.send");
  const here = `/customers/${accountId}`;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-stone-500">
            <Link href="/customers" className="hover:underline">
              Customers
            </Link>
          </p>
          <h1 className="text-2xl font-semibold">
            {account.name} {account.archived_at ? <Badge tone="bad">Archived</Badge> : account.status === "inactive" ? <Badge>Inactive</Badge> : null}
          </h1>
          <p className="text-sm text-stone-600">
            {{ residential: "Residential", commercial: "Commercial", property_manager: "Property manager" }[account.type]} account since {new Date(account.created_at).toLocaleDateString("en-US")}
          </p>
        </div>
        {canQuote && !account.archived_at ? (
          <form action={createQuote}>
            <input type="hidden" name="tenant_id" value={tenantId} />
            <input type="hidden" name="account_id" value={accountId} />
            <Button type="submit" variant="secondary">
              New quote
            </Button>
          </form>
        ) : null}
      </div>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      <Card title="Properties" description="Where the work happens. Each property's state picks its compliance rules.">
        {properties.length === 0 ? (
          <Empty>No properties.</Empty>
        ) : (
          <Table headers={["Property", "Address", "Type", "Units", "Pin"]}>
            {properties.map((p) => (
              <tr key={p.id} className={p.archived_at ? "text-stone-400" : ""}>
                <td className="py-2 pr-4 font-medium">
                  <Link href={`/customers/properties/${p.id}`} className="hover:underline">
                    {p.name ?? "Property"}
                  </Link>
                </td>
                <td className="py-2 pr-4">{p.normalized_address}</td>
                <td className="py-2 pr-4">{p.property_type.replace("_", " ")}</td>
                <td className="py-2 pr-4 tabular-nums">{p.unit_count ?? ""}</td>
                <td className="py-2 pr-4">
                  <Badge tone={p.geocode_status === "ok" || p.geocode_status === "manual" ? "good" : p.geocode_status === "failed" ? "bad" : "warn"}>{p.geocode_status}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
        {canWrite && !account.archived_at ? (
          <details className="mt-2">
            <summary className="cursor-pointer text-sm font-medium">Add a property</summary>
            <div className="mt-3">
              <PropertyForm tenantId={tenantId} accountId={accountId} />
            </div>
          </details>
        ) : null}
      </Card>

      <Card title="Contacts" description="Billing and primary contacts on the account; residents and site contacts on properties.">
        {contacts.length === 0 ? (
          <Empty>No contacts.</Empty>
        ) : (
          <Table headers={["Name", "Role", "Where", "Phone", "Email", "Notices", ""]}>
            {contacts.map((c) => (
              <tr key={c.id}>
                <td className="py-2 pr-4 font-medium">{c.name}</td>
                <td className="py-2 pr-4">{c.role.replace("_", " ")}</td>
                <td className="py-2 pr-4 text-stone-600">{c.property_id ? `${properties.find((p) => p.id === c.property_id)?.name ?? "property"}${c.unit_label ? `, unit ${c.unit_label}` : ""}` : "account"}</td>
                <td className="py-2 pr-4">{c.phone ?? ""}</td>
                <td className="py-2 pr-4">{c.email ?? ""}</td>
                <td className="py-2 pr-4">
                  {c.e_notice_consent_at ? <Badge tone="good">electronic ok</Badge> : <Badge>paper</Badge>} {c.sms_opt_in ? <Badge tone="good">sms</Badge> : null}
                </td>
                <td className="py-2 text-right">
                  {canWrite ? (
                    <div className="flex justify-end gap-2">
                      <form action={setContactConsent} className="flex gap-1">
                        <input type="hidden" name="tenant_id" value={tenantId} />
                        <input type="hidden" name="contact_id" value={c.id} />
                        <input type="hidden" name="return_to" value={here} />
                        <input type="hidden" name="grant" value={c.e_notice_consent_at ? "false" : "true"} />
                        {!c.e_notice_consent_at ? <Input name="e_notice_consent_on" type="date" aria-label={`Consent date for ${c.name}`} /> : null}
                        <Input name="e_notice_consent_note" placeholder={c.e_notice_consent_at ? "Why consent is withdrawn" : "How consent was captured"} aria-label={`Consent note for ${c.name}`} />
                        <Button type="submit" variant="secondary">
                          {c.e_notice_consent_at ? "Withdraw" : "Consent"}
                        </Button>
                      </form>
                      <form action={archiveContact}>
                        <input type="hidden" name="tenant_id" value={tenantId} />
                        <input type="hidden" name="contact_id" value={c.id} />
                        <input type="hidden" name="return_to" value={here} />
                        <Button type="submit" variant="danger">
                          Remove
                        </Button>
                      </form>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
        {canWrite && !account.archived_at ? (
          <details className="mt-2">
            <summary className="cursor-pointer text-sm font-medium">Add a contact</summary>
            <div className="mt-3">
              <ContactForm tenantId={tenantId} accountId={accountId} returnTo={here} />
            </div>
          </details>
        ) : null}
      </Card>

      <Card
        title="Agreements"
        description="The customer's recurring commitments. Every visit comes from one."
        actions={
          canQuote && !account.archived_at ? (
            <Link href={`/agreements/new?account_id=${accountId}`} className="rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50">
              New agreement
            </Link>
          ) : undefined
        }
      >
        {agreements.length === 0 ? (
          <Empty>No agreements yet.</Empty>
        ) : (
          <Table headers={["#", "Service", "Property", "Cadence", "Billing", "Recurring", "Term", "Open visits", "Status"]}>
            {agreements.map((a) => (
              <tr key={a.id}>
                <td className="py-2 pr-4">
                  <Link href={`/agreements/${a.id}`} className="font-medium hover:underline">
                    #{a.number}
                  </Link>
                </td>
                <td className="py-2 pr-4">{a.service_type_name}</td>
                <td className="py-2 pr-4">{a.property_name ?? ""}</td>
                <td className="py-2 pr-4">{CADENCE_LABELS[a.cadence]}</td>
                <td className="py-2 pr-4">{BILLING_MODE_LABELS[a.billing_mode]}</td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(a.recurring_price_cents)}</td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  {formatBusinessDate(a.starts_on)} to {formatBusinessDate(a.ends_on)}
                </td>
                <td className="py-2 pr-4 tabular-nums">{a.open_visits}</td>
                <td className="py-2 pr-4">
                  <Badge tone={AGREEMENT_TONE[a.status]}>{AGREEMENT_STATUS_LABELS[a.status]}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {billing ? (
        <Card
          title="Billing"
          description={account.past_due_since ? `Past due since ${formatBusinessDate(account.past_due_since)}.` : "In good standing."}
          actions={
            <Link href={`/billing/accounts/${account.id}`} className="text-sm text-emerald-800 underline">
              Statement and payment methods
            </Link>
          }
        >
          <dl className="grid gap-2 text-sm sm:grid-cols-3" data-testid="account-billing">
            <div>
              <dt className="text-stone-500">Balance</dt>
              <dd className="tabular-nums">{formatCents(billing.balance_cents)}</dd>
            </div>
            <div>
              <dt className="text-stone-500">Open invoices</dt>
              <dd className="tabular-nums">{formatCents(billing.open_invoices_cents)}</dd>
            </div>
            <div>
              <dt className="text-stone-500">Unallocated credit</dt>
              <dd className="tabular-nums">{formatCents(billing.unallocated_cents)}</dd>
            </div>
          </dl>
        </Card>
      ) : null}

      <Card title="Messages" description="Every message to and from this account, newest first, with what happened to it.">
        {canMessage && contacts.length ? (
          <form action={sendMessageAction} className="mb-4 grid gap-2 sm:grid-cols-6" data-testid="send-message">
            <input type="hidden" name="tenant_id" value={tenantId} />
            <input type="hidden" name="account_id" value={account.id} />
            <input type="hidden" name="return_to" value={`/customers/${account.id}`} />
            <Select name="contact_id" aria-label="To" className="sm:col-span-2">
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.phone ? `, ${c.phone}` : ""}
                  {c.email ? `, ${c.email}` : ""}
                </option>
              ))}
            </Select>
            <Select name="channel" aria-label="By" defaultValue="sms">
              <option value="sms">Text</option>
              <option value="email">Email</option>
            </Select>
            <Input name="subject" placeholder="Email subject" aria-label="Email subject" />
            <Input name="body" placeholder="Message" aria-label="Message" className="sm:col-span-2" required />
            <div className="sm:col-span-6">
              <Button type="submit" variant="secondary">
                Send
              </Button>
            </div>
          </form>
        ) : null}
        {messages.length === 0 ? (
          <Empty>No messages yet.</Empty>
        ) : (
          <ul className="grid gap-2 text-sm">
            {messages.map((m) => (
              <li key={m.id} className={`rounded-md border p-2 ${m.direction === "inbound" ? "border-emerald-200 bg-emerald-50" : "border-stone-200"}`} data-testid="timeline-message">
                <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                  <Badge tone={m.status === "delivered" || m.status === "sent" || m.status === "received" ? "good" : m.status === "failed" ? "bad" : m.status === "suppressed" ? "warn" : "neutral"}>{m.status}</Badge>
                  <span>
                    {m.direction === "inbound" ? `from ${m.from_address}` : `${m.channel === "sms" ? "text" : m.channel} to ${m.to_address || "nobody"}`}, {m.purpose.replace("_", " ")}
                  </span>
                  <span>{formatInstant(m.created_at, active.tenantTimezone)}</span>
                  {m.notice_id ? (
                    <Link href={`/compliance/notices/${m.notice_id}`} className="underline">
                      notice
                    </Link>
                  ) : null}
                  {m.direction === "outbound" && m.status !== "suppressed" ? (
                    <a href={`/m/${m.token}`} className="underline">
                      view
                    </a>
                  ) : null}
                </div>
                {m.subject ? <p className="font-medium">{m.subject}</p> : null}
                <p className="whitespace-pre-wrap">{m.body.length > 400 ? `${m.body.slice(0, 400)}...` : m.body}</p>
                {m.suppressed_reason ? <p className="text-xs text-amber-800">Not sent: {m.suppressed_reason}</p> : null}
                {m.error ? <p className="text-xs text-red-800">Failed: {m.error}</p> : null}
                {canMessage && m.direction === "inbound" && m.from_address ? (
                  <form action={replyAction} className="mt-2 flex gap-2">
                    <input type="hidden" name="tenant_id" value={tenantId} />
                    <input type="hidden" name="message_id" value={m.id} />
                    <input type="hidden" name="return_to" value={`/customers/${account.id}`} />
                    <Input name="body" placeholder="Reply by text" aria-label="Reply by text" className="flex-1" />
                    <Button type="submit" variant="secondary">
                      Reply
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Quotes">
        {quotes.length === 0 ? (
          <Empty>No quotes yet.</Empty>
        ) : (
          <Table headers={["Quote", "Status", "Options", "From", "Created"]}>
            {quotes.map((q) => (
              <tr key={q.id}>
                <td className="py-2 pr-4 font-medium">
                  <Link href={`/quotes/${q.id}`} className="hover:underline">
                    Quote #{q.number}
                  </Link>
                </td>
                <td className="py-2 pr-4">
                  <Badge tone={STATUS_TONE[q.status]}>{q.status}</Badge>
                </td>
                <td className="py-2 pr-4 tabular-nums">{q.options}</td>
                <td className="py-2 pr-4 tabular-nums">{q.best_total != null ? formatCents(q.best_total) : ""}</td>
                <td className="py-2 pr-4 text-stone-500">{new Date(q.created_at).toLocaleDateString("en-US")}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {canWrite ? (
        <Card title="Account details">
          <form action={updateAccount} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="tenant_id" value={tenantId} />
            <input type="hidden" name="account_id" value={accountId} />
            <Field label="Name" htmlFor="name">
              <Input id="name" name="name" defaultValue={account.name} required />
            </Field>
            <Field label="Type" htmlFor="type">
              <Select id="type" name="type" defaultValue={account.type}>
                <option value="residential">Residential</option>
                <option value="commercial">Commercial</option>
                <option value="property_manager">Property manager or landlord</option>
              </Select>
            </Field>
            <Field label="Email" htmlFor="email">
              <Input id="email" name="email" type="email" defaultValue={account.email ?? ""} />
            </Field>
            <Field label="Phone" htmlFor="phone">
              <Input id="phone" name="phone" defaultValue={account.phone ?? ""} />
            </Field>
            <Field label="Billing address" htmlFor="billing_line1">
              <Input id="billing_line1" name="billing_line1" defaultValue={account.billing_line1 ?? ""} />
            </Field>
            <Field label="Billing line 2" htmlFor="billing_line2">
              <Input id="billing_line2" name="billing_line2" defaultValue={account.billing_line2 ?? ""} />
            </Field>
            <Field label="City" htmlFor="billing_city">
              <Input id="billing_city" name="billing_city" defaultValue={account.billing_city ?? ""} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="State" htmlFor="billing_state_code">
                <Input id="billing_state_code" name="billing_state_code" defaultValue={account.billing_state_code ?? ""} pattern="[A-Za-z]{2}" maxLength={2} />
              </Field>
              <Field label="ZIP" htmlFor="billing_postal_code">
                <Input id="billing_postal_code" name="billing_postal_code" defaultValue={account.billing_postal_code ?? ""} />
              </Field>
            </div>
            <Field label="Payment terms (days)" htmlFor="terms_days">
              <Input id="terms_days" name="terms_days" type="number" min={0} max={120} defaultValue={account.terms_days} />
            </Field>
            <Field label="Status" htmlFor="status">
              <Select id="status" name="status" defaultValue={account.status}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="po_required" value="true" defaultChecked={account.po_required} /> Purchase order required on invoices
            </label>
            <div className="sm:col-span-2">
              <Field label="Notes" htmlFor="notes">
                <Textarea id="notes" name="notes" defaultValue={account.notes ?? ""} />
              </Field>
            </div>
            <div className="flex gap-3 sm:col-span-2">
              <input type="hidden" name="archive" value={account.archived_at ? "false" : "true"} />
              <Button type="submit">Save account</Button>
              <Button type="submit" variant="danger" formAction={archiveAccount}>
                {account.archived_at ? "Restore account" : "Archive account"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
