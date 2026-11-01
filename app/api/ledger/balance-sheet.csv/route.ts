import { NextResponse } from "next/server";
import { csvResponse, ledgerReader } from "@/app/api/ledger/_shared";
import { dbAs } from "@/lib/auth/session";
import { toCsv } from "@/lib/compliance/export";
import { isIsoDate } from "@/lib/dates";
import { balanceSheetFor } from "@/lib/ledger/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const reader = await ledgerReader();
  if (reader instanceof NextResponse) return reader;
  const url = new URL(request.url);
  const asOf = url.searchParams.get("as_of") ?? "";
  if (!isIsoDate(asOf)) return new NextResponse("as_of is a business date", { status: 400 });
  const bs = await dbAs(reader.session, (tx) => balanceSheetFor(tx, reader.active.tenantId, asOf));
  const csv = toCsv(
    ["section", "number", "account", "amount_cents"],
    [
      ...bs.assets.map((r) => ["assets", r.account.number, r.account.name, r.amount_cents]),
      ["assets", "", "Total assets", bs.assets_cents],
      ...bs.liabilities.map((r) => ["liabilities", r.account.number, r.account.name, r.amount_cents]),
      ["liabilities", "", "Total liabilities", bs.liabilities_cents],
      ...bs.equity.map((r) => ["equity", r.account.number, r.account.name, r.amount_cents]),
      ["equity", "", "Net income to date", bs.net_income_cents],
      ["equity", "", "Total equity", bs.total_equity_cents],
    ],
  );
  return csvResponse(csv, `balance-sheet-${asOf}.csv`);
}
