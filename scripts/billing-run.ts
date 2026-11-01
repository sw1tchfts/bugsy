// Runs the billing job for every company: visit invoices, installments and prepayments due, credit allocation, autopay
// and retries, past-due statuses and late fees. The same code answers POST /api/billing/run.
import { config as loadEnv } from "dotenv";
import postgres from "postgres";
import { runBilling } from "../lib/billing/db";
import { PG_TYPES } from "../lib/pg-types";

loadEnv({ path: ".env.local" });
loadEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {}, types: PG_TYPES });

async function main() {
  const tenants = await sql<{ id: string; name: string; timezone: string }[]>`select id, name, timezone from public.tenants where status = 'active' order by created_at`;
  for (const t of tenants) {
    const c = await sql.begin((tx) => runBilling(tx, t.id, t.timezone));
    console.log(`${t.name}: ${c.visits} visit, ${c.installments} installment and ${c.prepayments} prepay invoice(s); ${c.charged} charged, ${c.failed} failed, ${c.skipped} skipped; ${c.statuses} status change(s), ${c.late_fees} late fee(s)`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
