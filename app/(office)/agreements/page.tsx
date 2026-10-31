import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Empty, Field, Input, Notice, Table, errorMessage } from "@/components/ui";
import { BILLING_MODE_LABELS, type BillingMode, CADENCE_LABELS, type Cadence } from "@/lib/agreements/cadence";
import { AGREEMENT_STATUS_LABELS } from "@/lib/agreements/forms";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { addDays, formatBusinessDate, todayInZone } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { createCancelReason, runAutoRenewals, toggleCancelReason } from "./actions";

export const metadata: Metadata = { title: "Agreements" };

type Row = {
  id: string;
  number: number;
  status: keyof typeof AGREEMENT_STATUS_LABELS;
  account_id: string;
  account_name: string;
  property_name: string | null;
  property_address: string;
  service_type_name: string;
  cadence: Cadence;
  billing_mode: BillingMode;
  recurring_price_cents: string;
  starts_on: string;
  ends_on: string;
  auto_renew: boolean;
  open_visits: number;
};

type Reservice = { id: string; agreement_id: string; number: number; account_name: string; property_address: string; due_start: string; due_end: string; status: string; reservice_reason: string | null };
type Reason = { id: string; key: string; name: string; active: boolean; used: number };

const STATUS_TONE: Record<Row["status"], "neutral" | "good" | "warn" | "bad"> = { draft: "neutral", active: "good", on_hold: "warn", cancelled: "bad", ended: "neutral" };
const VIEWS = ["all", "renewals", "reservices", "reasons"] as const;

