// A custom report definition to and from form fields (spec 12): the builder page reads it from the query string to
// preview, the save action from the posted form. Pure, so both read the same fields the same way.
import { AGGREGATES, type Aggregate, type AggregateFn, type Definition, type Filter, OPERATORS, type Operator } from "./builder";

/** URLSearchParams and FormData both satisfy this. */
export type Fields = { get(name: string): unknown; getAll(name: string): unknown[] };

export const FILTER_ROWS = 3;
export const AGGREGATE_ROWS = 2;
export const SCREEN_ROWS = 5_000;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function definitionFromFields(f: Fields): Definition {
  const filters: Filter[] = [];
  for (let i = 0; i < FILTER_ROWS; i++) {
    const column = text(f.get(`f${i}_col`));
    const op = text(f.get(`f${i}_op`));
    if (!column || !op) continue;
    filters.push({ column, op: op as Operator, ...(["empty", "not_empty"].includes(op) ? {} : { value: text(f.get(`f${i}_val`)) }) });
  }
  const aggregates: Aggregate[] = [];
  for (let i = 0; i < AGGREGATE_ROWS; i++) {
    const fn = text(f.get(`a${i}_fn`));
    if (!fn) continue;
    const column = text(f.get(`a${i}_col`));
    aggregates.push(column ? { fn: fn as AggregateFn, column } : { fn: fn as AggregateFn });
  }
  const sortColumn = text(f.get("sort"));
  const limitText = text(f.get("limit"));
  return {
    columns: f.getAll("col").map(text).filter(Boolean),
    filters,
    group_by: f.getAll("group").map(text).filter(Boolean),
    aggregates,
    sort: sortColumn ? { column: sortColumn, dir: text(f.get("dir")) === "desc" ? "desc" : "asc" } : null,
    limit: limitText ? (/^\d+$/.test(limitText) ? Number(limitText) : Number.NaN) : null,
  };
}

/** The query string that opens the builder on a definition. */
export function fieldsFromDefinition(dataset: string, def: Definition): URLSearchParams {
  const q = new URLSearchParams({ dataset });
  for (const col of def.columns) q.append("col", col);
  def.filters.slice(0, FILTER_ROWS).forEach((x, i) => {
    q.set(`f${i}_col`, x.column);
    q.set(`f${i}_op`, x.op);
    if (x.value !== undefined) q.set(`f${i}_val`, x.value);
  });
  for (const g of def.group_by) q.append("group", g);
  def.aggregates.slice(0, AGGREGATE_ROWS).forEach((a, i) => {
    q.set(`a${i}_fn`, a.fn);
    if (a.column) q.set(`a${i}_col`, a.column);
  });
  if (def.sort) {
    q.set("sort", def.sort.column);
    q.set("dir", def.sort.dir);
  }
  if (def.limit) q.set("limit", String(def.limit));
  return q;
}

/** A stored definition back into the typed shape; anything malformed becomes something checkDefinition refuses. */
export function definitionFromJson(value: unknown): Definition {
  const o = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    columns: list(o.columns).map(String),
    filters: list(o.filters).map((x) => {
      const r = (x ?? {}) as Record<string, unknown>;
      return { column: String(r.column ?? ""), op: String(r.op ?? "") as Operator, ...(r.value === undefined ? {} : { value: String(r.value) }) };
    }),
    group_by: list(o.group_by).map(String),
    aggregates: list(o.aggregates).map((x) => {
      const r = (x ?? {}) as Record<string, unknown>;
      return { fn: String(r.fn ?? "") as AggregateFn, ...(r.column ? { column: String(r.column) } : {}) };
    }),
    sort: o.sort && typeof o.sort === "object" ? { column: String((o.sort as Record<string, unknown>).column ?? ""), dir: (o.sort as Record<string, unknown>).dir === "desc" ? "desc" : "asc" } : null,
    limit: typeof o.limit === "number" ? o.limit : null,
  };
}

export const OPERATOR_LABELS: Record<Operator, string> = { eq: "is", neq: "is not", gt: "is more than", gte: "is at least", lt: "is less than", lte: "is at most", contains: "contains", empty: "is empty", not_empty: "is not empty" };
export const AGGREGATE_LABELS: Record<AggregateFn, string> = { count: "Count", sum: "Sum", avg: "Average", min: "Smallest", max: "Largest" };
export { AGGREGATES, OPERATORS };
