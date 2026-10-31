# Spec 02: Customers: accounts, properties, contacts, leads, quotes

Status: stub (run /write-spec on this file)
Depends on: 01
Skills to load: pest-domain

## Goal
Office staff can capture a lead, book an inspection, send a quote and convert a won lead into an account with one or more properties and contacts.

## Already decided (from the discovery doc)
- An account is the billing party; a property is the service location; contacts hang off either (discovery doc, Sales and CRM).
- Lead source is required on every lead.
- Pipeline stages: new, inspection booked, quoted, won, lost.
- Rental and multi-unit properties need resident contacts because many states require pesticide notices to residents, not only the paying account.
- E-signature on the agreement also captures written consent to electronic notices, which some states require before email or text delivery.

## Questions for the spec interview
- Do quotes support tiered good, better, best options in Phase 1?
- Which lead sources ship as defaults, and can tenants add their own?
- Address validation and geocoding provider (needed for routing and tax jurisdiction)?
- Duplicate detection rules for accounts and properties?

## Verification will use
- Seed data in scripts/seed.ts covering a homeowner, a landlord with three units, and a restaurant group with two sites.

The interview fills in the remaining template sections: users and stories, scope, data, interfaces, business rules, edge cases, decisions, open questions and verification.
