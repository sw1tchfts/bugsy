// Stop hook: before Claude ends a turn, re-check every migration and run typecheck.
// Exit 2 keeps Claude working and tells it what failed.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { checkMigration, readAllMigrations, readStdinJson } from "./lib/migration-check.mjs";

const input = await readStdinJson();
if (input.stop_hook_active === true) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const failures = [];

const migrations = readAllMigrations(projectDir);
const allTexts = migrations.map((m) => m.text);
for (const m of migrations) failures.push(...checkMigration(m.name, m.text, allTexts));

const pkgPath = join(projectDir, "package.json");
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (pkg.scripts?.typecheck) {
    const run = spawnSync("npm", ["run", "-s", "typecheck"], { cwd: projectDir, encoding: "utf8", shell: process.platform === "win32" });
    if (run.status !== 0) {
      const out = `${run.stdout || ""}${run.stderr || ""}`.trim().split("\n").slice(-30).join("\n");
      failures.push(`npm run typecheck failed:\n${out}`);
    }
  }
}

if (failures.length) {
  console.error("Not done yet. Fix these before finishing:\n- " + failures.join("\n- "));
  process.exit(2);
}
process.exit(0);
