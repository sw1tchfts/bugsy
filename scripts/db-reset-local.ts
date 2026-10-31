// The native-Postgres stand-in for `supabase db reset`: drops the app's schemas, re-applies the shim and
// every migration in order, then seeds. Development only; see docs/dev-setup.md.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local" });
loadEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");
if (/supabase\.co/.test(databaseUrl)) throw new Error("refusing to reset a hosted Supabase database");

const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });

async function main() {
  await sql.unsafe("drop schema if exists public cascade; drop schema if exists app cascade; create schema public;");
  await sql.unsafe("grant usage, create on schema public to postgres; grant usage on schema public to anon, authenticated, service_role;");
  await sql.file("scripts/db-shim.sql");
  const dir = join("supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await sql.file(join(dir, file));
    console.log(`applied ${file}`);
  }
}

main()
  .then(() => sql.end())
  .then(() => {
    if (!process.argv.includes("--no-seed")) execFileSync("npx", ["tsx", "scripts/seed.ts"], { stdio: "inherit" });
  })
  .catch(async (err) => {
    console.error(err);
    process.exitCode = 1;
    await sql.end();
  });
