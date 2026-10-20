# Specs

One spec per slice. Build in order; each slice ends with a working, tested increment. A stub becomes buildable after `/write-spec` interviews you and fills it in.

## Phase 1: run a residential route end to end

| # | Spec | Status | Depends on |
| --- | --- | --- | --- |
| 01 | [Foundation: tenancy, auth, roles, branches, audit](phase-1/01-foundation.md) | ready for review | none |
| 02 | [Customers: accounts, properties, contacts, leads, quotes](phase-1/02-customers.md) | stub | 01 |
| 03 | [Catalog: service types, price book, product master](phase-1/03-catalog.md) | stub | 01 |
| 04 | [Agreements and visit generation](phase-1/04-agreements.md) | stub | 02, 03 |
| 05 | [Dispatch board](phase-1/05-dispatch.md) | stub | 04 |
| 06 | [Technician app and visit capture (offline)](phase-1/06-technician-app.md) | stub | 05 |
| 07 | [Compliance: credentials, records, notices, registry](phase-1/07-compliance.md) | stub | 06 |
| 08 | [Billing: Stripe Connect, invoices, autopay, Wisconsin sales tax](phase-1/08-billing.md) | stub | 04 |
| 09 | [General ledger: chart of accounts, posting, deferred revenue](phase-1/09-ledger.md) | stub | 08 |
| 10 | [Spreadsheet import](phase-1/10-import.md) | stub | 02, 04 |

Gate to Phase 2: a pilot company runs its daily operations on the platform.

## Phase 2 and 3

Not specced yet. Order comes from the discovery doc roadmap and the competitor crosswalk: customer portal, commercial devices and maps, audit binder, termite, wildlife and bed bug jobs, route optimization, door-to-door app, commissions and payroll export, QuickBooks sync; then bank feeds, AI features, website intake, a second state, and imports from other pest software.

## How to work a spec

1. `/write-spec specs/phase-1/NN-name.md` in a fresh session. Answer the interview; Claude writes the spec.
2. Review and edit the spec yourself. Set its status to `ready`.
3. `/clear`, then `/implement-spec specs/phase-1/NN-name.md`.
4. The implementing session ends by running the spec's verification step and a `spec-reviewer` subagent check.
