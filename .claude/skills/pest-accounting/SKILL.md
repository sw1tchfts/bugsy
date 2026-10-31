---
name: pest-accounting
description: Accounting rules for the pest platform's billing and general ledger (per-visit revenue recognition, deferred revenue and unbilled receivables per agreement, installment rounding, posting rules, sales tax by service type and state, Stripe clearing). Use when building or changing invoices, payments, agreements' billing modes, cancellations, tax, journal entries or financial reports.
---

# Pest accounting rules

Expected numbers live in `fixtures/accounting/`, and each state's taxability in `fixtures/states/<state>/taxability.json`. Tests load them; never restate or edit them in code. These policies are reasonable defaults for a service subscription business; have an accountant confirm the revenue allocation method before launch.

## Revenue recognition

- Revenue is earned when a visit is completed. The amount is the visit's price on the agreement (initial or recurring). Re-services are $0 visits: no revenue, but their product and labor cost still post.
- Billing and recognition meet in one contract balance per agreement: cumulative billed minus cumulative recognized.
  - Positive balance: deferred revenue (contract liability).
  - Negative balance: unbilled receivable (contract asset).
- Post billing to `contract_liability` and recognition out of it, so the per-agreement subledger on that account is the contract balance. At period end, reclassify agreements with debit balances to `contract_asset` and reverse on day one of the next period.
- Termite and other warranty renewals are recognized evenly over the warranty term, not when billed.
- Fixture scenarios A to E in `fixtures/accounting/agreement-ledger.json` show why this matters: flat monthly billing with visits early in the quarter carries a contract asset all year, and a customer cancelling right after a visit leaves delivered but unbilled service.

## Billing modes

| Mode | Invoices | Contract balance |
| --- | --- | --- |
| per_visit | On visit completion | Always zero |
| flat_monthly | Contract total split into equal installments | Swings between deferred and asset |
| annual_prepay | Once at the start of the term | Deferred, released per visit |

Installments: total divided by the count, rounded down to the cent, remainder on the final installment.

## Cancellation

On cancellation: stop autopay, cancel future visits, then settle the contract balance. A contract asset is billed as a final invoice if the agreement terms allow; otherwise reverse it against revenue with a reason. A deferred balance is refunded per the terms. A cancellation fee is a separate line credited to `cancellation_fee_income`.

## Chart of accounts template (keys used by fixtures)

Assets: `operating_bank`, `stripe_clearing`, `accounts_receivable`, `contract_asset`, `chemical_inventory`, `vehicles`.
Liabilities: `contract_liability`, `sales_tax_payable` (subledger by jurisdiction), `commissions_payable`, `payroll_liabilities`.
Revenue: `revenue_general_pest`, `revenue_rodent`, `revenue_termite`, `revenue_mosquito`, `revenue_bed_bug`, `revenue_wildlife`, `cancellation_fee_income`.
Expenses: `chemical_cost`, `technician_labor`, `commissions_expense`, `processing_fees`, `licenses_and_permits`, `vehicle_expense`.

## Posting rules

| Event | Debit | Credit |
| --- | --- | --- |
| Invoice issued | accounts_receivable (total) | contract_liability (service amount), sales_tax_payable (tax) |
| Visit completed | contract_liability | revenue for the service line |
| Product used | chemical_cost | chemical_inventory |
| Payment received | stripe_clearing (or operating_bank for cash and check) | accounts_receivable |
| Stripe payout | operating_bank (net), processing_fees | stripe_clearing (gross) |
| Period-end reclass | contract_asset | contract_liability |

Every entry balances to the cent. Closed periods reject new postings; corrections post to the open period.

## Sales tax

- Taxability comes from the service type's tax class for the property's state, never from line descriptions. States differ: some tax pest control services, some do not, and some tax yard spraying as a landscaping service (Wisconsin, for example; see `pesticide-compliance/states/wi.md`). Confirm each launch state's answer before go-live and record it with its source; never guess. Keep the tax path working so a service type can become taxable without code changes.
- Rate is the state rate plus county and other local taxes where the service is received (the service address). Rates come from each state revenue department's tables with effective dates; never hardcode a rate.
- Invoices mixing taxable and nontaxable work show the portions separately and tax only the taxable part.
- Exemption certificates on the account (for example a government unit) zero the tax and are kept with the invoice.

## Money handling

Integer cents everywhere. Tax is computed per taxable line and rounded half up to the cent. Percentages and rates are stored as `numeric` strings in fixtures and parsed with a decimal library in code.
