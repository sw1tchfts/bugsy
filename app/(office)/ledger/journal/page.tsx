import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Table, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { formatBusinessDate, isIsoDate } from "@/lib/dates";
import { journalEntries } from "@/lib/ledger/db";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { SOURCE_LABELS } from "../helpers";

export const metadata: Metadata = { title: "General journal" };

export default async function JournalPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; source_type?: string; q?: string; error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "gl.read");
  const params = await searchParams;
  const from = params.from && isIsoDate(params.from) ? params.from : undefined;
  const to = params.to && isIsoDate(params.to) ? params.to : undefined;
  const sourceType = params.source_type && SOURCE_LABELS[params.source_type] ? params.source_type : undefined;
  const q = params.q?.trim() || undefined;
  const rows = await dbAs(session, (tx) => journalEntries(tx, active.tenantId, { from, to, source_type: sourceType, q, limit: 300 }));
  const canWrite = can(active.permissions, "gl.write");
  const csv = new URLSearchParams();
  if (from) csv.set("from", from);
  if (to) csv.set("to", to);

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/ledger" className="hover:underline">
          Ledger
        </Link>
      </p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">General journal</h1>
        {canWrite ? (
          <Link href="/ledger/journal/new" className="text-sm text-emerald-800 underline">
            New manual entry
          </Link>
        ) : null}
      </div>
      {params.error ? <Notice kind="error">{errorMessage(params.error)}</Notice> : null}
      <Card title="Find">
        <form method="get" className="grid gap-3 sm:grid-cols-5">
          <Field label="From" htmlFor="from">
            <Input id="from" name="from" type="date" defaultValue={from ?? ""} />
          </Field>
          <Field label="To" htmlFor="to">
            <Input id="to" name="to" type="date" defaultValue={to ?? ""} />
          </Field>
          <Field label="Kind" htmlFor="source_type">
            <Select id="source_type" name="source_type" defaultValue={sourceType ?? ""}>
              <option value="">Any</option>
              {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Memo or number" htmlFor="q">
            <Input id="q" name="q" defaultValue={q ?? ""} />
          </Field>
          <div className="flex items-end gap-3">
            <Button type="submit" variant="secondary">
              Show
            </Button>
            <a href={`/api/ledger/journal.csv?${csv.toString()}`} className="text-sm text-emerald-800 underline" data-testid="journal-csv">
              CSV
            </a>
          </div>
        </form>
      </Card>
      <Card title={`${rows.length} entr${rows.length === 1 ? "y" : "ies"}`} description="Newest first. An entry never changes; a reversal links both ways.">
        {rows.length === 0 ? (
          <Empty>No entries match.</Empty>
        ) : (
          <Table headers={["#", "Date", "Kind", "Memo", "Amount", ""]}>
            {rows.map((r) => (
              <tr key={r.id} data-testid="journal-row">
                <td className="py-2 pr-4 tabular-nums">
                  <Link href={`/ledger/journal/${r.id}`} className="underline">
                    #{r.number}
                  </Link>
                </td>
                <td className="py-2 pr-4">{formatBusinessDate(r.posted_on)}</td>
                <td className="py-2 pr-4">
                  <Badge tone={r.source_type === "reversal" || r.source_type === "void" ? "warn" : "neutral"}>{SOURCE_LABELS[r.source_type] ?? r.source_type}</Badge>
                </td>
                <td className="py-2 pr-4">{r.memo}</td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(r.amount_cents)}</td>
                <td className="py-2 pr-4 text-xs text-stone-500">{r.reversed_by ? "reversed" : r.reverses ? "reversal" : ""}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
