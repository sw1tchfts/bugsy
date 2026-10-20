# Spec 08: Billing: Stripe Connect, invoices, autopay, Wisconsin sales tax

Status: stub (run /write-spec on this file)
Depends on: 04
Skills to load: pest-accounting

## Goal
Tenants bill their customers per visit, flat monthly or annual prepay, take card and ACH with autopay, and charge Wisconsin sales tax only on taxable service types.

## Already decided (from the discovery doc)
- Stripe Connect, one connected account per tenant; card data never touches our database.
- One statement per account across agreements.
- Taxability is set per service type: lawn, tree and shrub spraying taxable; structural pest work treated as not taxable pending confirmation. Rates by service address from DOR tables.
- Collections: reminders, automatic retries, optional late fees, past-due flag that can pause service.
- Tenant billing (customers) and platform billing (tenants paying us) are separate modules.

## Questions for the spec interview
- Stripe Connect account type (Standard, Express, Custom) and who bears processing fees?
- Does the platform take a fee per payment?
- Invoice numbering per tenant or per branch?
- Confirm structural pest control and yard mosquito taxability with the Department of Revenue.

## Verification will use
- fixtures/accounting/agreement-ledger.json (billing schedules and installment rounding), fixtures/tax/taxability.json.

The interview fills in the remaining template sections: users and stories, scope, data, interfaces, business rules, edge cases, decisions, open questions and verification.
