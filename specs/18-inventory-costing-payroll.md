# Spec 18: Inventory, job costing, time and payroll export

Status: done
Depends on: 05, 06, 09 (and reads 03, 04, 17)
Skills to load: pest-accounting, pest-domain, pesticide-compliance

## Goal
The company knows what it has, what each job cost and what it owes its people. Product sits in branch warehouses and on trucks; receipts, transfers and counts move it, and every application recorded at a stop takes it off the technician's truck, so the books' chemical inventory and the shelves agree. Each completed visit shows its margin: the price, the product used and the labor on site. Technicians clock in and out on the phone, offline like the rest of the app; the bookkeeper exports a pay period with hours, production pay and commissions for the payroll provider and posts the payroll back to the ledger. Bugsy does not run payroll.

## Users and stories
- As a dispatcher or licensed manager, I receive product into a warehouse or straight onto a truck with its cost and the supplier's reference, move it between locations, and count a shelf or a truck so the system matches what is there.
- As a technician, I see what is on my truck and what is running low, even offline, and what I apply at a stop comes off my truck by itself.
- As a technician or office worker, I clock in and out (on the phone, offline, or on the office Time page) and see my hours.
- As the office, I see who is clocked in, close a forgotten clock-out with a reason, and fix a wrong entry before the period is exported.
- As the owner, I see each visit's margin and the margin by account, technician, route day and service line.
- As the bookkeeper, I set each person's pay (hourly, production with a draw, or salary) and the pay period, export a closed period for the payroll provider (hours, production pay, draws, commissions), and post the payroll register's totals back as one journal entry.

## Scope
### In scope
- Stock locations (a warehouse per branch, a truck per technician), receipts, transfers, counts (adjustments), usage from visit records, stock levels and low-stock flags, the movement log.
- Moving average cost per product, receipts and count differences posted to the ledger; usage keeps posting through spec 09 at that cost.
- Time clock in the technician app (queued offline) and on the office Time page; office corrections with a reason; forgotten clock-outs flagged.
- Job costing per completed visit and grouped, with CSV.
- Pay settings, pay rates, pay periods, the payroll export (CSV) and the payroll journal; payroll-paid commissions (spec 17) leave commissions payable through that journal.
### Out of scope
- Gross-to-net payroll, tax filing, direct deposit, overtime and minimum wage math: the payroll provider does these (PRD: payroll processing is out of scope).
- Purchase orders and supplier bills: a receipt records the cost and whether it was paid now or is owed; bills and payables aging belong to the bookkeeping system (spec 20 for QuickBooks).
- Vehicle and equipment tracking, GPS: spec 19.

