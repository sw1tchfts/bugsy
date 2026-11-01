// Notification registry import (spec 07 rule 9): a state's list of people who must get advance notice, as a CSV with
// header names mapped to the columns we keep. Addresses are normalized the same way as properties so matching is a
// string comparison in the database. A state pack may ship its own header mapping (`registry.fileFormat`).
import { createHash } from "node:crypto";
import { normalizeAddress, normalizeStateCode } from "@/lib/geo/normalize";

export type RegistryRow = {
  name: string | null;
  line1: string;
  line2: string | null;
  city: string;
  postal_code: string;
  normalized_address: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  row_hash: string;
};

export type RegistryField = "name" | "line1" | "line2" | "city" | "state" | "postal_code" | "contact_name" | "phone" | "email" | "notes";

/** Header names the importer recognises on its own; a pack's `registry.fileFormat` or a manual mapping overrides them. */
const SYNONYMS: Record<string, RegistryField> = {
  name: "name",
  registrant: "name",
  resident: "name",
  "registrant name": "name",
  address: "line1",
  address1: "line1",
  "address 1": "line1",
  street: "line1",
  "street address": "line1",
  line1: "line1",
  address2: "line2",
  "address 2": "line2",
  line2: "line2",
  apt: "line2",
  unit: "line2",
  city: "city",
  town: "city",
  state: "state",
  st: "state",
  zip: "postal_code",
  zipcode: "postal_code",
  "zip code": "postal_code",
  postal: "postal_code",
  "postal code": "postal_code",
  postal_code: "postal_code",
  contact: "contact_name",
  "contact name": "contact_name",
  contact_name: "contact_name",
  phone: "phone",
  telephone: "phone",
  "phone number": "phone",
  email: "email",
  "e-mail": "email",
  "email address": "email",
  notes: "notes",
  comments: "notes",
  comment: "notes",
};

/** Splits CSV text into rows of cells, honouring quotes, doubled quotes and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

/** Maps header cells to fields: the explicit mapping first (header name to field), then the synonyms. */
export function mapHeaders(headers: readonly string[], mapping: Readonly<Record<string, string>> = {}): (RegistryField | null)[] {
  const explicit = new Map(Object.entries(mapping).map(([header, field]) => [header.trim().toLowerCase(), field as RegistryField]));
  return headers.map((h) => {
    const key = h.trim().toLowerCase();
    return explicit.get(key) ?? SYNONYMS[key] ?? null;
  });
}

export type ParseResult = { rows: RegistryRow[]; errors: { line: number; message: string }[]; fields: (RegistryField | null)[] };

/** Parses a registry CSV for one state: rows with an address, city and postal code; everything else optional. */
export function parseRegistryCsv(text: string, stateCode: string, mapping?: Readonly<Record<string, string>>): ParseResult {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], errors: [{ line: 1, message: "the file is empty" }], fields: [] };
  const fields = mapHeaders(table[0], mapping);
  const errors: ParseResult["errors"] = [];
  for (const needed of ["line1", "city", "postal_code"] as const) {
    if (!fields.includes(needed)) errors.push({ line: 1, message: `no column for ${needed.replace("_", " ")}; map it or rename the header` });
  }
  if (errors.length) return { rows: [], errors, fields };
  const state = normalizeStateCode(stateCode) ?? stateCode.toUpperCase();
  const rows: RegistryRow[] = [];
  const seen = new Set<string>();
  table.slice(1).forEach((cells, index) => {
    const line = index + 2;
    const get = (field: RegistryField): string | null => {
      const at = fields.indexOf(field);
      const value = at >= 0 ? (cells[at] ?? "").trim() : "";
      return value.length ? value : null;
    };
    const line1 = get("line1");
    const city = get("city");
    const postal = get("postal_code");
    if (!line1 || !city || !postal) {
      errors.push({ line, message: "address, city and postal code are required" });
      return;
    }
    const rowState = get("state");
    if (rowState && (normalizeStateCode(rowState) ?? rowState.toUpperCase()) !== state) {
      errors.push({ line, message: `row is in ${rowState}, not ${state}` });
      return;
    }
    const normalized = normalizeAddress({ line1, line2: get("line2"), city, stateCode: state, postalCode: postal });
    const row: Omit<RegistryRow, "row_hash"> = {
      name: get("name"),
      line1,
      line2: get("line2"),
      city,
      postal_code: postal,
      normalized_address: normalized,
      contact_name: get("contact_name"),
      phone: get("phone"),
      email: get("email")?.toLowerCase() ?? null,
      notes: get("notes"),
    };
    const row_hash = hashRow(row);
    if (seen.has(row_hash)) return;
    seen.add(row_hash);
    rows.push({ ...row, row_hash });
  });
  return { rows, errors, fields };
}

/** A stable hash of what identifies the entry, so a re-import keeps unchanged rows and the unique key holds. */
export function hashRow(row: Omit<RegistryRow, "row_hash">): string {
  return createHash("sha256").update([row.normalized_address, row.name ?? "", row.contact_name ?? "", row.phone ?? "", row.email ?? ""].join("|")).digest("hex");
}
