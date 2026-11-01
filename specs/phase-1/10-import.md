# Spec 10: Spreadsheet import

Status: done
Depends on: 02, 04, 08, 09
Skills to load: pest-domain, pest-accounting

## Goal
A company moving to Bugsy loads its customers, service addresses, contacts, active agreements and what customers owe from spreadsheets on its go-live day, sees every problem row by row before anything is written, and starts dispatching the next morning. Agreements that are mid-term come across with the visits already done and the money already billed, so Bugsy neither re-bills last month nor sends a technician for a visit the old system already did, and the books open with each agreement's real contract balance and each account's real receivable. Records kept before Bugsy are uploaded and kept as files for the retention period.

## Users and stories
- As the owner going live, I download the five CSV templates, fill them from my old system's exports, and upload them with the go-live date.
- As the owner, I run a dry run and see, per file, how many rows would be created or skipped and every row error with its row number and column, with nothing written.
- As the owner, I import the same files and get exactly what the dry run showed, or nothing at all if a row fails.
- As the owner, I re-upload a corrected file and rows imported before are skipped by their old-system id rather than duplicated.
- As the bookkeeper, I find one opening entry per agreement for its contract balance and one opening invoice per account for what it owed, against opening balance equity.
- As the dispatcher, I see the next visit each imported agreement owes, not the ones done before go-live.
- As the licensed manager, I upload the old system's application records and find them kept with the import, with the state's retention period beside them.

## Scope
### In scope
- Templates, published by Bugsy: `accounts.csv`, `properties.csv`, `contacts.csv`, `agreements.csv`, `balances.csv`, each with a header row; extra columns are ignored, missing required columns fail the file.
- Old-system ids (`external_id`) on accounts, properties, contacts and agreements; rows reference each other by them, within the batch or from an earlier batch.
- A batch: the files, the go-live date (cutover), a dry run or a commit, a stored report. All or nothing per commit.
- Mid-term agreements: imported as active and signed by import; visits planned from the start date; visits due on or before the last service date before cutover marked done before Bugsy; installments and prepay terms dated before cutover left to the old system; the opening contract position posted from billed-to-date and what those visits delivered.
- Opening receivables: one opening invoice per balances row, against opening balance equity, with the old invoice reference, due date, and no Bugsy late fee.
- History files: any files the old system produced (application records, service history, contracts) uploaded with the batch and kept.
- A permission `data.import` (owners have it through `*`).
### Out of scope
- Importers for specific pest software (GorillaDesk, PestPac, FieldRoutes exports): later, as mappings onto these templates.
- Updating existing rows from a spreadsheet: import creates; edits happen in the app.
- Converting old application records into Bugsy's structured records: they stay files (a structured record is a legal record Bugsy captured at the stop).
- Importing payment methods: card and bank details move gateway to gateway, never through a spreadsheet.
- Leads, quotes, products, price books, users.

## Data
Migration `supabase/migrations/20261101150000_import.sql`.
- `accounts.external_id`, `properties.external_id`, `contacts.external_id`, `agreements.external_id`: text null, unique per tenant when set.
- `agreements.cutover_on` date null (the go-live date for an imported agreement), `agreements.imported_billed_cents` bigint null (billed by the old system before cutover), `agreements.import_batch_id` uuid null.
- `visits.imported` boolean not null default false: a visit done before Bugsy. Status completed, no times, no record, no invoice, no revenue posting.
- `invoices.source` gains `opening`; `invoice_lines.kind` gains `opening`; `invoices.external_ref` text null (the old invoice number).
- `import_batches`: tenant_id, status [dry_run, committed, failed], cutover_on, summary jsonb (per file: rows, created, skipped, errors), errors jsonb (first 500: file, row, column, message), warnings jsonb, created_by, created_at.
- `import_files`: tenant_id, batch_id, file_id, kind [template, history], file_name, label; files gain kind `import` and a 20 MB limit for that kind.

