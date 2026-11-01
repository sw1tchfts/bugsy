import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Input, Notice, Table, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { formatInstant, todayInZone } from "@/lib/dates";
import { periodsOverview } from "@/lib/ledger/db";
import { formatPeriod, periodOf } from "@/lib/ledger/periods";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { closePeriodAction, reopenPeriodAction } from "../actions";

export const metadata: Metadata = { title: "Periods" };

const TONE = { open: "neutral", closed: "good", reopened: "warn" } as const;

export default async function PeriodsPage({ searchParams }: { searchParams: Promise<{ error?: string; note?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "gl.read");
  const { error, note } = await searchParams;
  const today = todayInZone(active.tenantTimezone);
  const rows = await dbAs(session, (tx) => periodsOverview(tx, active.tenantId, today));
  const canWrite = can(active.permissions, "gl.write");
  const current = periodOf(today);

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/ledger" className="hover:underline">
          Ledger
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Periods</h1>
      <p className="text-sm text-stone-600">Months close in order once they have ended; closing posts the period-end reclass first. Only an owner reopens a month, with a reason the audit log keeps.</p>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}
      {note ? <Notice kind="success">{note}</Notice> : null}
      <Card title="Months">
        <Table headers={["Period", "Status", "Entries", "Closed", "Reopened", ""]}>
          {rows.map((p) => (
            <tr key={p.period} data-testid="period-row">
              <td className="py-2 pr-4">{formatPeriod(p.period)}</td>
              <td className="py-2 pr-4">
                <Badge tone={TONE[p.status]}>{p.status}</Badge>
              </td>
              <td className="py-2 pr-4 tabular-nums">{p.entries}</td>
              <td className="py-2 pr-4 text-xs text-stone-500">{p.closed_at && p.status === "closed" ? formatInstant(p.closed_at, active.tenantTimezone) : ""}</td>
              <td className="py-2 pr-4 text-xs text-stone-500">{p.reopened_at && p.status === "reopened" ? `${formatInstant(p.reopened_at, active.tenantTimezone)}: ${p.reopen_reason ?? ""}` : ""}</td>
              <td className="py-2 pr-4">
                {canWrite && p.status !== "closed" && p.period < current ? (
                  <form action={closePeriodAction} className="inline">
                    <input type="hidden" name="tenant_id" value={active.tenantId} />
                    <input type="hidden" name="period" value={p.period} />
                    <Button type="submit" variant="secondary">
                      Close {p.period}
                    </Button>
                  </form>
                ) : null}
                {canWrite && p.status === "closed" ? (
                  <form action={reopenPeriodAction} className="flex items-center gap-2">
                    <input type="hidden" name="tenant_id" value={active.tenantId} />
                    <input type="hidden" name="period" value={p.period} />
                    <Input name="reason" placeholder="Reason to reopen" aria-label={`Reason to reopen ${p.period}`} className="w-56" required />
                    <Button type="submit" variant="danger">
                      Reopen {p.period}
                    </Button>
                  </form>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
