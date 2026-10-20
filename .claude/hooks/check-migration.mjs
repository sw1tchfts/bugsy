// PostToolUse hook (Edit|Write): after a migration file changes, check tenancy rules.
// Exit 2 sends the problems back to Claude so it can fix the migration.
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { checkMigration, isMigrationPath, readAllMigrations, readStdinJson } from "./lib/migration-check.mjs";

const input = await readStdinJson();
const filePath = input?.tool_input?.file_path;
if (!isMigrationPath(filePath) || !existsSync(filePath)) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const text = readFileSync(filePath, "utf8");
const others = readAllMigrations(projectDir).filter((m) => m.name !== basename(filePath)).map((m) => m.text);
const problems = checkMigration(basename(filePath), text, [...others, text]);

if (problems.length) {
  console.error("Migration breaks the tenancy rules in CLAUDE.md:\n- " + problems.join("\n- "));
  process.exit(2);
}
process.exit(0);
