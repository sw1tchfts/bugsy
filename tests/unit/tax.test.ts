import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type TaxRate, centsAtRate, ratesInForce, scaledRate, taxClassFor, taxForLine } from "@/lib/billing/tax";

const fixture = JSON.parse(readFileSync("fixtures/accounting/posting-rules.json", "utf8")) as {
  test_tax_rate: { rate: string };
  cases: { event: string; input: { lines?: { tax_class: string; amount_cents: number; tax_rate?: string }[] }; expected_lines: { account: string; debit_cents?: number; credit_cents?: number }[] }[];
};

const rate = (overrides: Partial<TaxRate> = {}): TaxRate => ({
  state_code: "ZZ",
  postal_code: "99999",
  jurisdiction_kind: "state",
  jurisdiction_name: "State",
  rate: fixture.test_tax_rate.rate,
  effective_from: "2026-01-01",
  effective_to: null,
  ...overrides,
});

describe("sales tax (rule 5)", () => {
  it("taxes the posting-rules fixture's taxable line to the cent and leaves the nontaxable one alone", () => {
    const taxed = fixture.cases.find((c) => c.event === "invoice_issued" && c.input.lines?.[0].tax_class === "taxable");
    const exempt = fixture.cases.find((c) => c.event === "invoice_issued" && c.input.lines?.[0].tax_class === "nontaxable");
    if (!taxed?.input.lines || !exempt?.input.lines) throw new Error("fixture cases missing");
    const expectedTax = taxed.expected_lines.find((l) => l.account === "sales_tax_payable")?.credit_cents;
    expect(taxForLine({ amount_cents: taxed.input.lines[0].amount_cents, tax_class: "taxable", rates: [rate({ rate: taxed.input.lines[0].tax_rate })] }).tax_cents).toBe(expectedTax);
    expect(taxForLine({ amount_cents: exempt.input.lines[0].amount_cents, tax_class: "exempt", rates: [rate()] }).tax_cents).toBe(0);
  });

  it("works in exact decimals and rounds half up", () => {
    expect(scaledRate("0.055").toString()).toBe("55000000");
    expect(centsAtRate(6000, scaledRate("0.055"))).toBe(330);
    expect(centsAtRate(1, scaledRate("0.5"))).toBe(1);
    expect(centsAtRate(1, scaledRate("0.4999"))).toBe(0);
    expect(centsAtRate(12345, scaledRate("0.0725"))).toBe(895);
    expect(() => scaledRate("five")).toThrow();
  });

  it("applies only the rows in force for the address on the date, and keeps a breakdown that sums to the tax", () => {
    const rates: TaxRate[] = [
      rate(),
      rate({ jurisdiction_kind: "county", jurisdiction_name: "County", rate: "0.0125" }),
      rate({ jurisdiction_kind: "city", jurisdiction_name: "Old city rate", rate: "0.01", effective_to: "2026-06-30" }),
      rate({ postal_code: "11111", jurisdiction_name: "Elsewhere", rate: "0.09" }),
      rate({ state_code: "YY", jurisdiction_name: "Other state", rate: "0.08" }),
    ];
    const inForce = ratesInForce(rates, "zz", "99999-1234", "2026-07-01");
    expect(inForce.map((r) => r.jurisdiction_name)).toEqual(["State", "County"]);
    const line = taxForLine({ amount_cents: 10000, tax_class: "taxable", rates: inForce });
    expect(line.rate).toBe("0.0675");
    expect(line.tax_cents).toBe(675);
    expect(line.breakdown.map((b) => b.cents)).toEqual([550, 125]);
    expect(line.breakdown.reduce((sum, b) => sum + b.cents, 0)).toBe(line.tax_cents);
    const odd = taxForLine({ amount_cents: 3333, tax_class: "taxable", rates: inForce });
    expect(odd.breakdown.reduce((sum, b) => sum + b.cents, 0)).toBe(odd.tax_cents);
  });

  it("taxes nothing for unknown, exempt and certificate classes, or without rates", () => {
    expect(taxForLine({ amount_cents: 10000, tax_class: "unknown", rates: [rate()] }).tax_cents).toBe(0);
    expect(taxForLine({ amount_cents: 10000, tax_class: "exempt_certificate", rates: [rate()] }).tax_cents).toBe(0);
    expect(taxForLine({ amount_cents: 10000, tax_class: "taxable", rates: [] })).toEqual({ tax_cents: 0, rate: "0", breakdown: [] });
  });

  it("decides the class from the certificate first, then the state rule", () => {
    expect(taxClassFor({ tax_class: "taxable" }, { tax_exempt_number: "GOV-1", tax_exempt_expires_on: "2027-12-31" }, "2026-11-01")).toBe("exempt_certificate");
    expect(taxClassFor({ tax_class: "taxable" }, { tax_exempt_number: "GOV-1", tax_exempt_expires_on: "2026-01-01" }, "2026-11-01")).toBe("taxable");
    expect(taxClassFor({ tax_class: "exempt" }, null, "2026-11-01")).toBe("exempt");
    expect(taxClassFor({ tax_class: "unknown" }, null, "2026-11-01")).toBe("unknown");
    expect(taxClassFor(null, null, "2026-11-01")).toBe("unknown");
  });
});
