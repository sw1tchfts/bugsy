import { strToU8, zipSync } from "fflate";
import { NextResponse } from "next/server";
import { reportsReader } from "@/app/api/reports/_shared";
import { dbAs } from "@/lib/auth/session";
import { todayInZone } from "@/lib/dates";
import { exportDatasets } from "@/lib/reports/db";

export const dynamic = "force-dynamic";

/** Every dataset the member can read as CSVs in one zip, with a README of the columns (spec 12). */
export async function GET() {
  const reader = await reportsReader();
  if (reader instanceof NextResponse) return reader;
  const { session, active } = reader;
  const files = await dbAs(session, (tx) => exportDatasets(tx, active.tenantId, active.permissions));
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])), { level: 6 });
  return new NextResponse(Buffer.from(zip), {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="bugsy-export-${todayInZone(active.tenantTimezone)}.zip"`, "cache-control": "private, no-store" },
  });
}
