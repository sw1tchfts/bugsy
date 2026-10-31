# Spec 10: Spreadsheet import

Status: stub (run /write-spec on this file)
Depends on: 02, 04
Skills to load: pest-domain

## Goal
A pilot company can load its customers, properties and active agreements from spreadsheets on day one.

## Already decided (from the discovery doc)
- Phase 1 imports from CSV templates we publish; importers for specific pest software are Phase 3.
- Opening balances import as a single journal entry per account.

## Questions for the spec interview
- Which fields are required versus optional in each template?
- Dry-run preview with row-level errors before commit?
- How to import visit history needed for compliance retention (the state's retention period)?

## Verification will use
- A sample import file set in fixtures/import/ (to be created with the spec).

The interview fills in the remaining template sections: users and stories, scope, data, interfaces, business rules, edge cases, decisions, open questions and verification.
