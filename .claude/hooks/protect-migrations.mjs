// PreToolUse hook (Edit|Write): block changes to migrations that are already committed.
// New migration files are allowed.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isMigrationPath, readStdinJson } from "./lib/migration-check.mjs";

const input = await readStdinJson();
const filePath = input?.tool_input?.file_path;
if (!isMigrationPath(filePath) || !existsSync(filePath)) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
let committed = false;
try {
  execFileSync("git", ["-C", projectDir, "cat-file", "-e", `HEAD:${relative(projectDir, filePath)}`], { stdio: "ignore" });
  committed = true;
} catch {
  committed = false;
}

if (committed) {
  console.error(`Blocked: ${filePath} is a committed migration. Create a new migration with "supabase migration new <name>" instead of editing it.`);
  process.exit(2);
}
process.exit(0);

function relative(base, p) {
  const b = base.replace(/\\/g, "/").replace(/\/$/, "");
  const f = p.replace(/\\/g, "/");
  return f.startsWith(b + "/") ? f.slice(b.length + 1) : f;
}
