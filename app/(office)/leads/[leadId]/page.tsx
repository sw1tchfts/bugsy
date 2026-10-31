import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddressFields, PropertyTypeSelect } from "@/components/customers/fields";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Table, Textarea, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { type LeadStage, STAGE_LABELS, canTransition } from "@/lib/customers/pipeline";
import { formatCents } from "@/lib/money";
import { formatInstant, formatInstantDate } from "@/lib/dates";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { createQuote } from "@/app/(office)/quotes/actions";
import { convertLead, setLeadStage, updateLead } from "../actions";

export const metadata: Metadata = { title: "Lead" };

type Lead = {
  id: string; name: string; stage: LeadStage; source_id: string; source_name: string; email: string | null; phone: string | null;
  line1: string | null; line2: string | null; city: string | null; state_code: string | null; postal_code: string | null; normalized_address: string | null;
  geocode_status: string; property_type: string | null; notes: string | null; inspection_at: string | null; lost_reason: string | null;
  account_id: string | null; property_id: string | null; won_at: string | null; lost_at: string | null; created_at: string;
};
type Quote = { id: string; number: number; status: string; created_at: string; options: number; best_total: number | null };

const STAGE_TONE: Record<LeadStage, "neutral" | "good" | "warn" | "bad"> = { new: "neutral", inspection_booked: "warn", quoted: "warn", won: "good", lost: "bad" };

