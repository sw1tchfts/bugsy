# Spec NN: <feature name>

Status: draft | ready | in progress | done
Depends on: <spec numbers>
Skills to load: <pesticide-compliance, pest-accounting, pest-domain>

## Goal
One paragraph: what a user can do when this ships, and why it matters to a pest control company.

## Users and stories
- As a <role>, I can <action> so that <outcome>.

## Scope
### In scope
- ...
### Out of scope
- ... (name the spec that covers it later, if any)

## Data
Tables and columns added or changed. Reference `docs/data-model.md`; record any deviation and why.

## Interfaces
- Files and routes to create or change (paths).
- Server actions, API routes or database functions, with inputs and outputs.
- Events this feature posts (journal entries, notices, audit rows).

## Business rules
Numbered, testable statements. Cite the skill or regulation for each domain rule.

## Edge cases
- ...

## Decisions
Choices made during the spec interview, with the reason.

## Open questions
Anything still undecided. Implementation must not start while a question here blocks a rule above.

## Verification
The end-to-end check that proves the feature works. Name the test files, the fixtures they load, and the exact commands. Include at least one check Claude can run unattended (tests, a script, or a screenshot comparison).