## Interfaces
- `lib/import/templates.ts`: the five templates (columns, required flags, descriptions, an example row) and `templateCsv(kind)`.
- `lib/import/parse.ts` (pure): `readFile(kind, text)` to header-checked rows; coercers `date` (YYYY-MM-DD or M/D/YYYY), `money` ($1,234.56, 1234.5, 1234), `bool` (yes/no/true/false/y/n/1/0), `int`, `months` (1;2;12 or Jan;Feb), `enum`, `email`, `state`.
- `lib/import/validate.ts` (pure): `validateAccount`, `validateProperty`, `validateContact`, `validateAgreement`, `validateBalance`: a typed value or field errors.
- `lib/import/cutover.ts` (pure): `doneBeforeCutover(planned, lastServiceOn, cutoverOn)`, `defaultBilledToDate(agreement, planned, cutoverOn)`, `openingPosition(billed, done)`.
- `lib/import/db.ts`: `runImport(tx, tenantId, files, options)` imports in dependency order (accounts, properties, contacts, agreements, balances) and returns the report; `importDryRun` runs it in a transaction it rolls back; `importCommit` keeps it only when the report has no errors.
- Hooks: `lib/billing/db.ts` skips installments and prepay terms dated before an agreement's cutover, never invoices an imported visit, and leaves opening invoices out of late fees; `lib/agreements/db.ts` `settlementFor` counts the old system's billing for an imported agreement; `lib/ledger/post.ts` posts an opening line to opening balance equity; `lib/ledger/db.ts` and `lib/compliance/db.ts` skip imported visits.
- Routes: `app/(office)/settings/import/page.tsx` (templates, upload form, batches), `app/(office)/settings/import/[batchId]/page.tsx` (report, errors, warnings, files), `app/(office)/settings/import/actions.ts` (`runImportAction` with `mode` dry_run or commit), `app/api/import/templates/[kind]/route.ts`. Settings nav gains Import for `data.import`. Server actions accept up to 25 MB bodies.

## Business rules
1. Each file's header row must contain every required column of its template; column names match case-insensitively with spaces or underscores. A file with a missing required column fails whole, with the column named.
2. Required fields are the minimum to schedule and bill (PRD decision). Accounts: external_id, name. Properties: external_id, account_external_id, line1, city, state, postal_code, property_type. Contacts: account_external_id or property_external_id, name, role. Agreements: external_id, account_external_id, property_external_id, service_type, cadence, billing_mode, starts_on, initial_price, recurring_price. Balances: account_external_id, amount, as_of. Every other column is optional with the app's defaults.
3. Values are checked as the app's forms check them: account and contact types, property types, two-letter states, emails, cadences and billing modes, plan issues from `planIssues`, a service type that exists in the catalog by name, money in dollars and cents, dates. Each failure is a row error naming the file, row number (the spreadsheet's, header is row 1), column and problem.
4. A reference to an external id resolves to a row in the same batch or an earlier one; a reference to nothing is a row error. A property belongs to the account it names; an agreement's property belongs to its account.
5. A row whose external id already exists in the company is skipped and counted as skipped, never updated or duplicated; a duplicate external id within one file is a row error.
6. A dry run does everything a commit does inside one transaction and rolls it back; its report is stored. A commit writes everything or, if any row has an error, nothing, and stores the report either way.
7. The cutover date is required and is the first day Bugsy runs the company. An agreement's last_service_on, when given, is before the cutover; every planned visit due on or before it is marked done before Bugsy (status completed, imported). Visits due before the cutover and after the last service stay planned and show as overdue.
8. Billing for an imported agreement starts at the cutover: installments dated before it and prepay terms that started before it are not issued (the old system billed them); per-visit agreements bill only visits completed in Bugsy.
9. billed_to_date, when blank, is what the agreement's own schedule billed before the cutover (installments dated before it, prepay terms started before it, or for per-visit plans what was delivered); when given and different, the row carries a warning, not an error.
10. The opening contract position of an imported agreement is billed_to_date minus the prices of its visits done before Bugsy, posted once on the cutover date to contract liability with the agreement against opening balance equity (spec 09 rule 13). The cancellation settlement counts the old system's billing the same way.
11. A balances row becomes an issued opening invoice for the amount, issued on as_of, due on due_on (default as_of), with the old invoice reference, no tax, and a line posted to accounts receivable against opening balance equity. Opening invoices flag an account past due like any invoice but never draw a Bugsy late fee. A negative amount (a credit the customer had) becomes an opening credit memo.
12. Imported visits never get an application record, a notice, an invoice or a revenue posting; their history lives in the uploaded files (rule 13).
13. History files of any type up to 20 MB each are kept with the batch and never deleted by Bugsy; the batch page shows each property state's retention period from its rule pack, or says there is no rule pack yet.
14. Importing needs `data.import` and, for each file present, the permission its rows need (customers.write for accounts, properties and contacts, agreements.write for agreements, billing.write and gl.write for balances and opening positions). Row level security applies to every write; another company's ids are never visible.

