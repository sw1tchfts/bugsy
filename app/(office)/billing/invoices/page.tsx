import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Empty, Field, Input, Select, Table } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { addDays, formatBusinessDate, isIsoDate, todayInZone } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

export const metadata: Metadata = { title: "Invoices" };

const STATUSES = ["draft", "issued", "partially_paid", "paid", "past_due", "void"] as const;
const TONE: Record<string, "neutral" | "good" | "warn" | "bad"> = { draft: "neutral", issued: "warn", partially_paid: "warn", paid: "good", past_due: "bad", void: "neutral" };

type Row = {
  id: string;
  number: number | null;
  kind: string;
  status: string;
  issued_on: string | null;
  due_on: string | null;
  total_cents: string | number;
  paid_cents: string | number;
  source: string;
  account_id: string;
  account_name: string;
  tax_unconfirmed: boolean;
};

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; status?: string; q?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "billing.read");
  const params = await searchParams;
  const tenantId = active.tenantId;
  const today = todayInZone(active.tenantTimezone);
  const to = params.to && isIsoDate(params.to) ? params.to : today;
  const from = params.from && isIsoDate(params.from) ? params.from : addDays(to, -90);
  const status = params.status && (STATUSES as readonly string[]).includes(params.status) ? params.status : null;
  const q = params.q?.trim() || null;

  const rows = await dbAs(session, (tx) =>
    tx<Row[]>`
      select i.id, i.number, i.kind, i.status, i.issued_on, i.due_on, i.total_cents, i.paid_cents, i.source, i.account_id, a.name as account_name, i.tax_unconfirmed
      from public.invoices i join public.accounts a on a.id = i.account_id
      where i.tenant_id = ${tenantId}
        and (i.status = 'draft' or i.issued_on between ${from} and ${to})
        and (${status}::text is null or i.status = ${status})
        and (${q}::text is null or a.name ilike ${`%${q ?? ""}%`} or i.number::text = ${q ?? ""})
      order by i.status = 'draft' desc, i.issued_on desc nulls first, i.number desc nulls first
      limit 300`,
  );

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/billing" className="hover:underline">
          Billing
        </Link>
      </p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <Link href="/billing/invoices/new" className="text-sm text-emerald-800 underline">
          New one-off invoice
        </Link>
      </div>
      <Card title="Filter">
        <form method="get" className="grid gap-3 sm:grid-cols-5">
          <Field label="Issued from" htmlFor="from">
            <Input id="from" name="from" type="date" defaultValue={from} />
          </Field>
          <Field label="To" htmlFor="to">
            <Input id="to" name="to" type="date" defaultValue={to} />
          </Field>
          <Field label="Status" htmlFor="status">
            <Select id="status" name="status" defaultValue={status ?? ""}>
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Account or number" htmlFor="q">
            <Input id="q" name="q" defaultValue={q ?? ""} />
          </Field>
          <div className="self-end">
            <Button type="submit" variant="secondary">
              Show
            </Button>
          </div>
        </form>
      </Card>
      <Card title={`${rows.length} invoice(s)`}>
        {rows.length === 0 ? (
          <Empty>No invoices match.</Empty>
        ) : (
          <Table headers={["Number", "Account", "Issued", "Due", "Total", "Open", "Status", "Source"]}>
            {rows.map((r) => {
              const total = Number(r.total_cents);
              const open = total - Number(r.paid_cents);
              return (
                <tr key={r.id} data-testid="invoice-row">
                  <td className="py-2 pr-4 tabular-nums">
                    <Link href={`/billing/invoices/${r.id}`} className="underline">
                      {r.kind === "credit_memo" ? "CM " : ""}
                      {r.number !== null ? `#${r.number}` : "draft"}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    <Link href={`/billing/accounts/${r.account_id}`} className="hover:underline">
                      {r.account_name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{r.issued_on ? formatBusinessDate(r.issued_on) : ""}</td>
                  <td className="py-2 pr-4">{r.due_on ? formatBusinessDate(r.due_on) : ""}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatCents(total)}</td>
                  <td className="py-2 pr-4 tabular-nums">{r.kind === "invoice" && r.status !== "void" ? formatCents(open) : ""}</td>
                  <td className="py-2 pr-4">
                    <Badge tone={TONE[r.status] ?? "neutral"}>{r.status.replace("_", " ")}</Badge>
                    {r.tax_unconfirmed ? <Badge tone="warn">tax unconfirmed</Badge> : null}
                  </td>
                  <td className="py-2 pr-4 text-xs text-stone-600">{r.source.replace("_", " ")}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}
