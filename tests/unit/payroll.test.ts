import { describe, expect, it } from "vitest";
import { type PostingLine, payrollLines } from "@/lib/ledger/post";

const plain = (lines: PostingLine[]) => lines.map(({ account, debit_cents, credit_cents }) => ({ account, debit_cents, credit_cents }));
import { crewSplit, exportCsv, hoursInPeriod, lastClosedPeriod, payDue, periodFor, registerProblems } from "@/lib/payroll/periods";

describe("pay periods (spec 18 rule 9)", () => {
  it("runs weekly and biweekly from the anchor and semimonthly on the 15th", () => {
    const weekly = { period: "weekly" as const, anchor_on: "2026-10-05" }; // a Monday
    expect(periodFor(weekly, "2026-10-28")).toEqual({ starts_on: "2026-10-26", ends_on: "2026-11-01" });
    expect(periodFor(weekly, "2026-10-04")).toEqual({ starts_on: "2026-09-28", ends_on: "2026-10-04" });
    const biweekly = { period: "biweekly" as const, anchor_on: "2026-10-05" };
    expect(periodFor(biweekly, "2026-10-28")).toEqual({ starts_on: "2026-10-19", ends_on: "2026-11-01" });
    const semi = { period: "semimonthly" as const, anchor_on: "2026-01-01" };
    expect(periodFor(semi, "2026-02-20")).toEqual({ starts_on: "2026-02-16", ends_on: "2026-02-28" });
    expect(periodFor(semi, "2028-02-20").ends_on).toBe("2028-02-29");
    expect(lastClosedPeriod(weekly, "2026-11-04")).toEqual({ starts_on: "2026-10-26", ends_on: "2026-11-01" });
  });
});

describe("hours (spec 18 rule 10)", () => {
  const tz = "America/Chicago";
  const period = { starts_on: "2026-10-19", ends_on: "2026-11-01" };
  it("counts only the inside of the period, splits at the workweek, and skips open entries", () => {
    const h = hoursInPeriod(
      [
        // Sunday night into Monday, across the workweek line (Chicago is UTC-5 in October).
        { started_at: "2026-10-26T03:00:00Z", ended_at: "2026-10-26T07:00:00Z" },
        { started_at: "2026-10-20T13:00:00Z", ended_at: "2026-10-20T21:30:00Z" },
        // Starts before the period: only the part from midnight on the 19th counts.
        { started_at: "2026-10-19T03:00:00Z", ended_at: "2026-10-19T07:00:00Z" },
        { started_at: "2026-10-21T13:00:00Z", ended_at: null },
      ],
      period,
      tz,
      "2026-10-05",
    );
    expect(h.byWeek).toEqual({ "2026-10-19": 8.5 + 2 + 2, "2026-10-26": 2 });
    expect(h.total).toBe(14.5);
  });
});

describe("pay (spec 18 rules 11 and 13)", () => {
  it("splits a visit's price equally with the remainder to the lead", () => {
    expect(Object.fromEntries(crewSplit(10001, ["a", "b", "c"], "b"))).toEqual({ a: 3333, b: 3335, c: 3333 });
    expect(Object.fromEntries(crewSplit(9900, [], "a"))).toEqual({ a: 9900 });
    expect(crewSplit(0, ["a"], "a").size).toBe(0);
  });

  it("pays production at the percent, the draw as a floor, hourly by the hour and salary as set", () => {
    const production = { kind: "production" as const, hourly_rate_cents: null, production_percent: "22.5", draw_cents: 80000, salary_cents: null };
    expect(payDue(production, 40, 500000)).toEqual({ production_pay_cents: 112500, pay_due_cents: 112500 });
    expect(payDue(production, 40, 100000)).toEqual({ production_pay_cents: 22500, pay_due_cents: 80000 });
    expect(payDue({ kind: "hourly", hourly_rate_cents: 2350, production_percent: null, draw_cents: null, salary_cents: null }, 37.25, 0).pay_due_cents).toBe(87538);
    expect(payDue({ kind: "salary", hourly_rate_cents: null, production_percent: null, draw_cents: null, salary_cents: 192308 }, 0, 0).pay_due_cents).toBe(192308);
    expect(payDue(null, 10, 0).pay_due_cents).toBeNull();
  });

  it("writes one row per person with hours by workweek and money in dollars", () => {
    const csv = exportCsv({ starts_on: "2026-10-19", ends_on: "2026-11-01" }, [
      { payroll_id: "E-7", name: "Sam Rivera, Jr.", email: "sam@x.test", kind: "production", hours: 41.5, hours_by_week: { "2026-10-19": 20, "2026-10-26": 21.5 }, hourly_rate_cents: null, production_revenue_cents: 500000, production_percent: "22.500", production_pay_cents: 112500, draw_cents: 80000, salary_cents: null, pay_due_cents: 112500, commissions_cents: 4500 },
    ]);
    const [head, row] = csv.trim().split("\r\n");
    expect(head).toContain("hours_week_of_2026-10-19,hours_week_of_2026-10-26");
    expect(row).toBe('2026-10-19,2026-11-01,E-7,"Sam Rivera, Jr.",sam@x.test,production,41.50,20.00,21.50,,5000.00,22.500,1125.00,800.00,,1125.00,45.00');
  });

  it("posts the register only when it balances, carrying payroll-paid commissions out of commissions payable", () => {
    const r = { gross_wages_cents: 500000, employer_taxes_cents: 38250, withholdings_cents: 110000, net_pay_cents: 390000, commissions_cents: 4500 };
    expect(registerProblems(r, 4500)).toEqual([]);
    expect(registerProblems({ ...r, net_pay_cents: 389999 }, 4500)).toContain("gross wages must equal net pay plus withholdings");
    expect(registerProblems(r, 0)).toContain("the commissions paid must be the export's commissions");
    const lines = payrollLines(r);
    expect(plain(lines)).toEqual([
      { account: "technician_labor", debit_cents: 533750, credit_cents: 0 },
      { account: "commissions_payable", debit_cents: 4500, credit_cents: 0 },
      { account: "payroll_liabilities", debit_cents: 0, credit_cents: 148250 },
      { account: "operating_bank", debit_cents: 0, credit_cents: 390000 },
    ]);
    expect(lines.reduce((s, l) => s + l.debit_cents - l.credit_cents, 0)).toBe(0);
  });
});
