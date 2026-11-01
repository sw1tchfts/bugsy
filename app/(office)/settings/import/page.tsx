import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Empty, Field, Input, Notice, Table, errorMessage } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { formatBusinessDate, formatInstant, todayInZone } from "@/lib/dates";
import type { FileSummary } from "@/lib/import/db";
import { IMPORT_KINDS, TEMPLATES } from "@/lib/import/templates";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { runImportAction } from "./actions";

export const metadata: Metadata = { title: "Import" };

const TONE = { dry_run: "neutral", committed: "good", failed: "bad" } as const;

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "data.import");
  const { error } = await searchParams;
  const batches = await dbAs(session, (tx) =>
    tx<{ id: string; status: "dry_run" | "committed" | "failed"; cutover_on: string; summary: Record<string, FileSummary>; errors: unknown[]; created_at: Date | string }[]>`
      select id, status, cutover_on, summary, errors, created_at from public.import_batches where tenant_id = ${active.tenantId} order by created_at desc limit 50`,
  );

  return (
    <>
      <h1 className="text-2xl font-semibold">Import</h1>
      <p className="text-sm text-stone-600">
        Bring customers, service addresses, contacts, active agreements and open balances across on go-live day. A dry run shows every row problem and writes nothing; an import writes everything or, if any row has a problem, nothing. Rows already imported are skipped by their old-system id.
      </p>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      <Card title="Templates" description="Fill these from the old system's exports. Required columns are the minimum to schedule and bill; extra columns are ignored.">
        <ul className="grid gap-3 text-sm sm:grid-cols-2">
          {IMPORT_KINDS.map((k) => (
            <li key={k} data-testid="template">
              <a href={`/api/import/templates/${k}.csv`} className="font-medium text-emerald-800 underline">
                {k}.csv
              </a>{" "}
              {TEMPLATES[k].description}
              <span className="block text-xs text-stone-500">
                Required: {TEMPLATES[k].columns.filter((c) => c.required).map((c) => c.name).join(", ")}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Upload" description="Mid-term agreements start billing on the go-live date; visits on or before each one's last service date are marked done before Bugsy.">
        <form action={runImportAction} className="grid gap-4">
          <input type="hidden" name="tenant_id" value={active.tenantId} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Go-live date" htmlFor="cutover" hint="The first day Bugsy runs the company.">
              <Input id="cutover" name="cutover_on" type="date" defaultValue={todayInZone(active.tenantTimezone)} required />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {IMPORT_KINDS.map((k) => (
              <Field key={k} label={TEMPLATES[k].label} htmlFor={`file-${k}`}>
                <Input id={`file-${k}`} name={k} type="file" accept=".csv,text/csv" />
              </Field>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Records from before Bugsy" htmlFor="file-history" hint="Application records, service history, contracts: any files, up to 20 MB each. Kept for the retention period.">
              <Input id="file-history" name="history" type="file" multiple />
            </Field>
            <Field label="What they are" htmlFor="history-label">
              <Input id="history-label" name="history_label" placeholder="2024 to 2026 application records" />
            </Field>
          </div>
          <div className="flex gap-3">
            <Button type="submit" name="mode" value="dry_run" variant="secondary">
              Dry run
            </Button>
            <Button type="submit" name="mode" value="commit">
              Import
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Batches" description="Every dry run and import, with its report.">
        {batches.length === 0 ? (
          <Empty>Nothing imported yet.</Empty>
        ) : (
          <Table headers={["When", "Kind", "Go-live", "Rows", "Errors", ""]}>
            {batches.map((b) => {
              const rows = Object.values(b.summary).reduce((s, f) => s + f.rows, 0);
              return (
                <tr key={b.id} data-testid="batch-row">
                  <td className="py-2 pr-4">{formatInstant(b.created_at, active.tenantTimezone)}</td>
                  <td className="py-2 pr-4">
                    <Badge tone={TONE[b.status]}>{b.status.replace("_", " ")}</Badge>
                  </td>
                  <td className="py-2 pr-4">{formatBusinessDate(b.cutover_on)}</td>
                  <td className="py-2 pr-4 tabular-nums">{rows}</td>
                  <td className="py-2 pr-4 tabular-nums">{b.errors.length}</td>
                  <td className="py-2 pr-4">
                    <Link href={`/settings/import/${b.id}`} className="underline">
                      Report
                    </Link>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}
