import { NextResponse } from "next/server";
import { csvResponse, ledgerReader } from "@/app/api/ledger/_shared";
import { dbAs } from "@/lib/auth/session";
import { toCsv } from "@/lib/compliance/export";
import { isIsoDate } from "@/lib/dates";
import { rollForwardFor } from "@/lib/ledger/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const reader = await ledgerReader();
  if (reader instanceof NextResponse) return reader;
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return new NextResponse("from and to are business dates, from first", { status: 400 });
  const report = await dbAs(reader.session, (tx) => rollForwardFor(tx, reader.active.tenantId, { from, to }));
  const csv = toCsv(
    ["agreement", "customer", "billing_mode", "opening_cents", "billed_cents", "recognized_cents", "closing_cents", "deferred_cents", "unbilled_cents"],
    report.rows.map((r) => {
      const g = report.names.get(r.agreement_id);
      return [g?.number ?? "", g?.account_name ?? "", g?.billing_mode ?? "", r.opening_cents, r.billed_cents, r.recognized_cents, r.closing_cents, r.deferred_cents, r.asset_cents];
    }),
  );
  return csvResponse(csv, `contract-balances-${from}-to-${to}.csv`);
}
