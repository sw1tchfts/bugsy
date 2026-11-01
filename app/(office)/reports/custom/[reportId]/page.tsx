import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, Notice, errorMessage } from "@/components/ui";
import { isOwnerRole } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { aggregateName } from "@/lib/reports/builder";
import { datasetFor } from "@/lib/reports/datasets";
import { loadSaved, runSaved } from "@/lib/reports/db";
import { AGGREGATE_LABELS, OPERATOR_LABELS, SCREEN_ROWS, fieldsFromDefinition } from "@/lib/reports/form";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { deleteReport, setReportShared } from "../../actions";
import { ResultsTable } from "../results";

export const metadata: Metadata = { title: "Saved report" };

/** A saved report, run now under the member's session (spec 12 rules 10 and 11). */
export default async function SavedReportPage({ params, searchParams }: { params: Promise<{ reportId: string }>; searchParams: Promise<{ note?: string; error?: string }> }) {
  const { reportId } = await params;
  const { note, error } = await searchParams;
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "reports.read");
  const data = await dbAs(session, async (tx) => {
    const report = await loadSaved(tx, active.tenantId, reportId);
    return report ? { report, result: await runSaved(tx, active.tenantId, report, active.permissions, SCREEN_ROWS).catch(() => undefined) } : null;
  });
  if (!data) notFound();
  const { report, result } = data;
  const dataset = datasetFor(report.dataset);
  const mine = report.created_by === session.userId;
  const owner = isOwnerRole(active.permissions);
  const label = (name: string) => dataset?.columns.find((c) => c.name === name)?.label ?? name;
  const open = fieldsFromDefinition(report.dataset, report.definition);
  open.set("name", report.name);
  if (mine) open.set("report", report.id);
  if (report.shared && mine) open.set("shared", "on");
  const def = report.definition;

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/reports/custom" className="hover:underline">
          Custom reports
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">{report.name}</h1>
      <p className="text-sm text-stone-600">
        {dataset?.label ?? report.dataset} by {report.author} {report.shared ? <Badge tone="good">Shared</Badge> : <Badge>Private</Badge>}
      </p>
      {note ? <Notice kind="success">{note}</Notice> : null}
      {errorMessage(error) ? <Notice kind="error">{errorMessage(error)}</Notice> : null}
      <Card title="What it shows">
        <ul className="list-disc pl-5 text-sm">
          {def.group_by.length || def.aggregates.length ? (
            <li>
              {def.aggregates.map((a) => (a.column ? `${AGGREGATE_LABELS[a.fn]} of ${label(a.column)}` : "Count of rows")).join(", ") || "Rows"}
              {def.group_by.length ? ` by ${def.group_by.map(label).join(", ")}` : ""}
            </li>
          ) : (
            <li>Columns: {def.columns.map(label).join(", ")}</li>
          )}
          {def.filters.map((f, i) => (
            <li key={i}>
              Where {label(f.column)} {OPERATOR_LABELS[f.op] ?? f.op} {f.value ?? ""}
            </li>
          ))}
          {def.sort ? (
            <li>
              Sorted by {def.aggregates.some((a) => aggregateName(a) === def.sort?.column) ? def.sort.column : label(def.sort.column)}, {def.sort.dir === "desc" ? "descending" : "ascending"}
            </li>
          ) : null}
          {def.limit ? <li>At most {def.limit} rows</li> : null}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a href={`/api/reports/custom/${report.id}`} className="text-sm text-emerald-800 underline" data-testid="report-csv">
            Download CSV
          </a>
          <Link href={`/reports/custom?${open.toString()}`} className="text-sm underline" data-testid="report-open-builder">
            {mine ? "Edit in the builder" : "Copy into the builder"}
          </Link>
          {mine ? (
            <form action={setReportShared}>
              <input type="hidden" name="tenant_id" value={active.tenantId} />
              <input type="hidden" name="report_id" value={report.id} />
              <input type="hidden" name="shared" value={report.shared ? "false" : "true"} />
              <Button type="submit" variant="secondary" data-testid="report-share-toggle">
                {report.shared ? "Make private" : "Share with the company"}
              </Button>
            </form>
          ) : null}
          {mine || owner ? (
            <form action={deleteReport}>
              <input type="hidden" name="tenant_id" value={active.tenantId} />
              <input type="hidden" name="report_id" value={report.id} />
              <Button type="submit" variant="secondary" data-testid="report-delete">
                Delete
              </Button>
            </form>
          ) : null}
        </div>
      </Card>
      <Card title="Results">
        {result === null || !dataset ? (
          <Notice kind="error">This report reads {dataset?.label ?? report.dataset}, which your role cannot read.</Notice>
        ) : result === undefined ? (
          <Notice kind="error">This report could not run; open it in the builder to fix it.</Notice>
        ) : (
          <ResultsTable dataset={dataset} def={def} columns={result.columns} rows={result.rows} limit={SCREEN_ROWS} />
        )}
      </Card>
    </>
  );
}
