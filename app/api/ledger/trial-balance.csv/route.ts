import { NextResponse } from "next/server";
import { csvResponse, ledgerReader } from "@/app/api/ledger/_shared";
import { dbAs } from "@/lib/auth/session";
import { toCsv } from "@/lib/compliance/export";
import { isIsoDate } from "@/lib/dates";
import { trialBalanceFor } from "@/lib/ledger/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const reader = await ledgerReader();
  if (reader instanceof NextResponse) return reader;
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return new NextResponse("from and to are business dates, from first", { status: 400 });
  const tb = await dbAs(reader.session, (tx) => trialBalanceFor(tx, reader.active.tenantId, { from, to }));
  const csv = toCsv(
    ["number", "account", "type", "opening_cents", "debit_cents", "credit_cents", "closing_cents"],
    [...tb.rows.map((r) => [r.account.number, r.account.name, r.account.type, r.opening_cents, r.debit_cents, r.credit_cents, r.closing_cents]), ["", "Total", "", "", tb.debit_total_cents, tb.credit_total_cents, ""]],
  );
  return csvResponse(csv, `trial-balance-${from}-to-${to}.csv`);
}
