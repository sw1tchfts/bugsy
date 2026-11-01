# Specs

One spec per slice. Everything ships in one build; specs are sequenced by dependency, and each ends with a working, tested increment. A stub becomes buildable after `/write-spec` interviews you and fills it in. Scope per feature lives in `docs/competitors/bugsy-plan.json`; the PRD (`docs/prd.md`) proposes an answer to every open question below.

## Build order

Specs 01 to 10 sit in `phase-1/` for historical reasons; the folder name does not mean a phase. Specs 11 to 21 have no file yet: run `/write-spec` with a new path such as `specs/11-messaging.md`.

| # | Spec | Status | Depends on |
| --- | --- | --- | --- |
| 01 | [Foundation: tenancy, auth, roles, branches, audit](phase-1/01-foundation.md) | done | none |
| 02 | [Customers: accounts, properties, contacts, leads, quotes](phase-1/02-customers.md) | done | 01 |
| 03 | [Catalog: service types, price book, product master](phase-1/03-catalog.md) | done | 01, 02 |
| 04 | [Agreements and visit generation](phase-1/04-agreements.md) | done | 02, 03 |
| 05 | [Dispatch board](phase-1/05-dispatch.md) | done | 04 |
| 06 | [Technician app and visit capture (offline)](phase-1/06-technician-app.md) | done | 05 |
| 07 | [Compliance: credentials, records, notices, state rules](phase-1/07-compliance.md) | done | 06 |
| 08 | [Billing: Stripe Connect, invoices, autopay, sales tax](phase-1/08-billing.md) | done | 04, 06 |
| 09 | [General ledger: chart of accounts, posting, deferred revenue](phase-1/09-ledger.md) | done | 08 |
| 10 | [Spreadsheet import](phase-1/10-import.md) | done | 02, 04, 08, 09 |
| 11 | Customer messaging: email and SMS | not written | 01, 02 |
| 12 | Reporting and owner dashboard | not written | 04, 08, 09 |
| 13 | Platform operations | not written | 01 |
| 14 | Commercial programs: devices, maps, trends, audits | not written | 04, 06 |
| 15 | Specialty services: termite, wildlife, bed bug | not written | 04, 06 |
| 16 | Customer portal and online booking | not written | 02, 08 |
| 17 | Sales and growth: door-to-door, commissions, campaigns | not written | 02, 04, 11 |
| 18 | Inventory, job costing, time and payroll export | not written | 06, 09 |
| 19 | Routing and fleet: route optimization, GPS | not written | 05 |
| 20 | Integrations and API: QuickBooks sync, webhooks, phone systems | not written | 01, 09 |
| 21 | AI features | not written | 06, 12 |

Launch gate: a design partner runs its daily operations on the platform for 30 consecutive business days (see the PRD's success metrics).

## How to work a spec

1. `/write-spec specs/phase-1/NN-name.md` in a fresh session. Answer the interview; Claude writes the spec.
2. Review and edit the spec yourself. Set its status to `ready`.
3. `/clear`, then `/implement-spec specs/phase-1/NN-name.md`.
4. The implementing session ends by running the spec's verification step and a `spec-reviewer` subagent check.