## Data
Migration `supabase/migrations/20261101240000_inventory_payroll.sql`. Every new table has tenant_id, row level security and the write guard.
- `inventory_settings` (one per tenant): tracking_since, the first day whose completed stops take product off the shelves (set when the first location is made).
- `stock_locations`: branch_id, kind (`warehouse`, `truck`), name, user_id (the truck's technician), active. At most one active truck per person and one active warehouse per branch.
- `stock_movements`: product_id, kind (`receipt`, `transfer`, `usage`, `adjustment`), from_location_id, to_location_id, quantity numeric (> 0, in the tenant product's unit), unit, unit_cost_cents, value_cents, visit_product_id (usage, unique), vendor, reference, paid (`now`, `on_account`; receipts), note, occurred_at, created_by. Rows are never changed or deleted; a mistake is corrected by a new movement.
- `tenant_products` gain `truck_minimum` and `warehouse_minimum` (numeric, in the product's unit).
- `time_entries`: user_id, started_at, ended_at, source (`app`, `office`), note, edited_by, edited_at, edit_reason, pay_period_id. No two of a person's entries overlap; one open entry per person.
- `memberships` gain `payroll_id` (the person's id at the payroll provider), set through `app.set_payroll_id`.
- `pay_settings` (one per tenant): period (`weekly`, `biweekly`, `semimonthly`), anchor_on (a first day of a weekly or biweekly period).
- `pay_rates`: user_id, kind (`hourly`, `production`, `salary`), hourly_rate_cents, production_percent numeric, draw_cents (per period), salary_cents (per period), labor_cost_cents_per_hour (job costing; defaults to the hourly rate), effective_from. Unique per person and day.
- `pay_periods`: starts_on, ends_on, status (`exported`, `posted`), exported_at, exported_by, gross_wages_cents, employer_taxes_cents, withholdings_cents, net_pay_cents, commissions_cents, posted_on. Unique per tenant and start.
- `pay_period_lines`: pay_period_id, user_id, payroll_id, name, kind, hours numeric, hours_by_week jsonb, hourly_rate_cents, production_revenue_cents, production_percent, production_pay_cents, draw_cents, salary_cents, pay_due_cents, commissions_cents: the export as sent.
- `commission_payouts` gain `pay_period_id`: commissions paid through payroll. Payroll (payroll.write) may mark payable commissions paid through the export, beside billing.
- Chart of accounts: `accounts_payable` (2050, liability). Ledger source types `stock_receipt`, `stock_adjustment`, `payroll`.
- Permissions: `inventory.read` (office, dispatcher, licensed manager, bookkeeper; a technician reads only their own truck), `inventory.write` (dispatcher, licensed manager), `payroll.read` and `payroll.write` (bookkeeper); the owner has all.

## Interfaces
- `lib/inventory/stock.ts` (pure): usage in the stock unit, moving average cost, stock levels from movements, low-stock flags, count differences. `lib/inventory/db.ts`: receipts, transfers, counts, usage for completed visits (in the sync and the ledger sweep), levels.
- `lib/payroll/periods.ts` (pure): pay period boundaries, hours inside a period and by workweek, crew splits, production pay and draws, the export rows and CSV, the payroll journal lines. `lib/payroll/db.ts`: clock in and out, corrections, the export, the journal.
- `lib/costing/jobs.ts` (pure): a visit's revenue, product and labor cost and margin, and grouping; `lib/costing/db.ts`: the report query.
- Technician app: change kind `clock` (`in` or `out` with its time; sent under the reserved visit id of all zeros), the route payload carries the truck's stock and the open clock entry; a clock bar and a Truck screen.
- Routes: office `app/(office)/inventory` (levels, receive, transfer, count, movements), `app/(office)/time`, `app/(office)/payroll` (settings, rates, periods, export CSV at `app/api/payroll/[periodId]/export.csv`, journal), `app/(office)/reports/job-costing` (with CSV).
- Ledger: receipt debits chemical inventory and credits the bank (paid now) or accounts payable (on account); a count's difference moves chemical inventory against chemical cost; the payroll journal debits technician labor (gross wages less payroll-paid commissions, plus employer taxes) and commissions payable (payroll-paid commissions), and credits payroll liabilities (withholdings plus employer taxes) and the bank (net pay).

## Business rules
1. Every movement is in the tenant product's unit; usage recorded in another unit is converted with the label units (spec 03), and usage whose unit does not convert is not deducted and is listed for the office, like unpriced usage in the ledger.
2. A receipt sets the product's cost to the moving average across the company: (on hand times current cost plus received times receipt cost) divided by the new on hand, half up to the cent; with nothing on hand the receipt's cost is the cost. Usage and counts are valued at the cost at that moment. (pest-accounting: product used posts chemical cost from inventory at cost.)
3. A completed visit's applications come off the lead technician's active truck, or the visit's own branch warehouse when they have none (never another branch's), once per application record line, with the quantity worked out by the database from the record; stock may go negative (the application record is the legal fact, inventory follows) and a negative level is flagged.
4. A count records what is there; the difference is one adjustment movement and one ledger entry at the current cost. Transfers move stock without a ledger entry.
5. Movements are never edited or deleted; a wrong receipt is reversed by a count or a transfer, with a note.
6. A person has at most one open time entry; entries never overlap; a clock-out is after its clock-in; a person only clocks in and out (a finished entry is payroll's to add, with a reason); a device clock ahead of the server never produces a time after receipt. An entry open more than 16 hours is flagged for the office.
7. The office (payroll.write) corrects an entry only with a reason; the original stays in the audit log. Time inside an exported period cannot be added, changed or closed, from the phone or the office; a refused clock change from a phone is listed on the Time page.
8. A visit's job cost: revenue is its price when completed (re-services earn nothing); product cost is the value of its usage; labor is its on-site time (arrival to departure, the legal application times) for each crew member at that person's labor cost per hour on the visit's day. Margin is revenue less product and labor; a person without a rate, or a reader without payroll.read (labor cost is pay), sees labor as not priced, not as zero; product with no cost is listed as not priced.
9. Pay periods follow the company's setting: weekly and biweekly from the anchor date, semimonthly the 1st to the 15th and the 16th to the month's end. A period can be exported once its last day has passed in the company's time zone; only a period the setting makes is exported, and never one that overlaps a period already exported (a changed setting cannot pay days twice).
10. Hours in a period are the time entries' overlap with the period, in the company's time zone, totaled and by workweek (the workweek starts on the anchor's weekday). Bugsy reports hours for every pay kind and does not compute overtime.
11. Production revenue is the price of each completed visit in the period (by its completion day) split equally among the people who did it (the lead and crew), down to the cent with the remainder to the lead; production pay is revenue times the percent, half up; pay due is the larger of production pay and the draw. Hourly pay due is hours times the rate, half up; salary is the period amount. The rate used is the one in effect on the period's last day.
12. Exporting a period needs every entry that started in it to be closed; it covers everyone with time, pay or commissions in the company, including people who have since left; it snapshots its lines, locks its time entries, and pays the commissions payable on its last day through payroll (one payout per person, linked to the period, posted by the payroll journal, not separately). A period exports once; a correction goes in the next one.
13. The payroll journal posts once per period from the register's totals and must balance: gross wages equal net pay plus withholdings, and payroll-paid commissions are the export's commissions.

## Edge cases
- A product with no tenant cost yet: its first receipt sets the cost; usage before any cost is recorded is deducted and valued at zero, and listed as unpriced (spec 09).
- A technician with two trucks over time: only one is active; past movements keep the old truck.
- A clock-out queued offline that syncs after its period was exported is refused, and the office sees it in the rejected list.
- A visit with arrival but no departure (not completed) has no job cost yet.
- Production revenue on a visit that is later voided or credited stays in the period it was paid in; the next period does not claw it back (a credit memo is the office's call).
- A person with time but no pay rate still exports with their hours and an empty rate, so the payroll provider sees them.

## Decisions
- Moving average cost, company-wide: the ledger has one chemical inventory account and the posting fixtures value usage at one unit cost.
- Labor is not posted per visit; the payroll journal carries actual labor, and job costing is a management view, so labor is never counted twice.
- Overtime, minimum wage and taxes are the payroll provider's: labor law varies by state and Bugsy is not a payroll system.
- Commissions paid through payroll leave commissions payable in the payroll journal; spec 17's direct payouts stay for commissions paid outside payroll.
- A rate change takes effect for whole periods (the rate on the period's last day), which keeps the export one line per person.

## Open questions
- Recoverable draws (a production shortfall carried to the next period): not built; the draw is a floor for the period.

## Verification
1. `npm test`: `tests/unit/inventory.test.ts` (usage in stock units, moving average, levels, count differences, low stock), `tests/unit/payroll.test.ts` (period boundaries for each setting, hours by period and workweek across midnight and period ends, crew splits, production pay and draws, the export CSV, journal lines that balance), `tests/unit/costing.test.ts` (a visit's margin, re-service, unpriced labor, grouping).
2. `npm run test:rls`: the new tables discovered with seeded rows and guarded; a technician sees their own truck's stock and movements, their own time and pay lines, and no one else's; the office sees no pay rates or pay periods; movements cannot be changed; time entries in an exported period cannot change; another company sees nothing.
3. `npm run typecheck && npm run lint && npm test && npx next build` pass.
4. `npm run test:e2e` runs `tests/e2e/inventory-payroll.spec.ts`: the dispatcher receives a product into the warehouse (its cost averages) and moves some to a technician's truck; the technician clocks in on the app while offline, comes back online, completes a stop with that product and sees the truck's stock drop; the owner sees the visit's margin in job costing; the bookkeeper sets pay rates, exports last week's period (the CSV carries hours, production pay and commissions) and posts the payroll journal, and the ledger shows technician labor and payroll liabilities; another company sees none of it. Screenshots go to `test-results/`.
