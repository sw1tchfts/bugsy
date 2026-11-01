# Spec 12: Reporting and owner dashboard

Status: done
Depends on: 02, 04, 05, 06, 08, 09, 11
Skills to load: pest-domain, pest-accounting

## Goal
The owner opens Bugsy and sees whether the business is healthy: how many customers are on a plan, how many left last month and why, what was earned and what is owed, how dense the routes are, how often technicians go back for free. Each number opens a standard report with the detail and a CSV. Retention is measured the way the industry measures it (pest-domain skill: attrition is cancelled agreements as a share of active ones; 80% a year is strong, under 2% a month top quartile), by service line, technician and cancellation reason. Anyone with the reports permission can build and save a custom report over the company's data, and the whole company's data downloads as CSVs for a BI tool or an accountant.

## Users and stories
- As the owner, I see the dashboard: active agreements, last month's attrition with the year's trend, twelve-month retention, revenue earned this month, open and past-due receivables, the contract position, completed visits and the re-service rate, stops per technician day, lead close rate by source, renewals coming up, open compliance tasks and texts waiting.
- As the owner, I open the retention report and see attrition by month, cancellations by reason, service line and technician, and how each signing month's cohort has held up.
- As a service manager, I see each technician's stops, working days, stops per day, revenue serviced, time on site, re-service rate and product cost for a range.
- As the bookkeeper, I see revenue by service line by month from the ledger and receivables aging, each with a CSV.
- As a sales manager, I see leads, wins, losses and close rate by source.
- As anyone with reports, I build a report (a dataset, columns, filters, grouping and totals), save it, share it with the company, and download it.
- As the owner, I download every dataset I can read as CSVs in one file.

## Scope
### In scope
- Dashboard at `/reports` with tiles that link to their reports; tiles a member cannot read are not shown.
- Standard reports, each with a date range and a CSV: retention and churn, technician productivity, revenue by service line (ledger), receivables aging, sales by source, re-services.
- Datasets for the builder and the export, defined in code: accounts, properties, agreements, visits, invoices, payments, leads, journal lines, messages. Each names its columns, their types and the permission it needs; queries run under the member's session, so row level security decides the rows.
- Saved reports: per company, private to the author or shared.
- Export: `/api/reports/export.zip` with one CSV per dataset the member can read, every row the member can see, and a README describing the columns.
### Out of scope
- Forecasting and budgets; scheduled report emails (a later spec may add them over messaging).
- Payroll and commissions reports (specs 17 and 18).
- Route mileage and drive time (spec 19).

## Data
Migration `supabase/migrations/20261101170000_reporting.sql`.
- `saved_reports`: tenant_id, name, dataset, definition jsonb (columns, filters, group_by, aggregates, sort, limit), shared boolean, created_by, created_at, updated_at. Readable by the author and, when shared, by every reports.read member; written by the author; owners may delete any report they can see (their own and the shared ones).
- No snapshots: every metric is derived from the operational tables and the ledger as of its dates.

## Interfaces
- `lib/reports/metrics.ts` (pure): `activeOn(agreement, day)`, `lastActiveDay(agreement, today)`, `attrition(agreements, month, today)`, `retention(agreements, from, to)`, `cohorts(agreements, fromMonth, toMonth, depth, today)`, `rate`, month helpers. Stops per day is worked out in the technician query.
- `lib/reports/datasets.ts`: the datasets; `lib/reports/builder.ts` (pure): `checkDefinition(definition, dataset)` and `buildQuery(definition, dataset, tenantId, rowLimit)` to SQL text and parameters from whitelisted identifiers only; `lib/reports/form.ts` (pure) reads and writes a definition as form fields.
- `lib/reports/db.ts`: `dashboard`, `retentionReport`, `technicianReport`, `revenueByLine`, `arAging`, `salesBySource`, `reserviceReport`, `runSaved`, `runDefinition`, `exportDatasets`.
- Routes: `app/(office)/reports/page.tsx` (dashboard), `reports/retention`, `reports/technicians`, `reports/revenue`, `reports/receivables`, `reports/sales`, `reports/reservices`, `reports/custom` (list and builder), `reports/custom/[reportId]`, `app/(office)/reports/actions.ts`, `app/api/reports/[report]/route.ts` (CSV of a standard report), `app/api/reports/custom/[reportId]/route.ts` (CSV), `app/api/reports/export.zip/route.ts`. Office nav gains Reports for reports.read.

