import type { Metadata } from "next";
import Link from "next/link";
import { Button, Card, Empty, Field, Input, Notice, Table } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { EXPORT_FILES } from "@/lib/compliance/export";
import { addDays, formatBusinessDate, formatInstant, todayInZone } from "@/lib/dates";
import { listMembers } from "@/lib/dispatch/db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

export const metadata: Metadata = { title: "Inspector export" };

type Export = { id: string; from_date: string; to_date: string; state_code: string | null; file_count: number; created_at: string; created_by: string | null };

export default async function ExportPage() {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "compliance.read");
  const tenantId = active.tenantId;
  const canWrite = can(active.permissions, "compliance.write");
  const today = todayInZone(active.tenantTimezone);

  const { exports, members } = await dbAs(session, async (tx) => ({
    exports: await tx<Export[]>`select id, from_date, to_date, state_code, file_count, created_at, created_by from public.compliance_exports where tenant_id = ${tenantId} order by created_at desc limit 50`,
    members: await listMembers(tx, tenantId),
  }));
  const nameOf = (id: string | null) => (id ? (members.find((m) => m.user_id === id)?.name ?? "Unknown member") : "");

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/compliance" className="hover:underline">
          Compliance
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Inspector export</h1>
      <p className="text-sm text-stone-600">
        One zip for a range of business dates: {EXPORT_FILES.join(", ")}. The binder prints as a single document; the CSV columns are fixed. Every export is logged.
      </p>
      {canWrite ? (
        <Card title="Export a range">
          <form method="get" action="/api/compliance/export" className="grid gap-3 sm:grid-cols-4">
            <Field label="From" htmlFor="exp-from">
              <Input id="exp-from" name="from" type="date" defaultValue={addDays(today, -30)} required />
            </Field>
            <Field label="To" htmlFor="exp-to">
              <Input id="exp-to" name="to" type="date" defaultValue={today} required />
            </Field>
            <Field label="State (blank for all)" htmlFor="exp-state">
              <Input id="exp-state" name="state" maxLength={2} />
            </Field>
            <div className="self-end">
              <Button type="submit">Download zip</Button>
            </div>
          </form>
        </Card>
      ) : (
        <Notice kind="info">Exports need compliance.write.</Notice>
      )}
      <Card title="Past exports">
        {exports.length === 0 ? (
          <Empty>No exports yet.</Empty>
        ) : (
          <Table headers={["When", "By", "Range", "State", "Files"]}>
            {exports.map((e) => (
              <tr key={e.id} data-testid="export-row">
                <td className="py-2 pr-4">{formatInstant(e.created_at, active.tenantTimezone)}</td>
                <td className="py-2 pr-4">{nameOf(e.created_by)}</td>
                <td className="py-2 pr-4">
                  {formatBusinessDate(e.from_date)} to {formatBusinessDate(e.to_date)}
                </td>
                <td className="py-2 pr-4">{e.state_code ?? "all"}</td>
                <td className="py-2 pr-4 tabular-nums">{e.file_count}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
