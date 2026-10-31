// Regenerates lib/supabase/types.ts from the database in DATABASE_URL (loaded from .env.local).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const types = execFileSync("npx", ["supabase", "gen", "types", "typescript", "--db-url", databaseUrl, "--schema", "public,app"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
  maxBuffer: 64 * 1024 * 1024,
});
if (!types.includes("export type Database")) throw new Error("type generation produced no Database type");
writeFileSync("lib/supabase/types.ts", types);
console.log(`wrote lib/supabase/types.ts (${types.split("\n").length} lines)`);
