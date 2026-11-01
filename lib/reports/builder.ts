// The custom report grammar (spec 12 rule 9): a dataset, its declared columns and fixed operators, compiled to SQL
// whose identifiers all come from the dataset and whose values are all parameters. Pure and tested.
import { parseDollarsToCents } from "@/lib/money";
import type { ColumnType, Dataset } from "./datasets";

export const OPERATORS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "empty", "not_empty"] as const;
export const AGGREGATES = ["count", "sum", "avg", "min", "max"] as const;
export type Operator = (typeof OPERATORS)[number];
export type AggregateFn = (typeof AGGREGATES)[number];

export type Filter = { column: string; op: Operator; value?: string };
export type Aggregate = { fn: AggregateFn; column?: string };
export type Definition = { columns: string[]; filters: Filter[]; group_by: string[]; aggregates: Aggregate[]; sort?: { column: string; dir: "asc" | "desc" } | null; limit?: number | null };

export const MAX_ROWS = 100_000;

/** Problems with a definition against its dataset; empty when it can run. */
export function checkDefinition(def: Definition, dataset: Dataset): string[] {
  const names = new Map(dataset.columns.map((c) => [c.name, c.type]));
  const problems: string[] = [];
  const known = (col: string, where: string) => {
    if (!names.has(col)) problems.push(`${where}: ${dataset.label} has no column "${col}"`);
  };
  const grouped = def.aggregates.length > 0 || def.group_by.length > 0;
  if (!grouped && def.columns.length === 0) problems.push("pick at least one column");
  for (const col of def.columns) known(col, "column");
  for (const col of def.group_by) known(col, "group by");
  for (const f of def.filters) {
    known(f.column, "filter");
    if (!OPERATORS.includes(f.op)) problems.push(`filter: unknown operator "${f.op}"`);
    else if (!["empty", "not_empty"].includes(f.op) && (f.value === undefined || f.value === "")) problems.push(`filter on ${f.column}: needs a value`);
    else if (names.has(f.column) && f.value !== undefined && !["empty", "not_empty"].includes(f.op) && coerce(names.get(f.column) as ColumnType, f.value) === undefined) problems.push(`filter on ${f.column}: "${f.value}" is not a ${names.get(f.column)}`);
    if (f.op === "contains" && names.get(f.column) !== "text") problems.push(`filter on ${f.column}: contains works on text`);
  }
  for (const a of def.aggregates) {
    if (!AGGREGATES.includes(a.fn)) problems.push(`total: unknown function "${a.fn}"`);
    if (a.fn !== "count" && !a.column) problems.push(`total: ${a.fn} needs a column`);
    if (a.column) {
      known(a.column, "total");
      const t = names.get(a.column);
      if ((a.fn === "sum" || a.fn === "avg") && t && t !== "number" && t !== "money") problems.push(`total: ${a.fn} needs a number or money column`);
      if ((a.fn === "min" || a.fn === "max") && t === "boolean") problems.push(`total: ${a.fn} does not work on a yes or no column`);
    }
  }
  if (def.sort) {
    const sortable = grouped ? [...def.group_by, ...def.aggregates.map(aggregateName)] : def.columns;
    if (!sortable.includes(def.sort.column)) problems.push(`sort: "${def.sort.column}" is not in the report`);
    if (def.sort.dir !== "asc" && def.sort.dir !== "desc") problems.push("sort: asc or desc");
  }
  if (def.limit !== undefined && def.limit !== null && !(Number.isInteger(def.limit) && def.limit > 0 && def.limit <= MAX_ROWS)) problems.push(`limit: 1 to ${MAX_ROWS}`);
  return problems;
}

/** A filter value as the column's type: money in dollars becomes cents; undefined when it does not parse. */
export function coerce(type: ColumnType, value: string): string | number | boolean | undefined {
  const v = value.trim();
  switch (type) {
    case "number":
      return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : undefined;
    case "money": {
      const negative = v.startsWith("-");
      const cents = parseDollarsToCents(negative ? v.slice(1) : v);
      return cents === null ? undefined : negative ? -cents : cents;
    }
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
    case "boolean":
      return ["yes", "true", "1"].includes(v.toLowerCase()) ? true : ["no", "false", "0"].includes(v.toLowerCase()) ? false : undefined;
    default:
      return v;
  }
}

export function aggregateName(a: Aggregate): string {
  return a.fn === "count" && !a.column ? "count" : `${a.fn}_${a.column}`;
}

const ident = (name: string) => `"${name.replace(/"/g, "")}"`;
const SQL_OP: Record<Exclude<Operator, "contains" | "empty" | "not_empty">, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };

/** SQL text and parameters for a checked definition; $1 is the company. Throws on an unchecked one. */
export function buildQuery(def: Definition, dataset: Dataset, tenantId: string, rowLimit: number | null): { text: string; params: (string | number | boolean)[]; columns: string[] } {
  const problems = checkDefinition(def, dataset);
  if (problems.length) throw Object.assign(new Error(problems.join("; ")), { code: "23514" });
  const types = new Map(dataset.columns.map((c) => [c.name, c.type]));
  const params: (string | number | boolean)[] = [tenantId];
  const p = (v: string | number | boolean) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where = def.filters.map((f) => {
    const col = `d.${ident(f.column)}`;
    if (f.op === "empty") return `${col} is null`;
    if (f.op === "not_empty") return `${col} is not null`;
    const value = coerce(types.get(f.column) as ColumnType, f.value as string) as string | number | boolean;
    if (f.op === "contains") return `${col}::text ilike ${p(`%${String(value).replace(/[%_\\]/g, (m) => `\\${m}`)}%`)}`;
    return `${col} ${SQL_OP[f.op]} ${p(value)}`;
  });
  const grouped = def.aggregates.length > 0 || def.group_by.length > 0;
  const selectCols = grouped
    ? [...def.group_by.map((g) => `d.${ident(g)}`), ...def.aggregates.map((a) => `${a.fn}(${a.column ? `d.${ident(a.column)}` : "*"}) as ${ident(aggregateName(a))}`)]
    : def.columns.map((col) => `d.${ident(col)}`);
  const columns = grouped ? [...def.group_by, ...def.aggregates.map(aggregateName)] : def.columns;
  const order = def.sort ? `order by ${ident(def.sort.column)} ${def.sort.dir}` : grouped && def.group_by.length ? `order by ${def.group_by.map((g) => ident(g)).join(", ")}` : "";
  // A screen or a CSV caps the rows; the full export (rowLimit null) takes every row.
  const limit = rowLimit === null ? (def.limit ?? null) : Math.min(def.limit ?? rowLimit, rowLimit);
  const text = `select ${selectCols.join(", ")} from (${dataset.sql}) d${where.length ? ` where ${where.join(" and ")}` : ""}${grouped && def.group_by.length ? ` group by ${def.group_by.map((g) => `d.${ident(g)}`).join(", ")}` : ""} ${order}${limit === null ? "" : ` limit ${limit}`}`;
  return { text, params, columns };
}
