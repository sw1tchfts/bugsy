// Reading the uploaded CSVs (spec 10 rules 1 and 3): header checks and value coercers. Pure.
import { isIsoDate } from "@/lib/dates";
import { parseDollarsToCents } from "@/lib/money";
import { type ImportKind, TEMPLATES } from "./templates";

export type RowError = { file: ImportKind; row: number; column: string | null; message: string };
export type Row = { row: number; values: Record<string, string> };
export type FileRead = { rows: Row[]; errors: RowError[] };

/** A column name as the template spells it: lower case, spaces and dashes as underscores. */
export function columnKey(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** CSV records with blank ones kept, so record n is the spreadsheet's row n; quotes may hold commas and newlines. */
export function csvRecords(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell);
      records.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    records.push(row);
  }
  return records;
}

/** The file's rows keyed by template column, with the spreadsheet's row numbers (the header is row 1). */
export function readFile(kind: ImportKind, text: string): FileRead {
  const template = TEMPLATES[kind];
  const grid = csvRecords(text);
  const header = (grid[0] ?? []).map(columnKey);
  const missing = template.columns.filter((c) => c.required && !header.includes(c.name)).map((c) => c.name);
  if (grid.length === 0 || header.every((h) => h === "")) return { rows: [], errors: [{ file: kind, row: 1, column: null, message: "the file is empty; it needs the template's header row" }] };
  if (missing.length) return { rows: [], errors: [{ file: kind, row: 1, column: missing[0], message: `missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}` }] };
  const rows: Row[] = [];
  for (let i = 1; i < grid.length; i += 1) {
    const cells = grid[i];
    if (cells.every((c) => c.trim() === "")) continue;
    const values: Record<string, string> = {};
    header.forEach((h, j) => {
      if (h) values[h] = (cells[j] ?? "").trim();
    });
    rows.push({ row: i + 1, values });
  }
  return { rows, errors: [] };
}

export type Coerced<T> = { ok: true; value: T } | { ok: false; message: string };

const ok = <T,>(value: T): Coerced<T> => ({ ok: true, value });
const bad = (message: string): Coerced<never> => ({ ok: false, message });

/** YYYY-MM-DD, or M/D/YYYY as US spreadsheets write it. Blank is null. */
export function date(raw: string): Coerced<string | null> {
  const v = raw.trim();
  if (!v) return ok(null);
  if (isIsoDate(v)) return ok(v);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (us) {
    const iso = `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
    if (isIsoDate(iso)) return ok(iso);
  }
  return bad(`"${v}" is not a date; use YYYY-MM-DD or M/D/YYYY`);
}

/** Dollars and cents with an optional $, thousands commas and a leading minus. Blank is null. */
export function money(raw: string): Coerced<number | null> {
  const v = raw.trim().replace(/[$,\s]/g, "");
  if (!v) return ok(null);
  const negative = v.startsWith("-") || (v.startsWith("(") && v.endsWith(")"));
  const digits = v.replace(/^[-(]|\)$/g, "");
  const cents = parseDollarsToCents(digits);
  if (cents === null || cents < 0) return bad(`"${raw.trim()}" is not an amount; use dollars and cents like 120.00`);
  return ok(negative ? -cents : cents);
}

export function bool(raw: string, fallback: boolean): Coerced<boolean> {
  const v = raw.trim().toLowerCase();
  if (!v) return ok(fallback);
  if (["yes", "y", "true", "1", "x"].includes(v)) return ok(true);
  if (["no", "n", "false", "0"].includes(v)) return ok(false);
  return bad(`"${raw.trim()}" is not yes or no`);
}

export function int(raw: string, range: { min: number; max: number }): Coerced<number | null> {
  const v = raw.trim().replace(/,/g, "");
  if (!v) return ok(null);
  if (!/^-?\d+$/.test(v)) return bad(`"${raw.trim()}" is not a whole number`);
  const n = Number(v);
  if (n < range.min || n > range.max) return bad(`${n} is outside ${range.min} to ${range.max}`);
  return ok(n);
}

export function oneOf<T extends string>(raw: string, allowed: readonly T[], fallback: T | null): Coerced<T | null> {
  const v = columnKey(raw);
  if (!v) return ok(fallback);
  const hit = allowed.find((a) => a === v);
  return hit ? ok(hit) : bad(`"${raw.trim()}" is not one of ${allowed.join(", ")}`);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Months as numbers or names, separated by semicolons, spaces or slashes. */
export function months(raw: string): Coerced<number[]> {
  const parts = raw.split(/[;\s/|]+/).map((p) => p.trim().toLowerCase()).filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    const n = /^\d{1,2}$/.test(p) ? Number(p) : MONTHS.indexOf(p.slice(0, 3)) + 1;
    if (!(n >= 1 && n <= 12)) return bad(`"${p}" is not a month`);
    if (!out.includes(n)) out.push(n);
  }
  return ok(out.sort((a, b) => a - b));
}

export function email(raw: string): Coerced<string | null> {
  const v = raw.trim().toLowerCase();
  if (!v) return ok(null);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? ok(v) : bad(`"${raw.trim()}" is not an email address`);
}

export function state(raw: string): Coerced<string | null> {
  const v = raw.trim().toUpperCase();
  if (!v) return ok(null);
  return /^[A-Z]{2}$/.test(v) ? ok(v) : bad(`"${raw.trim()}" is not a two-letter state`);
}
