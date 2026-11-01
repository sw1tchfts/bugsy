import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Table, errorMessage } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { checkDefinition } from "@/lib/reports/builder";
import { datasetsFor, listSaved, runDefinition } from "@/lib/reports/db";
import { AGGREGATES, AGGREGATE_LABELS, AGGREGATE_ROWS, FILTER_ROWS, OPERATORS, OPERATOR_LABELS, SCREEN_ROWS, definitionFromFields } from "@/lib/reports/form";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { Back } from "../helpers";
import { saveReport } from "../actions";
import { ResultsTable } from "./results";

export const metadata: Metadata = { title: "Custom reports" };

type Params = Record<string, string | string[] | undefined>;

function toSearch(params: Params): URLSearchParams {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, x);
  return q;
}

/** The builder (spec 12 rule 9): a dataset, its columns, filters, grouping and totals, previewed here and saved. */
export default async function CustomReportsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "reports.read");
  const q = toSearch(await searchParams);
  const offered = datasetsFor(active.permissions);
  const dataset = offered.find((d) => d.key === q.get("dataset")) ?? null;
  const def = definitionFromFields(q);
  const quiet = new Set(["dataset", "note", "error", "name", "report", "report_id", "tenant_id", "shared"]);
  const touched = [...q.keys()].some((k) => !quiet.has(k));
  const problems = dataset && touched ? checkDefinition(def, dataset) : [];
  const saved = await dbAs(session, (tx) => listSaved(tx, active.tenantId));
  let result: Awaited<ReturnType<typeof runDefinition>> | null = null;
  if (dataset && touched && problems.length === 0) {
    try {
      result = await dbAs(session, (tx) => runDefinition(tx, active.tenantId, dataset, def, SCREEN_ROWS));
    } catch (err) {
      console.error("custom report failed", err);
      problems.push("That report could not run. Try fewer filters or a different total.");
    }
  }
  const note = q.get("note");
  const error = errorMessage(q.get("error") ?? undefined);
  const columnOptions = dataset?.columns ?? [];

  return (
    <>
      <Back />
      <h1 className="text-2xl font-semibold">Custom reports</h1>
      <p className="text-sm text-stone-600">Pick a dataset, then the columns for a list, or a grouping and totals. Only datasets your role can read are offered, and you only ever see rows your role can see.</p>
      {note ? <Notice kind="success">{note}</Notice> : null}
      {error ? <Notice kind="error">{error}</Notice> : null}

      <Card title="Saved reports">
        {saved.length === 0 ? (
          <Empty>No saved reports yet.</Empty>
        ) : (
          <Table headers={["Report", "Dataset", "Author", ""]}>
            {saved.map((r) => (
              <tr key={r.id} data-testid="saved-report">
                <td className="py-1 pr-4">
                  <Link href={`/reports/custom/${r.id}`} className="underline">
                    {r.name}
                  </Link>
                </td>
                <td className="py-1 pr-4">{offered.find((d) => d.key === r.dataset)?.label ?? r.dataset}</td>
                <td className="py-1 pr-4">{r.author}</td>
                <td className="py-1 pr-4">{r.shared ? <Badge tone="good">Shared</Badge> : <Badge>Private</Badge>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Build a report">
        <form method="get" className="space-y-4" data-testid="report-builder">
          {q.get("report") ? <input type="hidden" name="report" value={q.get("report") ?? ""} /> : null}
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Dataset" htmlFor="dataset">
              <Select id="dataset" name="dataset" defaultValue={dataset?.key ?? ""}>
                <option value="">Choose a dataset</option>
                {offered.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </Field>
            {dataset ? null : (
              <Button type="submit" variant="secondary">
                Choose
              </Button>
            )}
          </div>
          {dataset ? (
            <>
              <fieldset>
                <legend className="text-sm font-medium">Columns, for a list of rows</legend>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {columnOptions.map((c) => (
                    <label key={c.name} className="flex items-center gap-1">
                      <input type="checkbox" name="col" value={c.name} defaultChecked={def.columns.includes(c.name)} data-testid={`col-${c.name}`} />
                      {c.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="text-sm font-medium">Filters</legend>
                <div className="mt-1 space-y-2">
                  {Array.from({ length: FILTER_ROWS }, (_, i) => {
                    const f = def.filters[i];
                    return (
                      <div key={i} className="flex flex-wrap gap-2">
                        <Select name={`f${i}_col`} defaultValue={f?.column ?? ""} aria-label={`Filter ${i + 1} column`} data-testid={`f${i}-col`}>
                          <option value="">No filter</option>
                          {columnOptions.map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.label}
                            </option>
                          ))}
                        </Select>
                        <Select name={`f${i}_op`} defaultValue={f?.op ?? "eq"} aria-label={`Filter ${i + 1} test`} data-testid={`f${i}-op`}>
                          {OPERATORS.map((o) => (
                            <option key={o} value={o}>
                              {OPERATOR_LABELS[o]}
                            </option>
                          ))}
                        </Select>
                        <Input name={`f${i}_val`} defaultValue={f?.value ?? ""} aria-label={`Filter ${i + 1} value`} placeholder="value; dates as YYYY-MM-DD, money in dollars" className="min-w-64" data-testid={`f${i}-val`} />
                      </div>
                    );
                  })}
                </div>
              </fieldset>
              <fieldset>
                <legend className="text-sm font-medium">Group by, for totals</legend>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {columnOptions.map((c) => (
                    <label key={c.name} className="flex items-center gap-1">
                      <input type="checkbox" name="group" value={c.name} defaultChecked={def.group_by.includes(c.name)} data-testid={`group-${c.name}`} />
                      {c.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="text-sm font-medium">Totals</legend>
                <div className="mt-1 space-y-2">
                  {Array.from({ length: AGGREGATE_ROWS }, (_, i) => {
                    const a = def.aggregates[i];
                    return (
                      <div key={i} className="flex flex-wrap gap-2">
                        <Select name={`a${i}_fn`} defaultValue={a?.fn ?? ""} aria-label={`Total ${i + 1}`} data-testid={`a${i}-fn`}>
                          <option value="">No total</option>
                          {AGGREGATES.map((fn) => (
                            <option key={fn} value={fn}>
                              {AGGREGATE_LABELS[fn]}
                            </option>
                          ))}
                        </Select>
                        <Select name={`a${i}_col`} defaultValue={a?.column ?? ""} aria-label={`Total ${i + 1} column`} data-testid={`a${i}-col`}>
                          <option value="">rows (for a count)</option>
                          {columnOptions.map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.label}
                            </option>
                          ))}
                        </Select>
                      </div>
                    );
                  })}
                </div>
              </fieldset>
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Sort by" htmlFor="sort" hint="a column in the report, or count, or sum_price and the like">
                  <Input id="sort" name="sort" defaultValue={def.sort?.column ?? ""} />
                </Field>
                <Field label="Order" htmlFor="dir">
                  <Select id="dir" name="dir" defaultValue={def.sort?.dir ?? "asc"}>
                    <option value="asc">Ascending</option>
                    <option value="desc">Descending</option>
                  </Select>
                </Field>
                <Field label="Row limit" htmlFor="limit">
                  <Input id="limit" name="limit" inputMode="numeric" defaultValue={def.limit ? String(def.limit) : ""} />
                </Field>
                <Button type="submit" variant="secondary" data-testid="report-preview">
                  Preview
                </Button>
              </div>
              <div className="flex flex-wrap items-end gap-3 border-t border-stone-200 pt-4">
                <input type="hidden" name="tenant_id" value={active.tenantId} />
                <input type="hidden" name="report_id" value={q.get("report") ?? ""} />
                <Field label="Report name" htmlFor="name">
                  <Input id="name" name="name" defaultValue={q.get("name") ?? ""} />
                </Field>
                <label className="flex items-center gap-1 pb-2 text-sm">
                  <input type="checkbox" name="shared" defaultChecked={q.get("shared") === "on"} data-testid="report-shared" /> Share with the company
                </label>
                <Button type="submit" formAction={saveReport} data-testid="report-save">
                  Save report
                </Button>
              </div>
            </>
          ) : null}
        </form>
      </Card>

      {problems.length ? (
        <Notice kind="error">
          <ul className="list-disc pl-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {dataset && result ? (
        <Card title="Preview">
          <ResultsTable dataset={dataset} def={def} columns={result.columns} rows={result.rows} limit={SCREEN_ROWS} />
        </Card>
      ) : null}
      {dataset && !touched ? <p className="text-sm text-stone-500">Choose columns or totals, then Preview.</p> : null}
    </>
  );
}
