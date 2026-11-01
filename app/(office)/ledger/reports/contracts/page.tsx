import type { Metadata } from "next";
import Link from "next/link";
import { Button, Card, Empty, Field, Input, Notice, Select, Table, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { todayInZone } from "@/lib/dates";
import { rollForwardFor } from "@/lib/ledger/db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { recordOpeningPosition } from "../../actions";
import { rangeFromParams, signed } from "../../helpers";

export const metadata: Metadata = { title: "Deferred revenue roll-forward" };

export default async function ContractsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; error?: string; note?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "gl.read");
  const params = await searchParams;
  const today = todayInZone(active.tenantTimezone);
  const range = rangeFromParams(params, today);
  const canWrite = can(active.permissions, "gl.write");
  const data = await dbAs(session, async (tx) => ({
    report: await rollForwardFor(tx, active.tenantId, range),
    agreements: canWrite
      ? await tx<{ id: string; number: number; account_name: string; billing_mode: string }[]>`
          select a.id, a.number, c.name as account_name, a.billing_mode from public.agreements a join public.accounts c on c.id = a.account_id
          where a.tenant_id = ${active.tenantId} and a.status in ('active', 'on_hold') order by a.number`
      : [],
  }));
  const { report } = data;

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/ledger" className="hover:underline">
          Ledger
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Deferred revenue roll-forward</h1>
      <p className="text-sm text-stone-600">One contract balance per agreement: billed minus recognized. Positive is deferred revenue; negative is service delivered but not yet billed, presented as a contract asset at period end.</p>
      {params.error ? <Notice kind="error">{errorMessage(params.error)}</Notice> : null}
      {params.note ? <Notice kind="success">{params.note}</Notice> : null}
      <Card title="Period">
        <form method="get" className="grid gap-3 sm:grid-cols-4">
          <Field label="From" htmlFor="from">
            <Input id="from" name="from" type="date" defaultValue={range.from} />
          </Field>
          <Field label="To" htmlFor="to">
            <Input id="to" name="to" type="date" defaultValue={range.to} />
          </Field>
          <div className="flex items-end gap-3 sm:col-span-2">
            <Button type="submit" variant="secondary">
              Show
            </Button>
            <a href={`/api/ledger/contracts.csv?from=${range.from}&to=${range.to}`} className="text-sm text-emerald-800 underline" data-testid="contracts-csv">
              Download CSV
            </a>
          </div>
        </form>
      </Card>
      <Card title={`Closing ${signed(report.closing_cents)}: deferred ${signed(report.deferred_cents)}, unbilled ${signed(report.asset_cents)}`}>
        {report.rows.length === 0 ? (
          <Empty>No agreement has a contract balance in this range.</Empty>
        ) : (
          <Table headers={["Agreement", "Customer", "Mode", "Opening", "Billed", "Recognized", "Closing", "Deferred", "Unbilled"]}>
            {report.rows.map((r) => {
              const g = report.names.get(r.agreement_id);
              return (
                <tr key={r.agreement_id} data-testid="contract-row">
                  <td className="py-2 pr-4 tabular-nums">
                    <Link href={`/agreements/${r.agreement_id}`} className="underline">
                      #{g?.number ?? "?"}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{g?.account_name ?? ""}</td>
                  <td className="py-2 pr-4">{g?.billing_mode.replace("_", " ") ?? ""}</td>
                  <td className="py-2 pr-4 tabular-nums">{signed(r.opening_cents)}</td>
                  <td className="py-2 pr-4 tabular-nums">{signed(r.billed_cents)}</td>
                  <td className="py-2 pr-4 tabular-nums">{signed(r.recognized_cents)}</td>
                  <td className="py-2 pr-4 tabular-nums">{signed(r.closing_cents)}</td>
                  <td className="py-2 pr-4 tabular-nums">{signed(r.deferred_cents)}</td>
                  <td className="py-2 pr-4 tabular-nums">{signed(r.asset_cents)}</td>
                </tr>
              );
            })}
            <tr className="font-semibold">
              <td className="py-2 pr-4" colSpan={3}>
                Total
              </td>
              <td className="py-2 pr-4 tabular-nums">{signed(report.opening_cents)}</td>
              <td className="py-2 pr-4 tabular-nums">{signed(report.billed_cents)}</td>
              <td className="py-2 pr-4 tabular-nums">{signed(report.recognized_cents)}</td>
              <td className="py-2 pr-4 tabular-nums" data-testid="contracts-closing">
                {signed(report.closing_cents)}
              </td>
              <td className="py-2 pr-4 tabular-nums">{signed(report.deferred_cents)}</td>
              <td className="py-2 pr-4 tabular-nums">{signed(report.asset_cents)}</td>
            </tr>
          </Table>
        )}
      </Card>
      {canWrite ? (
        <Card title="Opening position" description="For an agreement that was mid-term when the books started: what had been billed and what had been delivered as of that day. Posted once per agreement against opening balance equity.">
          <form action={recordOpeningPosition} className="grid gap-3 sm:grid-cols-5">
            <input type="hidden" name="tenant_id" value={active.tenantId} />
            <Field label="Agreement" htmlFor="open-agreement">
              <Select id="open-agreement" name="agreement_id" required defaultValue="">
                <option value="" disabled>
                  Pick an agreement
                </option>
                {data.agreements.map((g) => (
                  <option key={g.id} value={g.id}>
                    #{g.number} {g.account_name} ({g.billing_mode.replace("_", " ")})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Billed to date ($)" htmlFor="open-billed">
              <Input id="open-billed" name="billed" inputMode="decimal" required />
            </Field>
            <Field label="Delivered to date ($)" htmlFor="open-recognized">
              <Input id="open-recognized" name="recognized" inputMode="decimal" required />
            </Field>
            <Field label="As of" htmlFor="open-as-of">
              <Input id="open-as-of" name="as_of" type="date" defaultValue={today} required />
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="secondary">
                Post opening position
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
