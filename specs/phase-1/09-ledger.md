# Spec 09: General ledger: chart of accounts, posting, deferred revenue

Status: stub (run /write-spec on this file)
Depends on: 08
Skills to load: pest-accounting

## Goal
Every financial event posts a balanced journal entry; revenue is recognized as visits are performed, with deferred revenue and unbilled receivables tracked per agreement.

## Already decided (from the discovery doc)
- Double-entry GL per tenant; a pest control chart of accounts template.
- Revenue recognized when a visit is completed; billing and recognition meet in one contract balance per agreement.
- Accrual books with a cash-basis view.
- Payroll is not built; export hours and production pay, post the payroll journal back.
- QuickBooks sync is Phase 2.

## Questions for the spec interview
- Closed-period rules: who can reopen a period?
- Revenue allocation: visit list price (default) or relative standalone selling price? Confirm with an accountant.
- Which financial statements ship in Phase 1 (trial balance, P&L, balance sheet)?

## Verification will use
- fixtures/accounting/agreement-ledger.json (month-end contract positions for five scenarios).

The interview fills in the remaining template sections: users and stories, scope, data, interfaces, business rules, edge cases, decisions, open questions and verification.
