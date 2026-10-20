---
name: implement-spec
description: Build one ready spec end to end, verify it, and have a fresh reviewer check the diff against the spec.
disable-model-invocation: true
argument-hint: "[spec file path]"
---

Implement the spec at: $ARGUMENTS

1. Read the spec. If its status is not `ready`, or an open question blocks a business rule, stop and say what is missing.
2. Load the skills the spec names. Read the code it touches and the fixtures its Verification section names.
3. Write a plan: files to change, migrations, tests, and the order. Show it and wait for approval before editing.
4. Implement in small steps. Write or update tests alongside the code. Load expected values from `fixtures/`; never edit a fixture to make a test pass.
5. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:rls` and every command in the spec's Verification section. Fix failures at the root cause.
6. Use the `spec-reviewer` subagent to review the diff against the spec. Fix gaps that affect correctness or a stated requirement; list the rest as follow-ups.
7. Update the spec's status to `done` in the spec and in `specs/README.md`. Report what changed, with the command output as evidence.
