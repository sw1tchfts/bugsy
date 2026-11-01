import { describe, expect, it } from "vitest";
import { bool, columnKey, date, email, int, money, months, oneOf, readFile, state } from "@/lib/import/parse";
import { IMPORT_KINDS, TEMPLATES, templateCsv } from "@/lib/import/templates";

describe("reading an uploaded file (spec 10 rule 1)", () => {
  it("matches headers by name, whatever the case, spacing or column order, and keeps the spreadsheet's row numbers", () => {
    const text = "﻿Name,External ID,Type\r\n\"Green, June\",A-1,residential\r\n\r\n,A-2,\n";
    const read = readFile("accounts", text);
    expect(read.errors).toEqual([]);
    expect(read.rows).toEqual([
      { row: 2, values: { name: "Green, June", external_id: "A-1", type: "residential" } },
      { row: 4, values: { name: "", external_id: "A-2", type: "" } },
    ]);
    expect(columnKey(" Account External-ID ")).toBe("account_external_id");
  });

  it("fails a file whole when a required column is missing, naming it, and an empty file", () => {
    expect(readFile("properties", "external_id,line1\nP-1,1 Main\n").errors[0]).toMatchObject({ file: "properties", row: 1, message: expect.stringContaining("account_external_id") });
    expect(readFile("balances", "").errors[0].message).toMatch(/empty/);
  });

  it("publishes every template with its required columns first in the example", () => {
    for (const kind of IMPORT_KINDS) {
      const [header, example] = templateCsv(kind).trim().split("\n");
      expect(header.split(",")).toEqual(TEMPLATES[kind].columns.map((c) => c.name));
      expect(readFile(kind, `${header}\n${example}\n`).errors).toEqual([]);
    }
  });
});

describe("coercing values (spec 10 rule 3)", () => {
  it("reads dates as ISO or US, and refuses the rest", () => {
    expect(date("2026-03-01")).toEqual({ ok: true, value: "2026-03-01" });
    expect(date("3/1/2026")).toEqual({ ok: true, value: "2026-03-01" });
    expect(date("")).toEqual({ ok: true, value: null });
    expect(date("2026-02-30").ok).toBe(false);
    expect(date("March 1").ok).toBe(false);
  });

  it("reads money in dollars with symbols, commas and signs as integer cents", () => {
    expect(money("$1,234.56")).toEqual({ ok: true, value: 123456 });
    expect(money("99")).toEqual({ ok: true, value: 9900 });
    expect(money("-25.00")).toEqual({ ok: true, value: -2500 });
    expect(money("(41.66)")).toEqual({ ok: true, value: -4166 });
    expect(money("12.345").ok).toBe(false);
    expect(money("ten").ok).toBe(false);
  });

  it("reads yes and no, whole numbers, choices, months, emails and states", () => {
    expect(bool("Y", false)).toEqual({ ok: true, value: true });
    expect(bool("", true)).toEqual({ ok: true, value: true });
    expect(bool("maybe", false).ok).toBe(false);
    expect(int("1,200", { min: 0, max: 5000 })).toEqual({ ok: true, value: 1200 });
    expect(int("12.5", { min: 0, max: 50 }).ok).toBe(false);
    expect(int("90", { min: 1, max: 60 }).ok).toBe(false);
    expect(oneOf("Property Manager", ["residential", "property_manager"] as const, null)).toEqual({ ok: true, value: "property_manager" });
    expect(oneOf("farm", ["residential"] as const, null).ok).toBe(false);
    expect(months("Jan; 2 ;dec")).toEqual({ ok: true, value: [1, 2, 12] });
    expect(months("13").ok).toBe(false);
    expect(email(" JGreen@Example.com ")).toEqual({ ok: true, value: "jgreen@example.com" });
    expect(email("nope").ok).toBe(false);
    expect(state("oh")).toEqual({ ok: true, value: "OH" });
    expect(state("Ohio").ok).toBe(false);
  });
});
