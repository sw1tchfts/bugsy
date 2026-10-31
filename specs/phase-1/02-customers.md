# Spec 02: Customers: accounts, properties, contacts, leads, quotes

Status: done
Depends on: 01
Skills to load: pest-domain

## Goal
Office staff and sales reps can capture a lead with its source, book an inspection, build a quote with good, better and best options, and convert a won lead into an account with one or more properties and contacts. Properties carry a validated, geocoded address because routing, state compliance and sales tax all key off it, and multi-unit buildings carry their units and residents because notices go to the people at the property, not only to whoever pays.

## Users and stories
- As office staff, I can create an account with its properties and contacts, search everything by name, address, phone or email, and see a warning when something similar already exists.
- As a sales rep, I can log a lead with where it came from, move it through the pipeline, book an inspection, send a quote with options, and convert it when it is won.
- As a property manager's account manager, I can see every property under one account, each building's units, and the resident contacts per unit.
- As an owner, I can see close rate by lead source on the home page.
- As a dispatcher (spec 05), I can rely on every property having coordinates or a clear "needs a pin" flag.

## Scope
### In scope
- Tables: accounts, properties, units, contacts, lead_sources, leads, quotes, quote_options, quote_lines, counters.
- Address normalization and geocoding through one provider adapter, with a deterministic stub when no provider key is configured.
- Duplicate warnings on create for accounts, properties, contacts and leads; explicit confirmation to proceed; never an automatic merge.
- Lead pipeline (new, inspection booked, quoted, won, lost) with required source and lost reason.
- Quotes with options and lines, per-tenant quote numbers, send, accept, decline, expire.
- Converting a won lead into an account, property and primary contact in one transaction.
- Office pages: customers list and search, account detail (properties, units, contacts, quotes), property detail, leads pipeline, lead detail with quote builder, quote detail; home page tile for leads and close rate by source.
- Default lead sources created for every new tenant.
- Audit triggers on accounts, properties, contacts, leads and quotes.
### Out of scope
- Service agreements and visit generation (spec 04); accepting a quote does not create an agreement yet.
- Price book items on quote lines (spec 03 adds `price_book_item_id`); lines carry a description and a price for now.
- Emailing or texting quotes and documents (spec 11); sending a quote marks it sent and shows a link.
- Customer portal and online booking (spec 16); door-to-door app and commissions (spec 17); lead marketplace intake endpoint (spec 20).
- Sales tax jurisdiction assignment (spec 08 uses the coordinates and county stored here).
- Measuring property size from satellite imagery: the fields exist (`size_sqft`, `lot_sqft`, `measured_by`); the imagery provider is an open decision below and does not block.
- Property diagrams and device maps (specs 14 and 15).

## Data
As in `docs/data-model.md` under Customers and sales, with these details and deviations:
- `accounts`: `type [residential, commercial, property_manager]`, `name`, billing address columns (`billing_line1`, `billing_line2`, `billing_city`, `billing_state_code`, `billing_postal_code`), `email`, `phone`, `phone_digits` (generated, digits only), `terms_days integer default 0`, `po_required boolean default false`, `notes`, `status [active, inactive]`, `lead_id` (the lead it came from, if any), `archived_at`.
- `properties`: `account_id`, `name` (for example "Home" or "Store 12"), address columns (`line1`, `line2`, `city`, `state_code`, `postal_code`), `normalized_address`, `county`, `lat`, `lng`, `geocode_status [pending, ok, failed, manual]`, `property_type [house, townhouse, condo, apartment_building, office, retail, restaurant, warehouse, food_plant, school, healthcare, other]`, `size_sqft`, `lot_sqft`, `measured_by [manual, imagery] null`, `unit_count`, `access_notes`, `registry_matches jsonb default '{}'`, `archived_at`. The state of the property selects the compliance rule pack (spec 07).
- `units` (new, CRM-11): `property_id`, `label`, `floor`, `notes`, `archived_at`; unique `(property_id, label)`.
- `contacts`: `account_id null`, `property_id null`, `unit_id null`, `name`, `email`, `phone`, `phone_digits` (generated), `role [billing, primary, resident, site_contact, property_manager]`, `sms_opt_in boolean default false`, `e_notice_consent_at`, `e_notice_consent_note`, `preferred_channel [email, sms, phone, mail]`, `notes`, `archived_at`. Check: at least one of `account_id`, `property_id`; `unit_id` implies `property_id`.
- `lead_sources` (new): `key`, `name`, `active`; unique `(tenant_id, key)`. A trigger on `tenants` insert creates the defaults: phone, referral, door_to_door, online_directory, ads, website, other.
- `leads`: `source_id not null references lead_sources`, `stage [new, inspection_booked, quoted, won, lost]`, `name`, `email`, `phone`, `phone_digits`, service address columns as on properties plus `normalized_address`, `lat`, `lng`, `geocode_status`, `property_type`, `notes`, `owner_id` (sales rep), `inspection_at`, `lost_reason`, `account_id`, `property_id`, `won_at`, `lost_at`.
- `quotes`: `number integer` (per tenant, from `counters`), `lead_id null`, `account_id null`, `property_id null`, `status [draft, sent, accepted, declined, expired]`, `valid_until date`, `notes`, `sent_at`, `accepted_option_id null`, `decided_at`. Check: `lead_id` or `account_id` present. Unique `(tenant_id, number)`.
- `quote_options`: `quote_id`, `position`, `name`, `description`, `recommended boolean`, `total_cents bigint` maintained by trigger from its lines.
- `quote_lines`: `option_id`, `position`, `description`, `kind [initial, recurring, one_time, add_on]`, `quantity numeric default 1`, `unit_price_cents bigint`, `amount_cents bigint` (quantity times unit price, rounded half up). Spec 03 adds `price_book_item_id`.
- `counters` (new): `tenant_id`, `key`, `value`; `app.next_number(tenant uuid, key text)` increments atomically. Invoices (spec 08) reuse it.
- Every table: `tenant_id uuid not null references tenants(id)`, RLS, `created_at`, `updated_at`, `created_by`.

