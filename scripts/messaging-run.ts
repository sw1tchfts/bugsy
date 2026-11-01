// Runs the messaging job for every company: reminders, due notices, scheduled campaigns and every message due. The
// same code answers POST /api/messaging/run.
import { config as loadEnv } from "dotenv";
import postgres from "postgres";
import { runMessaging } from "../lib/messaging/db";
import { PG_TYPES } from "../lib/pg-types";

loadEnv({ path: ".env.local" });
loadEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {}, types: PG_TYPES });

async function main() {
  const tenants = await sql<{ id: string; name: string; timezone: string }[]>`select id, name, timezone from public.tenants order by created_at`;
  for (const t of tenants) {
    const c = await sql.begin((tx) => runMessaging(tx, t.id, t.timezone));
    console.log(`${t.name}: ${c.reminders} reminder(s) and ${c.notices} notice(s) queued, ${c.campaigns} campaign(s) launched; ${c.delivered} delivered, ${c.sent} sent, ${c.failed} failed, ${c.suppressed} suppressed, ${c.deferred} held for quiet hours`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
