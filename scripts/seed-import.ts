// Spec 10 seed: each demo company went live by importing the sample files in fixtures/import/ (a few customers moved
// from an old system, two mid-term agreements, opening balances) with one history file kept, so the import pages and
// the isolation suite have real batches. Idempotent: a second run skips every row. Called after the billing seed.
import { readFileSync } from "node:fs";
import path from "node:path";
import type postgres from "postgres";
import { runBilling } from "../lib/billing/db";
import { stubProvider } from "../lib/geo/stub";
import { importBatch } from "../lib/import/db";
import { IMPORT_KINDS } from "../lib/import/templates";
import type { SeedTenant } from "./seed-data";

type Sql = postgres.Sql;

const DIR = path.join(__dirname, "..", "fixtures", "import");

export async function seedImport(sql: Sql, tenant: SeedTenant, tenantId: string): Promise<void> {
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from public.import_batches where tenant_id = ${tenantId} and status = 'committed'`;
  if (n > 0) return;
  const expected = JSON.parse(readFileSync(path.join(DIR, "expected.json"), "utf8")) as { cutover_on: string };
  const enc = new TextEncoder();
  const templates = Object.fromEntries(IMPORT_KINDS.map((k) => [k, { name: `${k}.csv`, contentType: "text/csv", data: new Uint8Array(readFileSync(path.join(DIR, `${k}.csv`))) }]));
  const history = [{ file: { name: "old-application-log.csv", contentType: "text/csv", data: enc.encode("date,address,product,epa_reg_no,amount\n2026-07-20,412 Elm St,Demand CS,100-1066,8 fl oz\n") }, label: "Application log exported from the old system" }];
  const result = await importBatch((fn) => sql.begin(fn), tenantId, { templates, history, mode: "commit", cutoverOn: expected.cutover_on, timeZone: tenant.timezone, geocoder: stubProvider });
  if (result.status !== "committed") throw new Error(`seed import for ${tenant.name} failed: ${JSON.stringify(result.report.errors.slice(0, 5))}`);
  // The job bills what is due since go-live.
  await runBilling(sql, tenantId, tenant.timezone);
}
