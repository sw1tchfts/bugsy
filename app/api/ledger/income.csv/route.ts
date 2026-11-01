import { NextResponse } from "next/server";
import { csvResponse, ledgerReader } from "@/app/api/ledger/_shared";
import { dbAs } from "@/lib/auth/session";
import { toCsv } from "@/lib/compliance/export";
import { isIsoDate } from "@/lib/dates";
import { CHART_TEMPLATE } from "@/lib/ledger/chart";
import { cashBasisFor, incomeStatementFor } from "@/lib/ledger/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const reader = await ledgerReader();
  if (reader instanceof NextResponse) return reader;
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const basis = url.searchParams.get("basis") === "cash" ? "cash" : "accrual";
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return new NextResponse("from and to are business dates, from first", { status: 400 });
  if (basis === "cash") {
    const names = new Map(CHART_TEMPLATE.map((a) => [a.key, a.name]));
    const view = await dbAs(reader.session, (tx) => cashBasisFor(tx, reader.active.tenantId, { from, to }, reader.active.tenantTimezone));
    const csv = toCsv(
      ["section", "line", "amount_cents"],
      [
        ...view.revenue.map((r) => ["revenue", names.get(r.account) ?? r.account, r.amount_cents]),
        ["revenue", "Total revenue received", view.revenue_cents],
        ["other", "Sales tax collected", view.tax_collected_cents],
        ["other", "Receipts not yet applied", view.unapplied_cents],
        ["deductions", "Refunds", -view.refunds_cents],
        ["deductions", "Payment processing fees", -view.fees_cents],
        ["net", "Net cash income", view.net_cents],
      ],
    );
    return csvResponse(csv, `income-cash-${from}-to-${to}.csv`);
  }
  const pl = await dbAs(reader.session, (tx) => incomeStatementFor(tx, reader.active.tenantId, { from, to }));
  const csv = toCsv(
    ["section", "number", "account", "amount_cents"],
    [
      ...pl.revenue.map((r) => ["revenue", r.account.number, r.account.name, r.amount_cents]),
      ["revenue", "", "Total revenue", pl.revenue_cents],
      ...pl.expenses.map((r) => ["expenses", r.account.number, r.account.name, r.amount_cents]),
      ["expenses", "", "Total expenses", pl.expenses_cents],
      ["net", "", "Net income", pl.net_income_cents],
    ],
  );
  return csvResponse(csv, `income-${from}-to-${to}.csv`);
}