## Edge cases
- A property row for an account in a later file of the same batch: files run in dependency order, not upload order, so it resolves.
- An agreement whose term already ended before the cutover: imported as ended, no visits planned after its end, no opening position if it was settled (billed equals delivered).
- An agreement with auto renew whose term ends after the cutover: renews as any agreement does.
- A seasonal program: last_service_on in the off-season leaves no overdue visits.
- Two balances rows for one account: two opening invoices, each with its reference.
- A commit after a dry run with the same files reports the same counts; a second commit of the same files skips every row.
- A cutover in a closed ledger period: opening entries move to the first open day (spec 09 rule 9), with the original date in the memo.

## Decisions
- One CSV per kind with old-system ids as keys, rather than one wide sheet: a property manager has many properties and an account many contacts.
- All or nothing per commit, with the dry run being the same code in a rolled-back transaction, so the preview cannot drift from the import.
- Import creates and never updates: corrections after go-live happen in the app, where duplicates are checked and audited.
- Visits done before Bugsy are marked completed and imported rather than skipped, so the agreement's plan and installment amounts stay whole and the cancellation settlement counts them as delivered.
- Delivered-to-date is derived from the visits done, never typed, so the opening position and the settlement can never disagree; billed-to-date may be typed because old billing may have differed.
- Opening receivables are invoices, not bare journal entries, so collections, statements and autopay see them.
- Old application records stay files: Bugsy's records are what its technicians captured.

## Open questions
- Which old systems get a mapping first (GorillaDesk and PestPac exports are the likely pair): not blocking.
- Whether opening balances should carry the old invoice's original issue date for aging rather than as_of: as_of is used for both today; not blocking.

## Verification
1. `npm test`: `tests/unit/import-parse.test.ts` (headers, coercers, CSV quirks: BOM, quoted commas, blank lines), `tests/unit/import-validate.test.ts` (each template's required fields and value checks), `tests/unit/import-cutover.test.ts` loads `fixtures/import/expected.json` and checks, for each agreement in `fixtures/import/agreements.csv`, the visits done before cutover, the default billed-to-date and the opening position against the planned visits.
2. `npm run test:rls`: the new table discovered with seeded Lakeshore rows; a member without data.import cannot write batches; another company's external ids are invisible.
3. `npm run typecheck && npm run lint && npm test && npx next build` pass.
4. `npm run test:e2e` runs `tests/e2e/import.spec.ts` with `fixtures/import/*.csv` (ids made unique per run): as the Northwind owner, download a template; upload the five files with a broken copy of the properties file and see the row errors with nothing written; dry run the good files and see the counts from expected.json; commit and see the accounts, the mid-term agreement with its done visits and next due visit, the opening invoice on the account's statement, and the opening entries in the journal; commit again and see every row skipped; upload a history file and find it on the batch page. Screenshots go to `test-results/`.
