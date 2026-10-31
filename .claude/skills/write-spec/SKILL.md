---
name: write-spec
description: Interview the user about one feature and write or complete its spec file from the project template.
disable-model-invocation: true
argument-hint: "[spec file path or feature name]"
---

Write the spec for: $ARGUMENTS

1. Read `specs/_template.md`, `docs/data-model.md`, `specs/README.md` and the target spec file if it exists (stubs list decisions already made and questions to ask). Read any specs this one depends on.
2. Load the skills the stub names (`pesticide-compliance`, `pest-accounting`, `pest-domain`) before asking questions, so you do not ask what they already answer.
3. Read the relevant code if any exists, so the spec names real files and interfaces.
4. Interview the user with the AskUserQuestion tool. Ask about the hard parts: business rules, edge cases, tradeoffs, what is out of scope, and how we will know it works. Do not ask questions the stub, skills or data model already answer. Offer a recommended option first when you have one. Keep going until every question in the stub is answered or explicitly deferred.
5. Write the full spec to the target path using every template section. Business rules are numbered and testable. Name files, routes, functions and tables. Put unresolved items under Open questions, and say whether each one blocks implementation.
6. The Verification section must name test files, the fixtures they load, the exact commands, and at least one check that runs unattended.
7. Set the spec's status to `draft`, update its row in `specs/README.md`, and summarize the decisions in three to five lines. Do not start implementing.
