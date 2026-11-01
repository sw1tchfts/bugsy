// Runs the compliance job for every company: records for completed visits, locks when due, notices and tasks.
// The same code answers POST /api/compliance/run; this script is for a machine with a shell (local, a cron box).
import { config as loadEnv } from "dotenv";
import postgres from "postgres";
import { runCompliance } from "../lib/compliance/db";
import { PG_TYPES } from "../lib/pg-types";

loadEnv({ path: ".env.local" });
loadEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {}, types: PG_TYPES });

async function main() {
  const tenants = await sql<{ id: string; name: string; timezone: string }[]>`select id, name, timezone from public.tenants where status = 'active' order by created_at`;
  for (const t of tenants) {
    const counts = await sql.begin((tx) => runCompliance(tx, t.id, t.timezone));
    console.log(`${t.name}: ${counts.records} record(s), ${counts.locked} locked, ${counts.notices} notice(s), ${counts.tasks} task(s)`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
