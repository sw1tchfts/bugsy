# Verification fixtures

Expected values that tests load. They encode business and legal rules, so they change only by a deliberate decision, never to make a test pass.

| File | Verifies | Used by specs |
| --- | --- | --- |
| accounting/agreement-ledger.json | Month-end contract positions for five billing scenarios; installment rounding | 04, 08, 09 |
| accounting/posting-rules.json | Journal lines for each business event; every entry balances | 09 |
| compliance/application-record.json | ATCP 29.21 record fields, valid and invalid visits | 06, 07 |
| compliance/notices.json | Notice due times, consent rules, landscape advance notice | 07 |
| compliance/service-type-rules.json | Required certification categories and tax class per service line | 03, 05 |
| scheduling/rules.json | License, certification, trainee, restricted-use, bat blackout and 10-foot rule checks | 05, 07 |
| tax/taxability.json | Which work is taxable in Wisconsin | 08 |

Generated values in `agreement-ledger.json` were computed by script and checked by hand. Product names, EPA numbers and the test tax rate are placeholders.

Open questions in the skills (tick certification, mosquito taxability, holiday counting, trainee expiry day) are marked in the fixtures rather than guessed.