export default async function AgreementsPage({ searchParams }: { searchParams: Promise<{ error?: string; view?: string; status?: string }> }) {
  const { session, active } = await requireActiveTenant();
  const { error, view: rawView, status } = await searchParams;
  const view = (VIEWS as readonly string[]).includes(rawView ?? "") ? (rawView as (typeof VIEWS)[number]) : "all";
  const tenantId = active.tenantId;
  const canWrite = can(active.permissions, "agreements.write");
  const today = todayInZone(active.tenantTimezone);
  const horizon = addDays(today, 30);

  const [rows, reservices, reasons] = await dbAs(session, async (tx) => {
    const rows = await tx<Row[]>`
      select a.id, a.number, a.status, a.account_id, ac.name as account_name, p.name as property_name, p.normalized_address as property_address,
             st.name as service_type_name, a.cadence, a.billing_mode, a.recurring_price_cents, a.starts_on, a.ends_on, a.auto_renew,
             (select count(*)::int from public.visits v where v.agreement_id = a.id and v.status in ('planned', 'scheduled')) as open_visits
      from public.agreements a
        join public.accounts ac on ac.id = a.account_id
        join public.properties p on p.id = a.property_id
        join public.service_types st on st.id = a.service_type_id
      where a.tenant_id = ${tenantId} and a.archived_at is null
        and (${view} <> 'renewals' or (a.status = 'active' and a.ends_on <= ${horizon}))
        and (${status ?? ""} = '' or a.status = ${status ?? ""})
      order by case a.status when 'active' then 0 when 'draft' then 1 when 'on_hold' then 2 else 3 end, a.ends_on, a.number`;
    const reservices = await tx<Reservice[]>`
      select v.id, v.agreement_id, a.number, ac.name as account_name, p.normalized_address as property_address, v.due_start, v.due_end, v.status, v.reservice_reason
      from public.visits v join public.agreements a on a.id = v.agreement_id join public.accounts ac on ac.id = v.account_id join public.properties p on p.id = v.property_id
      where v.tenant_id = ${tenantId} and v.kind = 'reservice' and v.status in ('planned', 'scheduled')
      order by v.due_start`;
    const reasons = await tx<Reason[]>`
      select r.id, r.key, r.name, r.active, (select count(*)::int from public.agreements a where a.cancel_reason_id = r.id) as used
      from public.cancel_reasons r where r.tenant_id = ${tenantId} order by r.active desc, r.name`;
    return [rows, reservices, reasons] as const;
  });

  const tab = (key: (typeof VIEWS)[number], label: string, count?: number) => (
    <Link key={key} href={key === "all" ? "/agreements" : `/agreements?view=${key}`} className={`rounded px-3 py-1.5 text-sm ${view === key ? "bg-emerald-900 text-white" : "bg-white text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50"}`}>
      {label}
      {count !== undefined ? ` (${count})` : ""}
    </Link>
  );

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Agreements</h1>
          <p className="mt-1 text-sm text-stone-600">The customer&apos;s recurring commitment: what, how often, at what price, billed how. Every visit comes from one.</p>
        </div>
        <div className="flex gap-2">
          {canWrite ? (
            <Link href="/agreements/price-increases" className="rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50">
              Price increases
            </Link>
          ) : null}
          {canWrite ? (
            <Link href="/agreements/new" className="rounded bg-emerald-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800">
              New agreement
            </Link>
          ) : null}
        </div>
      </div>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      <div className="flex flex-wrap gap-2">
        {tab("all", "All")}
        {tab("renewals", "Ending within 30 days")}
        {tab("reservices", "Open re-services", reservices.length)}
        {canWrite ? tab("reasons", "Cancel reasons") : null}
      </div>

      {view === "reservices" ? (
        <Card title="Open re-services" description="Free return visits waiting for dispatch. Their labor and product cost still count.">
          {reservices.length === 0 ? (
            <Empty>No open re-services.</Empty>
          ) : (
            <Table headers={["Agreement", "Account", "Property", "Due", "What the customer sees", "Status"]}>
              {reservices.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-4">
                    <Link href={`/agreements/${r.agreement_id}`} className="font-medium hover:underline">
                      #{r.number}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{r.account_name}</td>
                  <td className="py-2 pr-4">{r.property_address}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {formatBusinessDate(r.due_start)} to {formatBusinessDate(r.due_end)}
                  </td>
                  <td className="py-2 pr-4">{r.reservice_reason}</td>
                  <td className="py-2 pr-4">{r.status}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      ) : view === "reasons" ? (
        <Card title="Cancel reasons" description="Every cancellation records one. Reasons in use can be deactivated, not deleted, so retention reports keep their history.">
          <Table headers={["Reason", "Key", "Used", "Active", ""]}>
            {reasons.map((r) => (
              <tr key={r.id} className={r.active ? "" : "text-stone-400"}>
                <td className="py-2 pr-4 font-medium">{r.name}</td>
                <td className="py-2 pr-4 font-mono text-xs">{r.key}</td>
                <td className="py-2 pr-4 tabular-nums">{r.used}</td>
                <td className="py-2 pr-4">{r.active ? "yes" : "no"}</td>
                <td className="py-2 text-right">
                  <form action={toggleCancelReason}>
                    <input type="hidden" name="tenant_id" value={tenantId} />
                    <input type="hidden" name="reason_id" value={r.id} />
                    <input type="hidden" name="active" value={r.active ? "false" : "true"} />
                    <Button type="submit" variant="secondary">
                      {r.active ? "Deactivate" : "Activate"}
                    </Button>
                  </form>
                </td>
              </tr>
            ))}
          </Table>
          <form action={createCancelReason} className="mt-4 flex items-end gap-2 border-t border-stone-200 pt-4">
            <input type="hidden" name="tenant_id" value={tenantId} />
            <Field label="New reason" htmlFor="reason-name">
              <Input id="reason-name" name="name" required maxLength={60} />
            </Field>
            <Button type="submit">Add reason</Button>
          </form>
        </Card>
      ) : (
        <Card
          title={view === "renewals" ? "Ending within 30 days" : "All agreements"}
          description={
            view === "renewals"
              ? "Auto-renewing agreements renew themselves when they come within 30 days of their end; the rest need a call."
              : "Active first, then drafts; cancelled and ended at the bottom."
          }
          actions={
            view === "renewals" && canWrite ? (
              <form action={runAutoRenewals}>
                <input type="hidden" name="tenant_id" value={tenantId} />
                <Button type="submit" variant="secondary">
                  Run auto-renewals
                </Button>
              </form>
            ) : undefined
          }
        >
          {rows.length === 0 ? (
            <Empty>{view === "renewals" ? "Nothing ends in the next 30 days." : "No agreements yet."}</Empty>
          ) : (
            <Table headers={["#", "Account", "Property", "Service", "Cadence", "Billing", "Recurring", "Term", "Open visits", "Status"]}>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-4">
                    <Link href={`/agreements/${r.id}`} className="font-medium hover:underline">
                      #{r.number}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    <Link href={`/customers/${r.account_id}`} className="hover:underline">
                      {r.account_name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{r.property_name ?? r.property_address}</td>
                  <td className="py-2 pr-4">{r.service_type_name}</td>
                  <td className="py-2 pr-4">{CADENCE_LABELS[r.cadence]}</td>
                  <td className="py-2 pr-4">{BILLING_MODE_LABELS[r.billing_mode]}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatCents(r.recurring_price_cents)}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {formatBusinessDate(r.starts_on)} to {formatBusinessDate(r.ends_on)} {r.auto_renew ? <Badge>auto-renew</Badge> : null}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{r.open_visits}</td>
                  <td className="py-2 pr-4">
                    <Badge tone={STATUS_TONE[r.status]}>{AGREEMENT_STATUS_LABELS[r.status]}</Badge>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
