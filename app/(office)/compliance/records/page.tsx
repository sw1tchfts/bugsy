import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Empty, Field, Input, Select, Table } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { addDays, formatBusinessDate, formatInstant, isIsoDate, todayInZone } from "@/lib/dates";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

export const metadata: Metadata = { title: "Application records" };

type Row = {
  id: string;
  business_date: string;
  status: string;
  complete: boolean;
  missing_fields: string[];
  state_code: string;
  job_kind: string;
  locked_at: string | null;
  lock_due_at: string;
  account: string;
  address: string;
  service_type: string;
  amendments: number;
};

export default async function RecordsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; status?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "compliance.read");
  const params = await searchParams;
  const tenantId = active.tenantId;
  const today = todayInZone(active.tenantTimezone);
  const to = params.to && isIsoDate(params.to) ? params.to : today;
  const from = params.from && isIsoDate(params.from) ? params.from : addDays(to, -30);
  const status = params.status === "draft" || params.status === "locked" ? params.status : null;

  const rows = await dbAs(session, (tx) =>
    tx<Row[]>`
      select r.id, r.business_date, r.status, r.complete, r.missing_fields, r.state_code, r.job_kind, r.locked_at, r.lock_due_at,
             r.snapshot->'account'->>'name' as account, r.snapshot->'property'->>'address' as address, r.snapshot->'service_type'->>'name' as service_type,
             (select count(*)::int from public.application_record_amendments a where a.record_id = r.id) as amendments
      from public.application_records r
      where r.tenant_id = ${tenantId} and r.business_date between ${from} and ${to} and (${status}::text is null or r.status = ${status})
      order by r.business_date desc, r.locked_at desc nulls first`,
  );

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/compliance" className="hover:underline">
          Compliance
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Application records</h1>
      <p className="text-sm text-stone-600">One record per completed pesticide visit, snapshotted from the stop and locked when the state says it must be complete. Locked records change only by amendment.</p>
      <Card title="Range">
        <form method="get" className="grid gap-3 sm:grid-cols-4">
          <Field label="From" htmlFor="from">
            <Input id="from" name="from" type="date" defaultValue={from} />
          </Field>
          <Field label="To" htmlFor="to">
            <Input id="to" name="to" type="date" defaultValue={to} />
          </Field>
          <Field label="Status" htmlFor="status">
            <Select id="status" name="status" defaultValue={status ?? ""}>
              <option value="">All</option>
              <option value="draft">Draft (waiting to lock)</option>
              <option value="locked">Locked</option>
            </Select>
          </Field>
          <div className="self-end">
            <Button type="submit" variant="secondary">
              Show
            </Button>
          </div>
        </form>
      </Card>
      <Card title={`${rows.length} record(s)`}>
        {rows.length === 0 ? (
          <Empty>No records in this range.</Empty>
        ) : (
          <Table headers={["Business date", "Customer and property", "Service", "State", "Status", "Fields", "Amendments"]}>
            {rows.map((r) => (
              <tr key={r.id} data-testid="record-row">
                <td className="py-2 pr-4 tabular-nums">
                  <Link href={`/compliance/records/${r.id}`} className="underline">
                    {formatBusinessDate(r.business_date)}
                  </Link>
                </td>
                <td className="py-2 pr-4">
                  <span className="font-medium">{r.account}</span>
                  <br />
                  <span className="text-xs text-stone-600">{r.address}</span>
                </td>
                <td className="py-2 pr-4">
                  {r.service_type}
                  <br />
                  <span className="text-xs text-stone-500">{r.job_kind.replace(/_/g, " ")}</span>
                </td>
                <td className="py-2 pr-4">{r.state_code}</td>
                <td className="py-2 pr-4">
                  {r.status === "locked" ? <Badge tone="good">locked {r.locked_at ? formatInstant(r.locked_at, active.tenantTimezone) : ""}</Badge> : <Badge tone="warn">draft, locks {formatInstant(r.lock_due_at, active.tenantTimezone)}</Badge>}
                </td>
                <td className="py-2 pr-4">{r.complete ? <Badge tone="good">complete</Badge> : <Badge tone="bad">missing {r.missing_fields.join(", ")}</Badge>}</td>
                <td className="py-2 pr-4 tabular-nums">{r.amendments}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
