import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, Field, Input, Notice, Table, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { formatBusinessDate, formatInstant, todayInZone } from "@/lib/dates";
import { journalEntry } from "@/lib/ledger/db";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { reverseEntryAction } from "../../actions";
import { SOURCE_LABELS } from "../../helpers";

export const metadata: Metadata = { title: "Journal entry" };

export default async function EntryPage({ params, searchParams }: { params: Promise<{ entryId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "gl.read");
  const { entryId } = await params;
  const { error } = await searchParams;
  const data = await dbAs(session, (tx) => journalEntry(tx, active.tenantId, entryId));
  if (!data) notFound();
  const { entry, lines } = data;
  const canWrite = can(active.permissions, "gl.write");
  const debits = lines.reduce((s, l) => s + l.debit_cents, 0);
  const credits = lines.reduce((s, l) => s + l.credit_cents, 0);

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/ledger" className="hover:underline">
          Ledger
        </Link>{" "}
        /{" "}
        <Link href="/ledger/journal" className="hover:underline">
          Journal
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Entry #{entry.number}</h1>
        <Badge tone={entry.source_type === "reversal" || entry.source_type === "void" ? "warn" : "neutral"}>{SOURCE_LABELS[entry.source_type] ?? entry.source_type}</Badge>
        {entry.reversed_by ? <Badge tone="bad">reversed</Badge> : null}
      </div>
      <p className="text-sm text-stone-600" data-testid="entry-summary">
        {formatBusinessDate(entry.posted_on)} (period {entry.period}). {entry.memo}
        {entry.reverses ? (
          <>
            {" "}
            Reverses{" "}
            <Link href={`/ledger/journal/${entry.reverses}`} className="underline">
              #{entry.reverses_number}
            </Link>
            .
          </>
        ) : null}
        {entry.reversed_by ? (
          <>
            {" "}
            Reversed by{" "}
            <Link href={`/ledger/journal/${entry.reversed_by}`} className="underline">
              #{entry.reversed_by_number}
            </Link>
            .
          </>
        ) : null}{" "}
        Posted {formatInstant(entry.created_at, active.tenantTimezone)}
        {entry.posted_by_email ? ` by ${entry.posted_by_email}` : " by the job"}. Source key {entry.source_key}.
      </p>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      <Card title="Lines">
        <Table headers={["Account", "Debit", "Credit", "Agreement", "Jurisdiction", "Memo"]}>
          {lines.map((l) => (
            <tr key={l.id} data-testid="journal-line">
              <td className="py-2 pr-4">
                <Link href={`/ledger/accounts/${l.account_id}`} className="underline">
                  {l.account_number} {l.account_name}
                </Link>
              </td>
              <td className="py-2 pr-4 tabular-nums">{l.debit_cents ? formatCents(l.debit_cents) : ""}</td>
              <td className="py-2 pr-4 tabular-nums">{l.credit_cents ? formatCents(l.credit_cents) : ""}</td>
              <td className="py-2 pr-4">
                {l.agreement_id ? (
                  <Link href={`/agreements/${l.agreement_id}`} className="underline">
                    #{l.agreement_number}
                  </Link>
                ) : (
                  ""
                )}
              </td>
              <td className="py-2 pr-4">{l.jurisdiction ?? ""}</td>
              <td className="py-2 pr-4">{l.memo ?? ""}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-2 pr-4">Total</td>
            <td className="py-2 pr-4 tabular-nums" data-testid="entry-debits">
              {formatCents(debits)}
            </td>
            <td className="py-2 pr-4 tabular-nums" data-testid="entry-credits">
              {formatCents(credits)}
            </td>
            <td colSpan={3} />
          </tr>
        </Table>
      </Card>

      {canWrite && !entry.reversed_by ? (
        <Card title="Reverse" description="Posts the mirror image, dated today or a later open day, and links the two. The original never changes.">
          <form action={reverseEntryAction} className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="tenant_id" value={active.tenantId} />
            <input type="hidden" name="entry_id" value={entry.id} />
            <Field label="Date" htmlFor="rev-date">
              <Input id="rev-date" name="posted_on" type="date" defaultValue={todayInZone(active.tenantTimezone)} />
            </Field>
            <Field label="Memo" htmlFor="rev-memo">
              <Input id="rev-memo" name="memo" defaultValue={`Reversal of #${entry.number}`} />
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="danger">
                Reverse entry
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
