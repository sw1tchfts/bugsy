# Spec 03: Catalog: service types, price book, product master

Status: stub (run /write-spec on this file)
Depends on: 01
Skills to load: pest-domain, wi-pesticide-compliance

## Goal
Owners configure what they sell and what they spray: service types per service line, a price book with size tiers and add-ons, and the products they use from a shared master catalog.

## Already decided (from the discovery doc)
- Service types carry service line, tax class, required certification categories and an is_landscape flag; these drive tax, licensing and notice rules later.
- Products come from one platform-maintained master list with EPA registration number, active ingredients, restricted-use flag, restricted entry interval, label and SDS. Tenants switch products on and set their cost.
- Specialty work (termite, bed bug, wildlife) is quoted from labor plus materials, not a rate card.

## Questions for the spec interview
- Where does the master product list come from at launch (manual seed, a state registration export, a vendor data feed)?
- Size tiers by square footage, by lot size, or both?
- Can tenants add private products not in the master list?

## Verification will use
- fixtures/compliance/service-type-rules.json (certification categories and tax class per service line).

The interview fills in the remaining template sections: users and stories, scope, data, interfaces, business rules, edge cases, decisions, open questions and verification.
