import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Empty, Field, Select, Table } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { NOTICE_KIND_LABELS as KIND_LABELS, type NoticeKind } from "@/lib/compliance/notices";
import { formatBusinessDate, formatInstant } from "@/lib/dates";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

export const metadata: Metadata = { title: "Notices" };

type Row = {
  id: string;
  kind: string;
  required: boolean;
  rule_key: string;
  recipient_name: string;
  channel: string;
  due_by: string | null;
  for_scheduled_for: string | null;
  status: string;
  sent_at: string | null;
  visit_id: string | null;
  address: string;
};

export default async function NoticesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "compliance.read");
  const { status: raw } = await searchParams;
  const tenantId = active.tenantId;
  const status = raw && ["due", "sent", "failed", "waived"].includes(raw) ? raw : null;

  const rows = await dbAs(session, (tx) =>
    tx<Row[]>`
      select n.id, n.kind, n.required, n.rule_key, n.recipient_name, n.channel, n.due_by, n.for_scheduled_for, n.status, n.sent_at, n.visit_id,
             concat_ws(' ', p.line1, p.city) as address
      from public.notices n join public.properties p on p.id = n.property_id
      where n.tenant_id = ${tenantId} and (${status}::text is null or n.status = ${status})
      order by case n.status when 'due' then 0 when 'failed' then 1 else 2 end, n.due_by nulls last, n.created_at desc
      limit 300`,
  );
  const now = new Date().toISOString();

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/compliance" className="hover:underline">
          Compliance
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Notices</h1>
      <p className="text-sm text-stone-600">
        Every notice obligation as a row: what the state requires (or, with no state rule on file, what we do as best practice), when it is due, how it goes out and the proof. Email and text rows wait for messaging (spec 11); anything can be printed and recorded here.
      </p>
      <Card title="Filter">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <Field label="Status" htmlFor="status">
            <Select id="status" name="status" defaultValue={status ?? ""}>
              <option value="">All</option>
              <option value="due">Due</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
              <option value="waived">Waived</option>
            </Select>
          </Field>
          <Button type="submit" variant="secondary">
            Show
          </Button>
        </form>
      </Card>
      <Card title={`${rows.length} notice(s)`}>
        {rows.length === 0 ? (
          <Empty>No notices.</Empty>
        ) : (
          <Table headers={["Kind", "Recipient", "Property", "Channel", "Due", "Status"]}>
            {rows.map((n) => (
              <tr key={n.id} data-testid="notice-row">
                <td className="py-2 pr-4">
                  <Link href={`/compliance/notices/${n.id}`} className="underline">
                    {KIND_LABELS[n.kind as NoticeKind] ?? n.kind}
                  </Link>
                  <br />
                  {n.required ? <Badge tone="warn">required ({n.rule_key})</Badge> : <Badge>best practice</Badge>}
                </td>
                <td className="py-2 pr-4">{n.recipient_name}</td>
                <td className="py-2 pr-4 text-xs text-stone-600">
                  {n.address}
                  {n.visit_id ? (
                    <>
                      {" "}
                      <Link href={`/dispatch/visits/${n.visit_id}`} className="underline">
                        visit
                      </Link>
                    </>
                  ) : null}
                </td>
                <td className="py-2 pr-4">{n.channel}</td>
                <td className="py-2 pr-4">
                  {n.due_by ? (n.status === "due" && n.due_by < now ? <Badge tone="bad">{formatInstant(n.due_by, active.tenantTimezone)}</Badge> : formatInstant(n.due_by, active.tenantTimezone)) : "no legal due time"}
                  {n.for_scheduled_for ? <span className="block text-xs text-stone-500">for the visit on {formatBusinessDate(n.for_scheduled_for)}</span> : null}
                </td>
                <td className="py-2 pr-4">
                  {n.status === "sent" ? <Badge tone="good">sent {n.sent_at ? formatInstant(n.sent_at, active.tenantTimezone) : ""}</Badge> : n.status === "waived" ? <Badge>waived</Badge> : n.status === "failed" ? <Badge tone="bad">failed</Badge> : <Badge tone="warn">due</Badge>}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