## Interfaces
- `supabase/migrations/<timestamp>_customers.sql`: tables, enums as check constraints, `app.next_number`, `app.seed_lead_sources` trigger, quote total trigger, audit triggers, RLS policies.
- `lib/geo/provider.ts` (interface: `normalize(address) -> { normalized, lines, county, lat, lng, status }`), `lib/geo/google.ts` (Address Validation and Geocoding when `GOOGLE_MAPS_API_KEY` is set), `lib/geo/stub.ts` (deterministic normalization, no coordinates, status `pending`), `lib/geo/normalize.ts` (pure helpers: address string normalization, phone digits, email lowercase).
- `lib/customers/duplicates.ts`: `findDuplicates(tx, tenantId, { address?, phone?, email? })` returning matching accounts, properties, contacts and leads.
- `lib/customers/pipeline.ts`: allowed stage transitions (pure function) used by actions and tests.
- `lib/money.ts`: `lineAmountCents(quantity, unitPriceCents)` with half-up rounding.
- Pages and actions under `app/(office)/customers/` (`page.tsx` search and list, `new/`, `[accountId]/page.tsx`, `[accountId]/properties/new`, `properties/[propertyId]/page.tsx` with units and contacts), `app/(office)/leads/` (`page.tsx` pipeline by stage, `new/`, `[leadId]/page.tsx` with stage actions, inspection booking, quotes and convert), `app/(office)/quotes/[quoteId]/page.tsx` (options, lines, send, accept, decline).
- Server actions: `createAccount`, `updateAccount`, `archiveAccount`, `createProperty`, `updateProperty`, `moveProperty`, `createUnit`, `createContact`, `updateContact`, `archiveContact`, `createLeadSource`, `createLead`, `updateLead`, `setLeadStage`, `bookInspection`, `convertLead`, `createQuote`, `addQuoteOption`, `addQuoteLine`, `removeQuoteLine`, `setQuoteStatus`.
- Nav: Customers and Leads links in the office layout; home page tiles for open leads and close rate by source (last 90 days).
- Events: audit rows on the five audited tables; no journal entries yet.

