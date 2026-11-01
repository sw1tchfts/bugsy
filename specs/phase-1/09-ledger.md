# Spec 09: General ledger: chart of accounts, posting, deferred revenue

Status: done
Depends on: 08
Skills to load: pest-accounting, pest-domain

## Goal
Every financial event the platform already knows about (an invoice issued, a stop completed, product used, money received or refunded, a gateway payout) posts a balanced journal entry the moment it happens, without a bookkeeper typing it. Revenue is earned as visits are performed, and each agreement carries one contract balance (billed minus recognized) that reads as deferred revenue or an unbilled receivable at period end, exactly as `fixtures/accounting/agreement-ledger.json` says. The books are accrual with a cash-basis view, periods close monthly and only an owner reopens one. The bookkeeper gets a trial balance, income statement, balance sheet, deferred revenue roll-forward and an account ledger to drill into, with CSV exports, so month end takes an hour instead of a weekend of re-keying into a spreadsheet.

## Users and stories
- As the bookkeeper, I see a journal entry for every invoice, payment, refund, completed stop and product used without posting any of them, so the books are complete by construction.
- As the bookkeeper, I run a trial balance that balances to the cent for any period range, an income statement (accrual, or the cash-basis view), a balance sheet as of a period end, and a deferred revenue roll-forward per agreement, and export each as CSV.
- As the bookkeeper, I post a manual entry with memo and lines, reverse any entry with one click, and close the month once the period-end reclass has posted.
- As the owner, I reopen a closed period with a reason and the audit log records it; nobody else can.
- As office staff, I never see the ledger: my invoices and payments post on their own.
- As the bookkeeper taking over a mid-term customer, I record the agreement's billed-to-date and delivered-to-date as of go-live so month one of the ledger is right (spreadsheet import of the same in spec 10).

## Scope
### In scope
- Chart of accounts per tenant seeded from the pest template (the keys the pest-accounting skill lists, plus `revenue_other`, `late_fee_income`, `opening_balance_equity`, `retained_earnings`); numbers, names and active flags editable; template accounts cannot be removed; custom accounts can be added.
- Posting engine: pure rules in `lib/ledger/post.ts` that turn a business event into balanced lines, and `lib/ledger/db.ts` that writes entries idempotently by source key, inline in the same transaction as the event (invoice issue, credit memo, void, visit completion, product use, payment, refund, payout) and from an idempotent sweep in the billing job that catches anything missed.
- Contract balance per agreement on the `contract_liability` subledger (agreement_id on the line); sales tax payable by jurisdiction; period-end reclass of debit balances to `contract_asset` and its reversal on day one of the next period.
- Periods are calendar months in the tenant's time zone. Close, reopen (owner, with reason, audited), closed periods reject postings, late events post on the first open day.
- Opening contract positions per agreement (billed-to-date and delivered-to-date as of a date) posted against opening balance equity.
- Manual journal entries and reversals (entries are never edited or deleted).
- Reports: general journal, account ledger, trial balance, income statement (accrual and cash-basis view), balance sheet, deferred revenue roll-forward; CSV for each.
- Gateway payouts: Stripe `payout.paid` events post net to the bank and fees to processing fees; the local gateway synthesizes a daily payout for testing.
- Seed: every seeded billing event posted, one closed period per company so the isolation suite has rows.
### Out of scope
- Payroll, technician labor cost and commissions postings (specs 17 and 18 post to the accounts this spec creates).
- Chemical inventory purchases and counts (spec 18); this spec only relieves inventory at the cost on the tenant product.
- QuickBooks sync (spec 20): the journal CSV is the export until then.
- Bank reconciliation and bank feeds.
- Fiscal years that are not calendar years, multi-currency, consolidation across tenants.
- Warranty renewals recognized over a term (spec 15 adds termite warranties and their straight-line release).

## Data
Reference `docs/data-model.md`, general ledger section. Migration `supabase/migrations/20261101140000_ledger.sql`. All tenant tables carry `tenant_id`, RLS and `app.is_member` policies.