## Business rules
1. An agreement is active on a day when it was signed on or before that day, it is not a draft, it was not cancelled on or before that day, and its term (renewals included) had not ended before that day.
2. Attrition for a month is the agreements lost in the month (cancelled, or ended without renewal) divided by those active on its first day, where a loss belongs to the month of the agreement's last active day (the day before a cancellation takes effect, or the term's last day), so a plan ending on the 31st or cancelled from the 1st counts in the month it was last active; retention over a range is the share of agreements active at its start still active at its end (pest-domain skill).
3. A cohort is the agreements signed in a month; its retention at month N is the share still active on the first day after the Nth month following its signing month ends (month 0 is the day after the signing month ends), so a plan that stops at a month's end is lost in that month, as rule 2 counts it.
4. Cancellations are attributed to the reason recorded at cancellation, the agreement's service line, and the lead technician of the agreement's last completed visit (or "no visit yet").
5. Technician productivity counts completed visits where the technician was the lead: working days are the distinct days with a completed visit, stops per day is completed visits over working days, revenue serviced is the sum of those visits' prices, time on site is the mean of departure minus arrival, product cost is the ledger's chemical cost posted for those visits net of reversals (shown only to members who can read the ledger), and the re-service rate is the share of the technician's completed visits that were not themselves re-services after which a re-service was booked on the same agreement within 30 days.
6. Revenue by service line is the ledger's revenue accounts by month (credits minus debits), so it matches the income statement (spec 09 rule 16).
7. Receivables aging buckets invoices open on the report's date by days past due on that date: current, 1 to 30, 31 to 60, 61 to 90, over 90. An invoice's balance on a date is its total less the payments applied to it that were received by then; an invoice voided by then is not open.
8. Close rate by source is won leads over won plus lost leads created in the range; open leads are counted but not in the rate.
9. A custom report reads only a defined dataset, its declared columns and operators; nothing a user types becomes SQL text. Results are limited to 5,000 rows on screen; the CSV has them all up to 100,000.
10. Every report and export runs under the member's session: a member sees only rows their permissions show, and datasets needing a permission they lack are not offered.
11. Saved reports are private unless shared; a shared report is read-only to everyone but its author and owners.

## Edge cases
- A month with no agreements active on its first day: attrition is shown as no data, not zero.
- An agreement signed and cancelled in the same month: it counts in neither the denominator nor the losses of that month's attrition, and in its cohort as lost at month 0.
- A renewed agreement keeps one row; its ends_on is the latest term's end, so renewal is not churn.
- An imported agreement (spec 10) counts from its signing as imported; its visits done before Bugsy count for nobody's productivity. One imported as already ended (its term over before it was signed in Bugsy) was never active here: it is nobody's loss and in no cohort.
- A cancellation dated after the term had already run out (a plan on hold past its end) is lost on the term's last day.
- A technician with completed visits but no arrival or departure times: time on site averages only visits with both.

## Decisions
- Metrics are computed on demand from the source tables; at this size (hundreds to thousands of agreements per company) a query is fast, and there is no snapshot to drift.
- Ended-without-renewal counts as a loss alongside cancellation: both mean a customer stopped paying for a plan.
- The builder is a fixed grammar over declared datasets, not SQL, so tenant isolation and permissions stay in row level security.

## Open questions
- Whether attrition should be measured by account (logo) as well as by agreement: agreement-level ships; account-level is a follow-up, not blocking.

## Verification
1. `npm test`: `tests/unit/report-metrics.test.ts` (active-on boundaries, attrition and retention with signings, cancellations, endings and renewals, cohorts, empty months), `tests/unit/report-builder.test.ts` (definitions refused for unknown columns, operators and aggregates; the SQL text contains only whitelisted identifiers and placeholders).
2. `npm run test:rls`: saved_reports discovered with a seeded Lakeshore row; a private report is invisible to another member; a report run as the office returns no journal lines; nothing from another company.
3. `npm run typecheck && npm run lint && npm test && npx next build` pass.
4. `npm run test:e2e` runs `tests/e2e/reports.spec.ts`: the owner opens the dashboard and each tile's report; cancels a test agreement with a reason and sees it in the retention report's reasons; the technicians report lists Sam Rivera with stops; the revenue report's total for a month equals the income statement's revenue for that month; a custom report of completed visits grouped by technician is built, saved, shared and downloaded; the dispatcher sees the shared report and no revenue tile; the export zip holds the datasets' CSVs; the other company sees none of it. Screenshots go to `test-results/`.
