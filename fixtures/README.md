# Verification fixtures

Expected values that tests load. They encode business and legal rules, so they change only by a deliberate decision, never to make a test pass.

Fixtures at the top level apply in every state. Fixtures under `states/<state>/` verify one state's rule pack in `lib/compliance/rules/<state>.ts`; each state Bugsy supports gets its own folder, written from the state's file in `.claude/skills/pesticide-compliance/states/`. Tests of the rules engine run against every state folder present.

| File | Verifies | Used by specs |
| --- | --- | --- |
| accounting/agreement-ledger.json | Month-end contract positions for five billing scenarios; installment rounding | 04, 08, 09 |
| accounting/posting-rules.json | Journal lines for each business event; every entry balances | 09 |
| states/wi/application-record.json | Wisconsin record fields (ATCP 29.21), valid and invalid visits | 06, 07 |
| states/wi/notices.json | Wisconsin notice due times, consent rules, registry advance notice | 07 |
| states/wi/service-type-rules.json | Wisconsin certification categories and tax class per service line | 03, 05 |
| states/wi/scheduling-rules.json | License, certification, trainee, restricted-use, bat blackout and treatment-extent checks with Wisconsin's values | 05, 07 |
| states/wi/taxability.json | Which work is taxable in Wisconsin | 08 |

Generated values in `agreement-ledger.json` were computed by script and checked by hand. Product names, EPA numbers and the test tax rate are placeholders.

Open questions in a state's file (for Wisconsin: tick certification, mosquito taxability, holiday counting, trainee expiry day) are marked in that state's fixtures rather than guessed.