- `gl_accounts`: tenant_id, key text null (template key, unique per tenant when set), number text (unique per tenant), name, type [asset, liability, equity, revenue, expense], subtype [bank, clearing, receivable, contract_asset, inventory, fixed_asset, contract_liability, tax_payable, payable, service_revenue, other_income, cost_of_service, operating_expense, equity], active boolean, system boolean (true for template accounts: never deleted and never deactivated, since the postings use them; their number and name are editable). Seeded by `ensureChart` the first time a tenant posts.
- `journal_entries`: tenant_id, number (per tenant from `app.next_number(tenant, 'journal')`), posted_on date, period text ('YYYY-MM' of posted_on, kept by trigger), source_type [invoice, credit_memo, void, visit, product_use, payment, refund, payout, reclass, reclass_reversal, opening, manual, reversal], source_id uuid null, source_key text unique per tenant (idempotency), memo, reverses uuid null (the entry this one reverses), reversed_by uuid null, posted_by uuid null, created_at. Immutable: the only update allowed is setting reversed_by; delete refused. Insert refused when the period is closed.
- `journal_lines`: tenant_id, entry_id, position, gl_account_id, debit_cents bigint >= 0, credit_cents bigint >= 0 (exactly one of them positive), agreement_id null (the contract subledger), jurisdiction text null (`kind:name` from the invoice line's tax breakdown, the sales tax subledger), memo. A deferred constraint trigger refuses an entry whose debits and credits differ at commit, and an entry with no lines.
- `period_closes`: tenant_id, period text, status [closed, reopened], closed_at, closed_by, reopened_at null, reopened_by null, reopen_reason null; unique (tenant_id, period). A period is closed while a row with status closed exists. Audited by `app.write_audit`.
- `payouts`: tenant_id, gateway, gateway_payout_id (unique per gateway), arrived_on date, gross_cents, fee_cents, net_cents, status [paid, failed], payload jsonb; `payments.payout_id` uuid null references it. The payout entry's source is this row.
- Deviation from the data model: the sales tax subledger is a `jurisdiction` text key rather than `jurisdiction_id`, because tax rate rows carry effective dates and change while the jurisdiction they describe does not; the invoice line's breakdown already names the jurisdiction.

## Interfaces
- `lib/ledger/chart.ts`: the template (key, number, name, type, subtype), `revenueAccountFor(service_line | null)` (`revenue_<line>` or `revenue_other`).
- `lib/ledger/post.ts` (pure): `linesFor(event)` for each event in `fixtures/accounting/posting-rules.json` plus credit_memo, void, refund, opening and reclass_reversal; `productCostCents(quantity, usageUnit, unitCostCents, costUnit)` with the unit tables from `lib/catalog/label-rates.ts`, half-up to the cent, null when the units do not convert; `contractPositions(lines)` per agreement; `reclassLines(positions)`.
- `lib/ledger/periods.ts` (pure): `periodOf(date)`, `periodEnd(period)`, `nextPeriod(period)`, `firstOpenDay(date, closedPeriods)`.
- `lib/ledger/reports.ts` (pure): `trialBalance(lines, accounts, range)`, `incomeStatement(...)`, `balanceSheet(...)` (assets = liabilities + equity + net income to date), `rollForward(positions by agreement for the period)`; `lib/ledger/cash-basis.ts`: `cashBasisIncome(allocations, invoice lines, refunds, fees)`.
- `lib/ledger/db.ts`: `ensureChart`, `postEntry(tx, tenantId, {source_type, source_key, posted_on, memo, lines})` (idempotent; moves a closed-period date to the first open day and says so in the memo), `postInvoice`, `postCreditMemo`, `postVoid`, `postVisit`, `postProductUse`, `postPayment`, `postRefund`, `postPayout`, `postOpening`, `postReclass(period)`, `reverseEntry`, `closePeriod`, `reopenPeriod`, `sweep` (unposted invoices, visits, product uses, payments, refunds, payouts), `runLedger(tx, tenantId, timeZone, today)` (sweep, local payouts, reclass for every ended period that has none), report queries.
- Hooks: `lib/billing/db.ts` `issueInvoice` posts the invoice or credit memo; `voidInvoice` posts the reversal; `recordPayment` and `chargeInvoice` post the payment when it succeeds; `refundPayment` posts the refund; `runBilling` ends with `runLedger`. `app/api/payments/webhook/route.ts` posts the payment on `payment_intent.succeeded` and records and posts `payout.paid`. `lib/tech/sync-db.ts` posts the visit and each product use after the completion's invoice.
- Routes under `app/(office)/ledger/`: `page.tsx` (home: open period, last close, trial balance totals, unposted and unpriced items), `journal/page.tsx`, `journal/new/page.tsx`, `journal/[entryId]/page.tsx`, `accounts/page.tsx`, `accounts/[accountId]/page.tsx`, `periods/page.tsx`, `reports/trial-balance/page.tsx`, `reports/income/page.tsx`, `reports/balance-sheet/page.tsx`, `reports/contracts/page.tsx` (roll-forward and the opening position form), `actions.ts`. CSV: `app/api/ledger/journal.csv`, `trial-balance.csv`, `income.csv`, `balance-sheet.csv`, `contracts.csv`. Office nav gains "Ledger" for gl.read.
- `scripts/seed-ledger.ts`, called after the billing seed. `scripts/ledger-run.ts` is not needed: the billing job runs the ledger.
- Permissions: `gl.read` views everything here; `gl.write` posts manual entries, reverses, records opening positions, edits the chart and closes periods; reopening needs the owner role (`app.role_is_owner`).

## Business rules
1. Every journal entry balances to the cent and has at least one line; the database refuses anything else (pest-accounting, posting rules).
2. An issued invoice posts accounts receivable for the total, contract liability (with the agreement) for service lines on an agreement, the revenue account for the service line for lines with no agreement, late fee income for late fee invoices, cancellation fee income for cancellation fee lines, and sales tax payable per jurisdiction for the tax (posting-rules.json invoice_issued cases).
3. A completed visit with a price posts contract liability to the revenue account of its service line, with the agreement; a $0 visit (re-service) posts no revenue (posting-rules.json visit_completed cases).
4. Product used posts chemical cost against chemical inventory at quantity times the tenant product's unit cost, converted to the cost unit and rounded half up; usage whose unit does not convert posts nothing and is listed as unpriced on the ledger home (posting-rules.json product_used).
5. A succeeded payment posts Stripe clearing (card or bank account) or the operating bank (cash, check, other) against accounts receivable; a refund posts the reverse; a credit memo posts the reverse of an invoice; a void reverses the invoice's entry (posting-rules.json payment_received).
6. A payout posts the operating bank for the net, processing fees for the gateway and platform fees, and credits Stripe clearing for the gross (posting-rules.json stripe_payout).
7. The contract balance of an agreement is the sum of its contract liability lines: credits minus debits, positive is deferred revenue, negative is an unbilled receivable. At month end the position per agreement matches `expected_month_end` in agreement-ledger.json for scenarios A to D and `expected_at_cancellation` for E.
8. The period-end reclass posts, dated the last day of the period, contract asset against contract liability per agreement with a debit balance, and its reversal posts on day one of the next period (posting-rules.json period_end_reclass). Both are idempotent by period.
9. Periods are calendar months in the tenant's zone. A closed period refuses new entries. A business event (invoice, visit, product use, payment, refund, payout, reclass) dated in a closed period posts on the first open day with the original date in the memo, decided inside `app.post_entry` so it holds for callers who cannot read the period closes; a manual entry, reversal or opening position dated in a closed period is refused (pest-accounting: corrections post to the open period).
10. Closing a period requires the reclass for that period and all earlier periods closed; reopening needs the owner role and a reason, and the audit log keeps both. A reopened period can be closed again.
11. Entries are immutable: a correction is a reversal entry (mirrored lines, dated today or a later open day) linked both ways, never an edit or a delete. The period-end reclass and its reversal are adjusted by the job and are never reversed by hand. A deferred revenue line always names its agreement.
12. Posting is idempotent by source key; the billing job's sweep posts anything the inline hooks missed and never posts an event twice.
13. An opening position for an agreement posts the net of billed-to-date minus delivered-to-date to contract liability with the agreement against opening balance equity, as of the given date, once per agreement.
14. Revenue allocation is the visit's list price on the agreement (PRD decision for spec 09, to be confirmed by an accountant); no relative standalone selling price allocation.
15. The cash-basis view of the income statement counts revenue when money is allocated to an invoice (pro rata across its lines), refunds as negative, and fees when paid out; it is a report, not a second set of books.
16. Reports: the trial balance debits equal credits for any range; the balance sheet balances with net income to date as equity; the income statement and roll-forward agree with the journal they are read from.
17. Access: gl.read reads every ledger table; gl.write inserts entries and lines, closes periods, edits the chart; nobody updates or deletes entries and lines; period reopen needs the owner role; other tenants see nothing (rule 15 of spec 08 applied here).

## Edge cases
- An invoice with both agreement and non-agreement lines (a settlement invoice with a cancellation fee): each line posts to its own account; the fee never touches the contract balance (fixture E note).
- A credit memo at cancellation for prepaid, undelivered service drives the agreement's balance to zero; the refund that follows posts against receivables, not the contract.
- A visit completed in a closed period and synced later posts on the first open day; the roll-forward for the closed period does not change.
- A refund larger than the allocation leaves receivables with a debit balance for the customer: the statement from spec 08 shows the open invoice again; the ledger shows the same.
- Two payments for one invoice, a partial refund, a late fee on a past-due invoice: each is its own entry; the invoice has no entry of its own beyond issue.
- A tenant product with a zero unit cost posts nothing for product use (not an exception, just no cost yet).
- Reversing a reversal is allowed; reversing an already reversed entry is refused.
- A manual entry into contract liability must name an agreement, so the subledger stays reconcilable.
- The local gateway's synthetic payout fee is a test convention in `lib/payments/local.ts`, never used with Stripe.

## Decisions
- Posting happens inline in the business event's transaction, with the sweep as a safety net, so the journal is never behind the operations and the sweep is the test that nothing was missed.
- One contract liability account with an agreement subledger, reclassified at period end, rather than two accounts maintained live: the skill's rule, and what the fixtures measure.
- Template accounts added beyond the skill's list: `revenue_other` (one-off charges with no service line), `late_fee_income`, `opening_balance_equity`, `retained_earnings`. The skill's keys stay as they are so the fixtures bind.
- Periods are calendar months; who closes is gl.write; who reopens is the owner (PRD).
- The billing job runs the ledger work (sweep, payouts, reclass) rather than a third scheduled job, so CLAUDE.md's exception list stays at two jobs and the webhook.
- Cash-basis is a view computed from allocations, not a parallel ledger.
- Jurisdiction subledger as text key rather than a rate row id (see Data).

## Open questions
- Revenue allocation method: visit list price is the default; an accountant confirms before launch. Does not block implementation.
- Whether late fees should instead reduce bad debt expense when written off: spec 12 reporting decides; does not block.

## Verification
1. `npm test`: `tests/unit/posting.test.ts` loads `fixtures/accounting/posting-rules.json` and checks every case's lines and balance; `tests/unit/contract-balance.test.ts` loads `fixtures/accounting/agreement-ledger.json`, builds the entries from each scenario's billing and visits, and checks month-end billed, recognized, position, deferred revenue and contract asset for A to D, the cancellation position and settlement for E, and the reclass; `tests/unit/periods.test.ts` (period math, first open day); `tests/unit/ledger-reports.test.ts` (trial balance balances, balance sheet equation, income statement, cash-basis view, roll-forward).
2. `npm run test:rls`: the new tables are discovered with seeded Lakeshore rows; rule tests: an unbalanced entry is refused at commit; an entry in a closed period is refused; entries and lines cannot be updated or deleted; the office cannot post; the bookkeeper posts and closes; the bookkeeper cannot reopen and the owner can; a line naming another tenant's account is refused; the sweep posts nothing the second time.
3. `npm run typecheck && npm run lint && npm test && npx next build` pass.
4. `npm run test:e2e` runs `tests/e2e/ledger.spec.ts`: as the Northwind bookkeeper, open the ledger home and see the seed's entries in the journal (an invoice, a payment, a visit); issue a one-off invoice through billing as the office and find its entry; post a manual entry and reverse it; see the trial balance balance and download the CSV; see the contracts roll-forward with Maria's agreement position; close last month, see the reclass entry and its reversal; be refused when reopening; as the owner reopen with a reason and find it in the audit log; as the Lakeshore bookkeeper see none of Northwind's entries. Screenshots go to `test-results/`.
