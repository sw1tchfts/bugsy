import { Empty } from "@/components/ui";
import { formatCents } from "@/lib/money";
import type { Definition } from "@/lib/reports/builder";
import type { ColumnType, Dataset } from "@/lib/reports/datasets";

/** The type a result column holds: a dataset column's own, or what a total over it returns. */
function typeOf(dataset: Dataset, def: Definition, name: string): ColumnType {
  const col = dataset.columns.find((c) => c.name === name);
  if (col) return col.type;
  const agg = def.aggregates.find((a) => (a.fn === "count" && !a.column ? "count" : `${a.fn}_${a.column}`) === name);
  if (!agg || agg.fn === "count") return "number";
  return dataset.columns.find((c) => c.name === agg.column)?.type ?? "number";
}

function labelOf(dataset: Dataset, name: string): string {
  const col = dataset.columns.find((c) => c.name === name);
  if (col) return col.label;
  if (name === "count") return "Count";
  const [fn, ...rest] = name.split("_");
  const of = dataset.columns.find((c) => c.name === rest.join("_"))?.label ?? rest.join("_");
  return `${{ count: "Count", sum: "Sum", avg: "Average", min: "Smallest", max: "Largest" }[fn] ?? fn} of ${of}`;
}

function show(type: ColumnType, v: unknown): string {
  if (v === null || v === undefined) return "";
  if (type === "money") return formatCents(Math.round(Number(v)));
  if (type === "boolean") return v ? "yes" : "no";
  if (type === "number" && typeof v === "string" && v.includes(".")) return Number(v).toFixed(1);
  return String(v);
}

export function ResultsTable({ dataset, def, columns, rows, limit }: { dataset: Dataset; def: Definition; columns: string[]; rows: Record<string, unknown>[]; limit: number }) {
  if (rows.length === 0) return <Empty>No rows match.</Empty>;
  const types = columns.map((c) => typeOf(dataset, def, c));
  return (
    <div className="overflow-x-auto">
      <p className="mb-2 text-xs text-stone-500">{rows.length >= limit ? `The first ${limit.toLocaleString()} rows; the CSV has them all.` : `${rows.length} row(s).`}</p>
      <table className="w-full text-left text-sm" data-testid="report-results">
        <thead>
          <tr className="border-b border-stone-200 text-stone-500">
            {columns.map((c, i) => (
              <th key={c} className={`py-1 pr-4 font-medium ${types[i] === "money" || types[i] === "number" ? "text-right" : ""}`}>
                {labelOf(dataset, c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, n) => (
            <tr key={n} className="border-b border-stone-100" data-testid="report-row">
              {columns.map((c, i) => (
                <td key={c} className={`py-1 pr-4 ${types[i] === "money" || types[i] === "number" ? "text-right tabular-nums" : ""}`}>
                  {show(types[i], r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
