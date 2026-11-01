import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readFile } from "@/lib/import/parse";
import { validateAccount, validateAgreement, validateBalance, validateContact, validateProperty } from "@/lib/import/validate";

const row = (values: Record<string, string>, n = 2) => ({ row: n, values });
const cutover = "2026-10-01";

describe("each template's rows (spec 10 rules 2 and 3)", () => {
  it("passes every row of the fixture files", () => {
    for (const [kind, check] of [
      ["accounts", validateAccount],
      ["properties", validateProperty],
      ["contacts", validateContact],
      ["balances", validateBalance],
    ] as const) {
      const read = readFile(kind, readFileSync(`fixtures/import/${kind}.csv`, "utf8"));
      expect(read.errors).toEqual([]);
      for (const r of read.rows) expect(check(r).errors, `${kind} row ${r.row}`).toEqual([]);
    }
  });

  it("accounts: needs an id and a name; types, terms and states are checked", () => {
    expect(validateAccount(row({ external_id: "A-1", name: "" })).errors).toEqual([{ column: "name", message: "is required" }]);
    expect(validateAccount(row({ external_id: "A-1", name: "X", type: "farm", terms_days: "400", billing_state: "Ohio" })).errors.map((e) => e.column)).toEqual(["type", "terms_days", "billing_state"]);
    expect(validateAccount(row({ external_id: "A-1", name: "X" })).value).toMatchObject({ type: "residential", terms_days: 0, po_required: false });
  });

  it("properties: the address, state and type are required and checked", () => {
    const base = { external_id: "P-1", account_external_id: "A-1", line1: "1 Main", city: "Columbus", state: "OH", postal_code: "43215", property_type: "house" };
    expect(validateProperty(row(base)).errors).toEqual([]);
    expect(validateProperty(row({ ...base, state: "", property_type: "barn" })).errors.map((e) => e.column)).toEqual(["state", "property_type"]);
    expect(validateProperty(row({ ...base, unit_count: "-2" })).errors.map((e) => e.column)).toEqual(["unit_count"]);
  });

  it("contacts: an account or a property, a property for a resident, consent with both its day and how", () => {
    expect(validateContact(row({ name: "A", role: "primary" })).errors.map((e) => e.message)).toEqual(["a contact needs an account or a property"]);
    expect(validateContact(row({ name: "A", role: "resident", account_external_id: "A-1" })).errors.map((e) => e.message)).toEqual(["a resident contact needs a property"]);
    expect(validateContact(row({ name: "A", role: "primary", account_external_id: "A-1", notice_consent_on: "2026-01-01" })).errors.map((e) => e.column)).toEqual(["notice_consent_on"]);
  });

  it("agreements: plan checks as the form makes them, and a last service before go-live", () => {
    const base = { external_id: "G-1", account_external_id: "A-1", property_external_id: "P-1", service_type: "General pest plan", cadence: "quarterly", billing_mode: "flat_monthly", starts_on: "2026-01-01", initial_price: "180", recurring_price: "120" };
    expect(validateAgreement(row(base), cutover).errors).toEqual([]);
    expect(validateAgreement(row({ ...base, cadence: "weekly", billing_mode: "yearly" }), cutover).errors.map((e) => e.column)).toEqual(["cadence", "billing_mode"]);
    expect(validateAgreement(row({ ...base, first_visit_on: "2025-12-01" }), cutover).errors.map((e) => e.message)).toEqual(["The first visit cannot be before the agreement starts."]);
    expect(validateAgreement(row({ ...base, last_service_on: "2026-10-01" }), cutover).errors.map((e) => e.column)).toEqual(["last_service_on"]);
    expect(validateAgreement(row({ ...base, cadence: "seasonal_rounds" }), cutover).errors.map((e) => e.column)).toContain("cadence");
    expect(validateAgreement(row({ ...base, billed_to_date: "-5" }), cutover).errors.map((e) => e.column)).toEqual(["billed_to_date"]);
  });

  it("balances: an amount that is not zero, a due date on or after the as-of day", () => {
    expect(validateBalance(row({ account_external_id: "A-1", amount: "0", as_of: "2026-09-30" })).errors.map((e) => e.column)).toEqual(["amount"]);
    expect(validateBalance(row({ account_external_id: "A-1", amount: "10", as_of: "2026-09-30", due_on: "2026-09-01" })).errors.map((e) => e.column)).toEqual(["due_on"]);
    expect(validateBalance(row({ account_external_id: "A-1", amount: "-25", as_of: "2026-09-30" })).value).toMatchObject({ amount_cents: -2500, due_on: "2026-09-30" });
  });
});
