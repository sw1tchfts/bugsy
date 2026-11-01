import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Empty, Table } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { getStatePack } from "@/lib/compliance/rules";
import { formatBusinessDate, formatInstant } from "@/lib/dates";
import { fileUrl } from "@/lib/files";
import type { FileSummary } from "@/lib/import/db";
import type { RowError } from "@/lib/import/parse";
import { IMPORT_KINDS, TEMPLATES } from "@/lib/import/templates";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

export const metadata: Metadata = { title: "Import report" };

const TONE = { dry_run: "neutral", committed: "good", failed: "bad" } as const;
const TITLE = { dry_run: "Dry run: nothing was written", committed: "Imported", failed: "Not imported: fix the rows below and run it again" } as const;

export default async function BatchPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "data.import");
  const { batchId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) notFound();
  const data = await dbAs(session, async (tx) => {
    const [batch] = await tx<{ id: string; status: "dry_run" | "committed" | "failed"; cutover_on: string; summary: Partial<Record<string, FileSummary>>; errors: RowError[]; warnings: RowError[]; created_at: Date | string }[]>`
      select id, status, cutover_on, summary, errors, warnings, created_at from public.import_batches where id = ${batchId} and tenant_id = ${active.tenantId}`;
    if (!batch) return null;
    const files = await tx<{ id: string; file_id: string; kind: "template" | "history"; file_name: string; label: string | null; byte_size: number }[]>`
      select f.id, f.file_id, f.kind, f.file_name, f.label, x.byte_size from public.import_files f join public.files x on x.id = f.file_id where f.batch_id = ${batchId} order by f.kind desc, f.created_at`;
    const states = await tx<{ state_code: string }[]>`
      select distinct p.state_code from public.properties p where p.tenant_id = ${active.tenantId} and p.archived_at is null order by 1`;
    return { batch, files, states: states.map((s) => s.state_code) };
  });
  if (!data) notFound();
  const { batch, files } = data;

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/settings/import" className="hover:underline">
          Import
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold" data-testid="batch-title">
          {TITLE[batch.status]}
        </h1>
        <Badge tone={TONE[batch.status]}>{batch.status.replace("_", " ")}</Badge>
      </div>
      <p className="text-sm text-stone-600">
        Go-live {formatBusinessDate(batch.cutover_on)}; run {formatInstant(batch.created_at, active.tenantTimezone)}.
      </p>

      <Card title="Files">
        <Table headers={["File", "Rows", batch.status === "dry_run" ? "Would create" : batch.status === "committed" ? "Created" : "Would have created", "Skipped (already imported)", "Errors"]}>
          {IMPORT_KINDS.filter((k) => batch.summary[k]).map((k) => {
            const f = batch.summary[k] as FileSummary;
            return (
              <tr key={k} data-testid={`summary-${k}`}>
                <td className="py-2 pr-4">{TEMPLATES[k].label}</td>
                <td className="py-2 pr-4 tabular-nums">{f.rows}</td>
                <td className="py-2 pr-4 tabular-nums" data-testid={`created-${k}`}>
                  {f.created}
                </td>
                <td className="py-2 pr-4 tabular-nums" data-testid={`skipped-${k}`}>
                  {f.skipped}
                </td>
                <td className="py-2 pr-4 tabular-nums">{f.errors}</td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Card title={`${batch.errors.length} row error${batch.errors.length === 1 ? "" : "s"}`} description="The spreadsheet's row numbers; the header is row 1.">
        {batch.errors.length === 0 ? (
          <Empty>No row errors.</Empty>
        ) : (
          <Table headers={["File", "Row", "Column", "Problem"]}>
            {batch.errors.map((e, i) => (
              <tr key={i} data-testid="row-error">
                <td className="py-2 pr-4">{e.file}.csv</td>
                <td className="py-2 pr-4 tabular-nums">{e.row}</td>
                <td className="py-2 pr-4">{e.column ?? ""}</td>
                <td className="py-2 pr-4">{e.message}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {batch.warnings.length ? (
        <Card title={`${batch.warnings.length} warning${batch.warnings.length === 1 ? "" : "s"}`} description="Imported as the file says; worth a look.">
          <Table headers={["File", "Row", "Column", "Note"]}>
            {batch.warnings.map((e, i) => (
              <tr key={i} data-testid="row-warning">
                <td className="py-2 pr-4">{e.file}.csv</td>
                <td className="py-2 pr-4 tabular-nums">{e.row}</td>
                <td className="py-2 pr-4">{e.column ?? ""}</td>
                <td className="py-2 pr-4">{e.message}</td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}

      {batch.status === "committed" ? (
        <Card title="Kept files" description="Never deleted by Bugsy. Keep records from before Bugsy for each state's retention period.">
          {files.length === 0 ? (
            <Empty>No files.</Empty>
          ) : (
            <Table headers={["File", "Kind", "What", "Size"]}>
              {files.map((f) => (
                <tr key={f.id} data-testid={`kept-${f.kind}`}>
                  <td className="py-2 pr-4">
                    <a href={fileUrl(f.file_id)} className="underline">
                      {f.file_name}
                    </a>
                  </td>
                  <td className="py-2 pr-4">{f.kind === "history" ? "record from before Bugsy" : "import file"}</td>
                  <td className="py-2 pr-4">{f.label ?? ""}</td>
                  <td className="py-2 pr-4 tabular-nums">{Math.max(1, Math.round(f.byte_size / 1024))} KB</td>
                </tr>
              ))}
            </Table>
          )}
          <ul className="mt-3 grid gap-1 text-xs text-stone-600" data-testid="retention">
            {data.states.map((code) => {
              const years = getStatePack(code)?.rules["records.retentionYears"];
              return (
                <li key={code}>
                  {code}: {years ? `keep application records ${years.value} years (${years.source})` : "no rule pack for this state yet; keep the records until one says how long"}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
