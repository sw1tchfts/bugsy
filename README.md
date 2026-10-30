# Pest control platform: Claude Code starter kit

This repository starts empty of app code on purpose. It holds the reference material Claude Code needs to build the platform well, arranged the way Anthropic's Claude Code best practices recommend: a short CLAUDE.md, skills that load only when relevant, one spec per feature, checks Claude can run itself, and hooks for rules that must never be skipped.

## What is here

| Path | What it is | When Claude sees it |
| --- | --- | --- |
| `CLAUDE.md` | Stack, commands, the rules that are easy to get wrong, workflow | Every session (kept short on purpose) |
| `specs/` | Build order, a spec template, spec 01 written in full, stubs for 02 to 10 | When you point a session at a spec |
| `.claude/skills/wi-pesticide-compliance/` | Wisconsin licensing, records, notices, registry, bat blackout, with citations | Automatically, when work touches compliance |
| `.claude/skills/pest-accounting/` | Revenue recognition, deferred revenue, posting rules, Wisconsin sales tax | Automatically, when work touches money |
| `.claude/skills/pest-domain/` | How pest companies operate, service lines, glossary | Automatically, when terms or modeling come up |
| `.claude/skills/write-spec/` | `/write-spec`: Claude interviews you and writes a spec | Only when you type it |
| `.claude/skills/implement-spec/` | `/implement-spec`: plan, build, verify, independent review | Only when you type it |
| `.claude/agents/spec-reviewer.md` | Fresh-context reviewer that checks a diff against its spec | Called by `/implement-spec` |
| `.claude/settings.json` and `.claude/hooks/` | Hooks: block edits to committed migrations, reject tables without RLS or tenant_id, re-check migrations and typecheck before Claude stops | Always, automatically |
| `fixtures/` | Expected numbers and rule outcomes that tests must load | When tests are written |
| `docs/` | PRD (source of truth, plus the interactive site built from it), the shared feature list and competitor profiles, data model, discovery doc | When a spec points there |

## How to use it

1. Open this repository in Claude Code (on the web, choose it as the session's repo; locally, clone it and run `claude` in the folder). Local work also needs Node 20+, the Supabase CLI and Git.
2. Open the folder in Claude Code. Run `/context` once to confirm CLAUDE.md loaded, and `/hooks` to confirm the three hooks are registered.
3. Read `specs/phase-1/01-foundation.md` and change anything you disagree with. Set its status to `ready`.
4. Start a fresh session and run `/implement-spec specs/phase-1/01-foundation.md`. Approve the plan, let it build, and check the evidence it reports (test output and screenshots).
5. For each next spec: fresh session, `/write-spec specs/phase-1/02-customers.md`, answer the interview, review the result, then `/clear` and `/implement-spec`.
6. Keep `CLAUDE.md` short. When Claude repeats a mistake, add one line; when a line stops mattering, delete it. Move anything long into a skill.

## Requirements the hooks assume

Node is on the path (the hooks are small Node scripts, so they work on macOS, Linux and Windows). Migrations live in `supabase/migrations/`. The Stop hook runs `npm run typecheck` once spec 01 adds that script; until then it only checks migrations.

## Not decided yet

Stack confirmation, first tenant size, Stripe Connect account type, revenue allocation method, and the Wisconsin open questions are listed in the discovery doc and in each spec stub. Specs must not guess them.
