// Applies scripts/db-shim.sql to DATABASE_URL. Development only; see docs/dev-setup.md.
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local" });
loadEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });

sql
  .file("scripts/db-shim.sql")
  .then(() => console.log("applied scripts/db-shim.sql"))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
