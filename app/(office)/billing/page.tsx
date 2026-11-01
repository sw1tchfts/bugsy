import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Empty, Notice, Table, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { loadSettings } from "@/lib/billing/db";
import { addDays, formatBusinessDate, formatInstant, todayInZone } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { runBillingNow } from "./actions";

export const metadata: Metadata = { title: "Billing" };

type Aging = { bucket: string; open_cents: string | number; invoices: number };
type PastDueAccount = { id: string; name: string; past_due_since: string; open_cents: string | number };
type Attempt = { id: string; invoice_id: string; number: number | null; account_name: string; attempt: number; attempted_at: string | null; result: string | null; error: string | null };
type Draft = { id: string; account_name: string; total_cents: string | number; po_required: boolean; created_at: string };

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ error?: string; note?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "billing.read");
  const { error, note } = await searchParams;
  const tenantId = active.tenantId;
  const canWrite = can(active.permissions, "billing.write");
  const today = todayInZone(active.tenantTimezone);

  const data = await dbAs(session, async (tx) => {
    const aging = await tx<Aging[]>`
      select case when due_on >= ${today} then 'current' when due_on >= ${addDays(today, -30)} then '1 to 30 days' when due_on >= ${addDays(today, -60)} then '31 to 60 days' else 'over 60 days' end as bucket,
             sum(total_cents - paid_cents) as open_cents, count(*)::int as invoices
      from public.invoices where tenant_id = ${tenantId} and kind = 'invoice' and status in ('issued', 'partially_paid', 'past_due')
      group by 1 order by min(due_on) desc`;
    const pastDue = await tx<PastDueAccount[]>`
      select a.id, a.name, a.past_due_since, (select sum(i.total_cents - i.paid_cents) from public.invoices i where i.account_id = a.id and i.status = 'past_due') as open_cents
      from public.accounts a where a.tenant_id = ${tenantId} and a.past_due_since is not null order by a.past_due_since limit 50`;
    const attempts = await tx<Attempt[]>`
      select t.id, t.invoice_id, i.number, a.name as account_name, t.attempt, t.attempted_at, t.result, t.error
      from public.autopay_attempts t join public.invoices i on i.id = t.invoice_id join public.accounts a on a.id = i.account_id
      where t.tenant_id = ${tenantId} and t.result in ('failed', 'skipped') and i.status in ('issued', 'partially_paid', 'past_due') order by t.attempted_at desc limit 30`;
    const drafts = await tx<Draft[]>`
      select i.id, a.name as account_name, i.total_cents, a.po_required, i.created_at from public.invoices i join public.accounts a on a.id = i.account_id
      where i.tenant_id = ${tenantId} and i.status = 'draft' order by i.created_at desc limit 50`;
    const [totals] = await tx<{ open_cents: string | number; unallocated: string | number }[]>`
      select (select coalesce(sum(total_cents - paid_cents), 0) from public.invoices where tenant_id = ${tenantId} and kind = 'invoice' and status in ('issued', 'partially_paid', 'past_due')) as open_cents,
             (select coalesce(sum(p.amount_cents - coalesce((select sum(x.amount_cents) from public.payment_allocations x where x.payment_id = p.id), 0) - coalesce((select sum(r.amount_cents) from public.payments r where r.refund_of = p.id and r.status = 'succeeded'), 0)), 0)
              from public.payments p where p.tenant_id = ${tenantId} and p.kind = 'payment' and p.status = 'succeeded') as unallocated`;
    return { aging, pastDue, attempts, drafts, totals, settings: await loadSettings(tx, tenantId) };
  });

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Billing</h1>
          <p className="mt-1 text-sm text-stone-600">
            Invoices from each agreement&apos;s billing mode, payments and autopay, collections and statements. Gateway: {data.settings.gateway === "stripe" ? "Stripe Connect" : "local (no keys; the flows run as they will on Stripe)"}.
          </p>
        </div>
        {canWrite ? (
          <form action={runBillingNow}>
            <input type="hidden" name="tenant_id" value={tenantId} />
            <Button type="submit" variant="secondary">
              Run the billing job now
            </Button>
          </form>
        ) : null}
      </div>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}
      {note ? <Notice kind="success">{note}</Notice> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-stone-600">Open receivables</p>
          <p className="text-2xl font-semibold" data-testid="open-ar">
            {formatCents(Number(data.totals.open_cents))}
          </p>
          <p className="text-xs text-stone-500">{formatCents(Number(data.totals.unallocated))} unallocated credit on accounts</p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-stone-600">Past-due accounts</p>
          <p className="text-2xl font-semibold" data-testid="past-due-count">
            {data.pastDue.length}
          </p>
          <p className="text-xs text-stone-500">
            grace {data.settings.grace_days} day(s); service {data.settings.pause_when_past_due ? "on hold when past due" : "continues when past due"}.{" "}
            <Link href="/billing/settings" className="underline">
              Settings
            </Link>
          </p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-stone-600">Sections</p>
          <p className="text-sm">
            <Link href="/billing/invoices" className="underline">
              Invoices
            </Link>
            {" · "}
            <Link href="/billing/tax" className="underline">
              Tax collected
            </Link>
            {" · "}
            <Link href="/billing/settings" className="underline">
              Settings
            </Link>
          </p>
        </div>
      </div>

      <Card title="Aging" description="Open invoices by how far past their due date they are.">
        {data.aging.length === 0 ? (
          <Empty>Nothing open.</Empty>
        ) : (
          <Table headers={["Bucket", "Invoices", "Open"]}>
            {data.aging.map((a) => (
              <tr key={a.bucket}>
                <td className="py-2 pr-4">{a.bucket}</td>
                <td className="py-2 pr-4 tabular-nums">{a.invoices}</td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(Number(a.open_cents))}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Past due" description="Accounts with an invoice open past its due date and grace period.">
        {data.pastDue.length === 0 ? (
          <Empty>No account is past due.</Empty>
        ) : (
          <Table headers={["Account", "Since", "Past due"]}>
            {data.pastDue.map((a) => (
              <tr key={a.id} data-testid="past-due-row">
                <td className="py-2 pr-4">
                  <Link href={`/billing/accounts/${a.id}`} className="underline">
                    {a.name}
                  </Link>
                </td>
                <td className="py-2 pr-4">{formatBusinessDate(a.past_due_since)}</td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(Number(a.open_cents ?? 0))}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Autopay attempts that failed" description="Retries follow the settings; after the last one the invoice stays open and the account is flagged.">
        {data.attempts.length === 0 ? (
          <Empty>No failed attempts on open invoices.</Empty>
        ) : (
          <Table headers={["Invoice", "Account", "Attempt", "When", "Result"]}>
            {data.attempts.map((t) => (
              <tr key={t.id} data-testid="autopay-failure">
                <td className="py-2 pr-4">
                  <Link href={`/billing/invoices/${t.invoice_id}`} className="underline">
                    #{t.number}
                  </Link>
                </td>
                <td className="py-2 pr-4">{t.account_name}</td>
                <td className="py-2 pr-4">{t.attempt}</td>
                <td className="py-2 pr-4">{t.attempted_at ? formatInstant(t.attempted_at, active.tenantTimezone) : ""}</td>
                <td className="py-2 pr-4">
                  <Badge tone="bad">{t.result}</Badge> {t.error}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Drafts waiting" description="Invoices that need a PO number or a decision before they go out.">
        {data.drafts.length === 0 ? (
          <Empty>No drafts.</Empty>
        ) : (
          <Table headers={["Account", "Amount", "Why", "Created"]}>
            {data.drafts.map((d) => (
              <tr key={d.id} data-testid="draft-row">
                <td className="py-2 pr-4">
                  <Link href={`/billing/invoices/${d.id}`} className="underline">
                    {d.account_name}
                  </Link>
                </td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(Number(d.total_cents))}</td>
                <td className="py-2 pr-4">{d.po_required ? "PO number required" : "manual draft"}</td>
                <td className="py-2 pr-4">{formatInstant(d.created_at, active.tenantTimezone)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