## Business rules
1. Every lead references one of the tenant's lead sources; the column is not null and the form requires it.
2. Stage transitions: new to inspection_booked, new to quoted, inspection_booked to quoted, any open stage to won or lost, lost back to new. Won requires conversion (rule 3); lost requires `lost_reason`. `lib/customers/pipeline.ts` is the single source of truth and the database check trigger enforces it too.
3. Converting a lead creates, in one transaction, one account (type from the lead's property type: apartment buildings and commercial types become commercial or property_manager, houses residential), one property from the lead's service address, and one primary contact from the lead's name, email and phone; sets `leads.account_id`, `property_id`, `stage = won`, `won_at`. A lead with `account_id` set cannot be converted again. A lead without a service address cannot be converted.
4. On every save of a property or lead address, the geo provider normalizes it; `normalized_address`, `county`, `lat`, `lng` and `geocode_status` are stored. A provider failure stores `geocode_status = 'failed'` and never blocks the save. `manual` means someone placed the pin by hand (spec 05 adds the map).
5. Duplicate warning: before creating an account, property, contact or lead, the action looks for rows in the same tenant with the same `normalized_address`, the same `phone_digits` or the same lowercased email. If any exist and the form was not submitted with `confirm_duplicate`, the action returns the matches and nothing is saved. Nothing is ever merged automatically.
6. A property belongs to exactly one account; `moveProperty` changes `account_id` and is audited. Units belong to one property. A contact attaches to an account, a property, or a unit of that property; a resident contact must have a property.
7. `e_notice_consent_at` is set by the e-sign flow (spec 04) or by staff entering a date with `e_notice_consent_note` saying how consent was captured; clearing it requires a note too.
8. Quote numbers come from `app.next_number(tenant, 'quote')` at creation and are unique per tenant. Option totals equal the sum of their lines, maintained by a trigger. Line amounts are integer cents: `round_half_up(quantity * unit_price_cents)`.
9. Quote status moves draft to sent (needs at least one option with at least one line), sent to accepted (records `accepted_option_id` and `decided_at`), sent to declined, and sent to expired when `valid_until` has passed. Accepting changes nothing else in this spec; spec 04 turns an accepted option into an agreement.
10. Reads need `customers.read` (quotes also allow `agreements.read`); writes need `customers.write` (quotes: `agreements.write`). Sales reps can read and write customers and quotes with the default role.
11. Search matches name, address line and city, `phone_digits`, email and quote number, case-insensitive, scoped by RLS.
12. Inserting a tenant creates its default lead sources; tenants may add sources and deactivate any, but a source in use cannot be deleted.
13. Phone numbers are stored as entered plus a `phone_digits` generated column (digits only, leading 1 dropped for 11-digit US numbers) used for matching; emails are stored lowercased.
14. Money columns are `bigint` cents; quantities are `numeric`.

## Edge cases
- A phone inquiry with no address yet: the lead saves without an address; conversion is blocked until one is entered.
- Two accounts legitimately at one address (a landlord and a tenant who both pay for service): the duplicate warning appears and staff confirm.
- A property sold to a new owner: `moveProperty` to the new account; history stays on the old account's audit trail and visits (spec 04) keep their property.
- The geo provider is down: saves succeed with `geocode_status = 'failed'`; the property page shows a retry.
- A quote option with no lines cannot be sent; an empty quote cannot be sent.
- An 11-digit US number with a leading 1 matches its 10-digit form; extensions after "x" are ignored for matching.
- Deactivating a lead source hides it from new leads but keeps existing leads valid.
- A lead marked lost can be reopened to new; its original source and history stay.

## Decisions
- Geo provider: Google Maps Platform (Address Validation API, with Geocoding for coordinates and county) behind `lib/geo/provider.ts`, chosen for US coverage and county data. The adapter keeps the choice reversible; the stub provider makes development and tests deterministic without a key.
- Units are a table (CRM-11), not just a count, so residents and later visits can attach to a unit.
- Per-tenant numbering lives in a `counters` table with an atomic function, reused by invoices.
- Lead stages stay the five in the data model; the customer's lifecycle after signing lives on agreements (spec 04).
- Imagery-based property measurement (CRM-12) ships as fields plus a `measured_by` marker; the provider is chosen later and plugs into the same adapter folder.

## Open questions
- Which imagery or parcel data provider measures property size (Regrid parcels, Google Solar building footprints, or a vendor like Nearmap)? Does not block this spec.
- Should a declined quote reopen the lead to `new` automatically? Default here: no; staff move it.

## Verification
1. `npm test`: `tests/unit/geo-normalize.test.ts` (address and phone normalization), `tests/unit/duplicates.test.ts` (matching rules on fixture rows), `tests/unit/pipeline.test.ts` (every allowed and forbidden transition), `tests/unit/money.test.ts` (half-up rounding, including 0.5 cent cases).
2. `npm run test:rls` passes with the new tables discovered automatically; the seed gives Lakeshore at least one row in each (a homeowner, a landlord with a 3-unit building and its residents, a restaurant group with two sites, a lead per stage, a quote with two options).
3. `npm run typecheck && npm run lint && npm test && npx next build` pass.
4. `npm run test:e2e` runs `tests/e2e/customers.spec.ts`: as the Northwind sales rep, create a lead with a source, book an inspection, build a quote with two options and lines, send it, mark the lead won and convert it; the account page shows the property and primary contact; search finds the account by phone; creating a second property at the same address shows the duplicate warning; as the Lakeshore owner, the account is not visible. Screenshots go to `test-results/`.
