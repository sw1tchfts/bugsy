// Checks Supabase migrations for the tenancy rules in CLAUDE.md.
// Every table created in the public schema must enable row level security,
// and must have a tenant_id column unless marked with "-- shared-table: <reason>".
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const CREATE_RE = /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)\s*\(/gi;
const RLS_RE = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."]+)\s+enable\s+row\s+level\s+security/gi;

function normalize(name) {
  const clean = name.replace(/"/g, "").toLowerCase();
  const parts = clean.split(".");
  return parts.length === 1 ? { schema: "public", table: parts[0] } : { schema: parts[0], table: parts[1] };
}

// Blank out comments but keep every character position, so indices match the original text.
function stripComments(sql) {
  return sql
    .replace(/--[^\n]*/g, (s) => " ".repeat(s.length))
    .replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, " "));
}

function bodyAfter(sql, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") {
      depth--;
      if (depth === 0) return sql.slice(openIndex + 1, i);
    }
  }
  return sql.slice(openIndex + 1);
}

export function rlsEnabledTables(sqlTexts) {
  const enabled = new Set();
  for (const text of sqlTexts) {
    const sql = stripComments(text);
    for (const m of sql.matchAll(RLS_RE)) {
      const { schema, table } = normalize(m[1]);
      enabled.add(`${schema}.${table}`);
    }
  }
  return enabled;
}

// Returns a list of problem strings for one migration file.
export function checkMigration(fileLabel, text, allSqlTexts) {
  const problems = [];
  const enabled = rlsEnabledTables(allSqlTexts);
  const sql = stripComments(text);
  for (const m of sql.matchAll(CREATE_RE)) {
    const { schema, table } = normalize(m[1]);
    if (schema !== "public") continue;
    const openIndex = m.index + m[0].length - 1;
    const body = bodyAfter(sql, openIndex);
    // Look for the shared-table marker between the previous statement and the end of this one.
    const statementStart = sql.lastIndexOf(";", m.index) + 1;
    const before = text.slice(statementStart, m.index + m[0].length + body.length);
    const shared = /--\s*shared-table:\s*\S/i.test(before);
    if (!enabled.has(`public.${table}`)) {
      problems.push(`${fileLabel}: table public.${table} does not enable row level security. Add "alter table public.${table} enable row level security;" and its policies.`);
    }
    if (!shared && !/(^|[\s,(])tenant_id\s/i.test(body)) {
      problems.push(`${fileLabel}: table public.${table} has no tenant_id column. Add "tenant_id uuid not null references public.tenants(id)", or mark the table with "-- shared-table: <reason>" if it is platform-wide.`);
    }
  }
  return problems;
}

export function migrationsDir(projectDir) {
  return join(projectDir, "supabase", "migrations");
}

export function readAllMigrations(projectDir) {
  const dir = migrationsDir(projectDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ name: f, text: readFileSync(join(dir, f), "utf8") }));
}

export function isMigrationPath(filePath) {
  return /(^|[\\/])supabase[\\/]migrations[\\/][^\\/]+\.sql$/i.test(filePath || "");
}

export async function readStdinJson() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  try {
    return JSON.parse(data || "{}");
  } catch {
    return {};
  }
}
