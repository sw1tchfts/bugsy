# Verification fixtures

Expected values that tests load. They encode business and legal rules, so they change only by a deliberate decision, never to make a test pass.

Fixtures at the top level apply in every state. State fixtures go in `states/<state>/` and verify that state's rule pack in `lib/compliance/rules/<state>.ts`: valid and invalid application records, notice due times, scheduling allow and block cases, and taxability. They are written from the state's file in `.claude/skills/pesticide-compliance/states/` when a launch state is chosen; none exist yet. Tests of the rules engine run against every state folder present.

| File | Verifies | Used by specs |
| --- | --- | --- |
| accounting/agreement-ledger.json | Month-end contract positions for five billing scenarios; installment rounding | 04, 08, 09 |
| accounting/posting-rules.json | Journal lines for each business event; every entry balances | 09 |

Generated values in `agreement-ledger.json` were computed by script and checked by hand. Product names, EPA numbers and the test tax rate are placeholders.

A state's open questions are marked in its fixtures rather than guessed.
