import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { IMPORT_KINDS, type ImportKind, templateCsv } from "@/lib/import/templates";

export const dynamic = "force-dynamic";

/** A template CSV: the header row and one example row (spec 10). Templates are the same for every company. */
export async function GET(_request: Request, context: { params: Promise<{ kind: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("sign in", { status: 401 });
  const { kind } = await context.params;
  const name = kind.replace(/\.csv$/, "") as ImportKind;
  if (!IMPORT_KINDS.includes(name)) return new NextResponse("not found", { status: 404 });
  return new NextResponse(templateCsv(name), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "private, no-store" },
  });
}