export default async function LeadPage({ params, searchParams }: { params: Promise<{ leadId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { leadId } = await params;
  const { error } = await searchParams;
  const { session, active } = await requireActiveTenant();
  const tenantId = active.tenantId;
  const canWrite = can(active.permissions, "customers.write");
  const canQuote = can(active.permissions, "agreements.write");

  const data = await dbAs(session, async (tx) => {
    const [lead] = await tx<Lead[]>`
      select l.*, s.name as source_name from public.leads l join public.lead_sources s on s.id = l.source_id
      where l.id = ${leadId} and l.tenant_id = ${tenantId}`;
    if (!lead) return null;
    const sources = await tx<{ id: string; name: string }[]>`select id, name from public.lead_sources where tenant_id = ${tenantId} and (active or id = ${lead.source_id}) order by name`;
    const quotes = await tx<Quote[]>`
      select q.id, q.number, q.status, q.created_at,
             (select count(*)::int from public.quote_options o where o.quote_id = q.id) as options,
             (select min(o.total_cents) from public.quote_options o where o.quote_id = q.id) as best_total
      from public.quotes q where q.lead_id = ${leadId} order by q.created_at desc`;
    return { lead, sources, quotes };
  });
  if (!data) notFound();
  const { lead, sources, quotes } = data;
  const open = !["won", "lost"].includes(lead.stage);
  const hasAddress = !!lead.normalized_address;

  return (
    <>
      <div>
        <p className="text-sm text-stone-500">
          <Link href="/leads" className="hover:underline">
            Leads
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">
          {lead.name} <Badge tone={STAGE_TONE[lead.stage]}>{STAGE_LABELS[lead.stage]}</Badge>
        </h1>
        <p className="text-sm text-stone-600">
          Source: {lead.source_name}. Created {formatInstantDate(lead.created_at, active.tenantTimezone)}.
          {lead.inspection_at ? ` Inspection ${formatInstant(lead.inspection_at, active.tenantTimezone)}.` : ""}
          {lead.account_id ? (
            <>
              {" "}
              Converted to{" "}
              <Link href={`/customers/${lead.account_id}`} className="text-emerald-800 underline">
                the account
              </Link>
              .
            </>
          ) : null}
        </p>
      </div>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      {canWrite && open ? (
        <Card title="Next step">
          <div className="flex flex-wrap gap-6">
            {canTransition(lead.stage, "inspection_booked") ? (
              <form action={setLeadStage} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="tenant_id" value={tenantId} />
                <input type="hidden" name="lead_id" value={leadId} />
                <input type="hidden" name="stage" value="inspection_booked" />
                <Field label="Inspection date and time" htmlFor="inspection_at">
                  <Input id="inspection_at" name="inspection_at" type="datetime-local" required />
                </Field>
                <Button type="submit">Book inspection</Button>
              </form>
            ) : null}
            {canTransition(lead.stage, "quoted") && lead.stage !== "quoted" ? (
              <form action={setLeadStage}>
                <input type="hidden" name="tenant_id" value={tenantId} />
                <input type="hidden" name="lead_id" value={leadId} />
                <input type="hidden" name="stage" value="quoted" />
                <Button type="submit" variant="secondary">
                  Mark quoted
                </Button>
              </form>
            ) : null}
            <form action={convertLead}>
              <input type="hidden" name="tenant_id" value={tenantId} />
              <input type="hidden" name="lead_id" value={leadId} />
              <Button type="submit" disabled={!hasAddress} title={hasAddress ? "" : "Add the service address first"}>
                Mark won and convert
              </Button>
            </form>
            <form action={setLeadStage} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="tenant_id" value={tenantId} />
              <input type="hidden" name="lead_id" value={leadId} />
              <input type="hidden" name="stage" value="lost" />
              <Field label="Lost because" htmlFor="lost_reason">
                <Input id="lost_reason" name="lost_reason" required maxLength={120} />
              </Field>
              <Button type="submit" variant="danger">
                Mark lost
              </Button>
            </form>
          </div>
        </Card>
      ) : null}
      {canWrite && lead.stage === "lost" ? (
        <form action={setLeadStage}>
          <input type="hidden" name="tenant_id" value={tenantId} />
          <input type="hidden" name="lead_id" value={leadId} />
          <input type="hidden" name="stage" value="new" />
          <Button type="submit" variant="secondary">
            Reopen lead
          </Button>
        </form>
      ) : null}

      <Card
        title="Quotes"
        actions={
          canQuote && open ? (
            <form action={createQuote}>
              <input type="hidden" name="tenant_id" value={tenantId} />
              <input type="hidden" name="lead_id" value={leadId} />
              <Button type="submit" variant="secondary">
                New quote
              </Button>
            </form>
          ) : undefined
        }
      >
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
                  <Badge tone={q.status === "accepted" ? "good" : q.status === "declined" ? "bad" : q.status === "sent" ? "warn" : "neutral"}>{q.status}</Badge>
                </td>
                <td className="py-2 pr-4 tabular-nums">{q.options}</td>
                <td className="py-2 pr-4 tabular-nums">{q.best_total != null ? formatCents(q.best_total) : ""}</td>
                <td className="py-2 pr-4 text-stone-500">{new Date(q.created_at).toLocaleDateString("en-US")}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Lead details" description={canWrite && open ? "Saving re-validates the address." : undefined}>
        <form action={updateLead} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="tenant_id" value={tenantId} />
          <input type="hidden" name="lead_id" value={leadId} />
          <Field label="Name" htmlFor="name">
            <Input id="name" name="name" defaultValue={lead.name} required disabled={!canWrite} />
          </Field>
          <Field label="Lead source" htmlFor="source_id">
            <Select id="source_id" name="source_id" defaultValue={lead.source_id} disabled={!canWrite}>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Phone" htmlFor="phone">
            <Input id="phone" name="phone" defaultValue={lead.phone ?? ""} disabled={!canWrite} />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" defaultValue={lead.email ?? ""} disabled={!canWrite} />
          </Field>
          <AddressFields values={{ line1: lead.line1 ?? "", line2: lead.line2 ?? "", city: lead.city ?? "", state_code: lead.state_code ?? "", postal_code: lead.postal_code ?? "" }} required={false} />
          <PropertyTypeSelect value={lead.property_type ?? undefined} required={false} />
          <div className="sm:col-span-2">
            <Field label="Notes" htmlFor="notes">
              <Textarea id="notes" name="notes" defaultValue={lead.notes ?? ""} disabled={!canWrite} />
            </Field>
          </div>
          {canWrite && open ? (
            <div className="sm:col-span-2">
              <Button type="submit">Save lead</Button>
            </div>
          ) : null}
        </form>
      </Card>
    </>
  );
}
