import { NextResponse } from "next/server";
import { csvResponse, ledgerReader } from "@/app/api/ledger/_shared";
import { dbAs } from "@/lib/auth/session";
import { toCsv } from "@/lib/compliance/export";
import { isIsoDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

/** Every journal line in the range, one row each, oldest first (spec 09). */
export async function GET(request: Request) {
  const reader = await ledgerReader();
  if (reader instanceof NextResponse) return reader;
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "0001-01-01";
  const to = url.searchParams.get("to") ?? "9999-12-31";
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return new NextResponse("from and to are business dates, from first", { status: 400 });
  const rows = await dbAs(reader.session, (tx) =>
    tx<{ number: number; posted_on: string; source_type: string; memo: string; account_number: string; account_name: string; debit_cents: string | number; credit_cents: string | number; agreement_number: number | null; jurisdiction: string | null; line_memo: string | null }[]>`
      select e.number, e.posted_on, e.source_type, e.memo, g.number as account_number, g.name as account_name, l.debit_cents, l.credit_cents, a.number as agreement_number, l.jurisdiction, l.memo as line_memo
      from public.journal_lines l join public.journal_entries e on e.id = l.entry_id join public.gl_accounts g on g.id = l.gl_account_id left join public.agreements a on a.id = l.agreement_id
      where l.tenant_id = ${reader.active.tenantId} and e.posted_on >= ${from} and e.posted_on <= ${to}
      order by e.posted_on, e.number, l.position`,
  );
  const csv = toCsv(
    ["entry", "date", "kind", "memo", "account_number", "account_name", "debit_cents", "credit_cents", "agreement", "jurisdiction", "line_memo"],
    rows.map((r) => [r.number, r.posted_on, r.source_type, r.memo, r.account_number, r.account_name, Number(r.debit_cents), Number(r.credit_cents), r.agreement_number ?? "", r.jurisdiction ?? "", r.line_memo ?? ""]),
  );
  return csvResponse(csv, `journal-${from}-to-${to}.csv`);
}
