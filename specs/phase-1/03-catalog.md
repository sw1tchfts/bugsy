# Spec 03: Catalog: service types, price book, product master

Status: ready
Depends on: 01, 02
Skills to load: pest-domain, pesticide-compliance, pest-accounting

## Goal
Owners configure what they sell and what they spray. Service types describe the work (service line, job kind, treatment areas) and, per state, what the work requires: applicator certification categories and a sales tax class, defaulted from the state's rule pack and tightened by the tenant. The price book turns a service type into prices by property size with add-ons, so quotes and agreements pull consistent numbers. Products come from one platform-maintained master list with the EPA registration number, active ingredients, restricted-use flag, restricted entry interval, label and SDS, plus label rates; each tenant switches products on and sets its own unit cost. Everything downstream (agreements in 04, dispatch checks in 05, the technician's product picker and label warnings in 06, application records in 07, tax in 08, product cost in 09) reads from here.

## Users and stories
- As an owner, I can add the service types we sell, starting from industry templates, and see for each state we work in which certification categories a technician needs and whether the work is taxable, so compliance and tax are decided once, not per visit.
- As an owner, I can keep a price book: plan prices by home or lot size band, add-ons such as a detached garage or crawl space, and one-time services, so every quote uses the same numbers.
- As a sales rep, I can add a quote line from the price book and have the description, kind and price filled in from the property's size.
- As a licensed manager, I can switch on the products we carry, set the unit we buy them in and what they cost, and see the label, SDS, signal word, restricted entry interval and restricted-use flag for each.
- As a licensed manager, I can add a product that is missing from the master list by its EPA registration number; it stays marked unverified until the platform approves it, but my technicians can record it in the meantime.
- As a platform admin, I maintain the master product list and approve products tenants added, which moves them into the master list for everyone.
- As a technician (spec 06), I can rely on every enabled product carrying its EPA number and label rates, so the app can fill in records and warn me when an amount is outside the label.

## Scope
### In scope
- Tables: service_types, service_type_state_rules, price_book_items, products (shared), tenant_products; `price_book_item_id` on quote_lines.
- Service type templates per service line, offered when creating a service type.
- Per-state rules for each service type: certification categories and tax class, defaulted from the state rule pack when one exists, otherwise unknown and conservative; tenants may tighten but never loosen the pack's categories.
- The rule pack registry `lib/compliance/rules/` with the pack type and the two keys this spec reads; no state is researched yet, so the registry ships empty and tests inject a fixture pack.
- Price book with size bands (by home square feet or lot square feet), add-ons and one-time items; non-overlapping bands enforced by the database; a pure price lookup used by the quote builder now and by agreements later.
- Shared product master with EPA registration number, manufacturer, active ingredients, signal word, restricted-use flag, REI hours, label and SDS links, label rates; tenant-added products with an approval flow; per-tenant enablement with unit and unit cost in cents.
- A pure label rate check (`checkLabelRate`) that spec 06 calls before completion; this spec ships the function and its tests, not the technician UI.
- Office pages under `/catalog`: service types list and detail (state rules, price book), products (master list, enable and cost, add a private product). Platform console page `/admin/products` (master list, approvals). Quote detail gains "Add from price book".
- New permissions `catalog.read` and `catalog.write`; default roles updated.
- Seed: a starter set of service types with state rules and price book tiers for both demo tenants, a demo master product list, and enabled products with costs.
- Audit triggers on service_types, service_type_state_rules, price_book_items, products, tenant_products.
### Out of scope
- Agreements, cadences, seasonal rounds and visit generation (spec 04); accepting a quote still creates nothing.
- Technician product capture, mix calculator UI and completion warnings (spec 06); application records (spec 07); notices and blackouts (spec 07) beyond the job kind and treatment areas stored here.
- Sales tax rates and jurisdictions (spec 08); this spec stores only the tax class per service type per state.
- Inventory: stock per branch and truck, receipts, transfers, usage (spec 15 inventory in the PRD build plan; `tenant_products.unit` is the unit those movements will use).
- Uploading label and SDS files to Storage (spec 13 platform operations adds file storage); this spec stores links.
- Researching any state's rules. The registry is empty until a state is added per the `pesticide-compliance` skill.

## Data
As in `docs/data-model.md` under Catalog and pricing, with these details and deviations:
- `service_types`: `service_line [general_pest, rodent, termite, mosquito, bed_bug, wildlife]`, `name`, `description`, `job_kind [recurring_treatment, one_time_treatment, inspection, wdi_report, device_service, termite_treatment, termite_monitoring, bed_bug_treatment, trapping, exclusion, bat_exclusion, repair]`, `treatment_areas text[]` (subset of `interior, perimeter, yard, wood, devices`; may be empty for inspections and reports), `pricing_method [price_book, bid]` (specialty work is bid from labor plus materials), `default_duration_minutes integer`, `active boolean default true`, `archived_at`. Unique `(tenant_id, name)`.
- `service_type_state_rules`: `service_type_id`, `state_code` (two uppercase letters), `required_cert_categories text[] not null default '{}'`, `pack_cert_categories text[] not null default '{}'` (what the pack required when the row was last refreshed), `tax_class [taxable, exempt, unknown] default 'unknown'`, `pack_tax_class [taxable, exempt, unknown]`, `pack_version text null` (null when no pack covers the state), `notes`. Unique `(service_type_id, state_code)`. Check: `pack_cert_categories <@ required_cert_categories` (tighten, never loosen).
- `price_book_items`: `service_type_id`, `name`, `add_on boolean default false`, `size_basis [none, size_sqft, lot_sqft] default 'none'`, `size_min integer` (inclusive, default 0), `size_max integer null` (exclusive; null means no upper bound), `initial_price_cents bigint default 0`, `recurring_price_cents bigint default 0`, `one_time_price_cents bigint default 0`, `position integer`, `active boolean default true`, `archived_at`. Exclusion constraint (btree_gist): no two active items share `(tenant_id, service_type_id, name, size_basis)` with overlapping `int4range(size_min, size_max)`. Check: `size_basis = 'none'` implies `size_min = 0 and size_max is null`.
- `products` (`-- shared-table`): `tenant_id uuid null` (null is a master row; set is a product one tenant added), `name`, `manufacturer`, `epa_reg_no text not null` (digits and dashes, `^\d+-\d+(-\d+)?$`; `none` is allowed for FIFRA 25(b) minimum-risk products, stored as `25b-exempt`), `active_ingredients text[]`, `signal_word [caution, warning, danger, none]`, `restricted_use boolean default false`, `rei_hours numeric null`, `formulation text` (for example SC, WP, gel bait, dust), `label_url`, `sds_url`, `label_rates jsonb default '[]'` (array of `{ site, target_pests[], min_rate, max_rate, rate_unit, dilution_min, dilution_max, dilution_unit, notes }`), `verified_at`, `verified_by`, `archived_at`. Unique `(epa_reg_no)` among master rows, unique `(tenant_id, epa_reg_no)` among tenant rows (partial unique indexes). Tenant rows are unverified until approval; approval sets `verified_at` and clears `tenant_id`, which moves the row into the master list without changing its id.
- `tenant_products`: `product_id`, `enabled boolean default true`, `unit [fl_oz, oz, lb, gal, ml, l, g, kg, each]`, `unit_cost_cents bigint default 0`, `notes`. Unique `(tenant_id, product_id)`. Trigger: the product must be a master row or one this tenant added.
- `quote_lines`: add `price_book_item_id uuid null` with a composite FK `(tenant_id, price_book_item_id)` to `price_book_items (tenant_id, id)`.
- Every tenant table: `tenant_id uuid not null references tenants(id)`, RLS, `created_at`, `updated_at`, `created_by`. `products` carries the same timestamps and `created_by`.

## Interfaces
- `supabase/migrations/<timestamp>_catalog.sql`: `create extension if not exists btree_gist`; tables, constraints, `app.tenant_states(tenant uuid)` (distinct state codes of the tenant's active branches and properties), `app.check_tenant_product()` trigger, audit and updated_at triggers, RLS policies; default roles gain `catalog.read` (all) and `catalog.write` (office, compliance_manager).
- `lib/auth/permissions.ts`: new group "Catalog" with `catalog.read` and `catalog.write`.
- `lib/compliance/rules/index.ts`: `StatePack` type (`stateCode`, `version`, `effectiveOn`, `rules` keyed by the starter keys in the skill, each `{ value, source, effectiveOn }`), `getStatePack(stateCode, packs = PACKS)`, and `PACKS: Record<string, StatePack>` (empty until a state is researched). This spec reads `certification.categoriesByServiceLine` and `tax.taxabilityByServiceLine` (values `taxable` or `exempt`, optionally overridden per treatment area under `tax.taxabilityByTreatmentArea`).
- `lib/catalog/service-lines.ts`: `SERVICE_LINES`, `JOB_KINDS`, `TREATMENT_AREAS`, labels, and `SERVICE_TYPE_TEMPLATES` (one per common offering: general pest plan, general pest one-time, rodent program, commercial device service, mosquito and tick season, termite inspection, WDI report, termite treatment, termite monitoring, bed bug treatment, wildlife trapping, exclusion, bat exclusion, repair).
- `lib/catalog/state-defaults.ts`: `stateDefaults(stateCode, serviceLine, treatmentAreas, packs?) -> { certCategories, taxClass, packVersion }`; with no pack: `[]`, `unknown`, `null`.
- `lib/catalog/state-rules.ts`: `ensureStateRules(tx, tenantId, serviceTypeId)` upserts a row per `app.tenant_states` state, refreshing the `pack_*` columns and adding any new pack categories to `required_cert_categories` without removing tenant additions.
- `lib/catalog/pricing.ts`: `pickPriceBookItem(items, { sizeSqft, lotSqft })` (the band that contains the property's measure; `none` always matches; an item needing a measure the property lacks is skipped and reported as `needsMeasurement`), `priceBookLine(item, kind)` returning the quote line fields.
- `lib/catalog/epa.ts`: `normalizeEpaRegNo(input)` (trims, uppercases, accepts `25b-exempt`, rejects anything else that is not `\d+-\d+(-\d+)?`).
- `lib/catalog/label-rates.ts`: `checkLabelRate(product, { site, amount, unit, dilutionPercent? })` returning `ok`, `below_label`, `above_label`, or `no_rate_on_file`, with the matching rate entry; unit conversion between fl_oz, ml, l, gal, oz, g, lb, kg.
- Pages and actions: `app/(office)/catalog/service-types/page.tsx` (list, create from template or blank), `[serviceTypeId]/page.tsx` (edit, state rules, price book items, archive), `app/(office)/catalog/products/page.tsx` (master and own products, enable with unit and cost, add a private product), `app/(platform)/admin/products/page.tsx` (master list, create and edit, approve pending). Quote detail: "Add from price book" picker that lists active items for the quote's property size.
- Server actions: `createServiceType`, `updateServiceType`, `archiveServiceType`, `refreshStateRules`, `updateStateRule`, `addStateRule`, `createPriceBookItem`, `updatePriceBookItem`, `archivePriceBookItem`, `setTenantProduct`, `createTenantProduct`, `createMasterProduct`, `updateMasterProduct`, `approveProduct`, `archiveProduct`, `addLineFromPriceBook`.
- Nav: Catalog link in the office layout; Products link in the platform console header.
- Events: audit rows on the five audited tables; no journal entries.

## Business rules
1. Every service type has one service line, one job kind, a treatment area set valid for the job kind (inspections, WDI reports and repairs may have none; treatments need at least one), and a pricing method. Names are unique per tenant.
2. Saving a service type calls `ensureStateRules`: one `service_type_state_rules` row per state in `app.tenant_states(tenant)`. Each row's `pack_cert_categories`, `pack_tax_class` and `pack_version` come from the state pack for that service line and treatment areas; without a pack they are `{}`, `unknown` and null.
3. Tenants may add certification categories to `required_cert_categories` and may change `tax_class`, but the database rejects a row whose `required_cert_categories` does not contain `pack_cert_categories`. Refreshing from a newer pack adds new pack categories and keeps tenant additions.
4. `tax_class = 'unknown'` is allowed and is the default without a pack; spec 08 refuses to invoice an unknown class in that state until an owner sets it. Spec 05 treats an empty `required_cert_categories` with no pack as "unknown" and applies the conservative default from the skill (block assignment until a licensed manager confirms).
5. Price book bands never overlap within one `(service_type, name, size_basis)` among active items; `size_min` is inclusive and `size_max` exclusive. An item with `size_basis = 'none'` applies to every property.
6. `pickPriceBookItem` returns the single matching band for the property's measure; if the property lacks the measure the item needs (`size_sqft` or `lot_sqft` is null) the result says so and the quote builder asks for the size instead of guessing.
7. Adding a quote line from the price book copies the item's name as the description, sets `kind` (initial, recurring, one_time or add_on), `unit_price_cents` from the matching price column, and `price_book_item_id`; the line stays editable, and later price book changes never alter existing lines.
8. Money columns are `bigint` cents; `rei_hours` and label rates are `numeric` or JSON numbers, never floats in arithmetic beyond conversion factors.
9. Products: `epa_reg_no` is required and normalized; a master row's number is unique across the platform and a tenant row's number is unique within the tenant. A tenant may not add a number that already exists in the master list; the UI points them at the master row instead.
10. Only platform admins insert, update or archive master rows and approve tenant rows. A tenant with `catalog.write` inserts and edits its own unverified rows. Approval sets `verified_at`, `verified_by` and `tenant_id = null`; after that the tenant edits it no more. Every authenticated user can read master rows; tenant rows are visible to their tenant (with `catalog.read`) and to platform admins.
11. `tenant_products` may reference a master row or one of the tenant's own rows, enforced by trigger. A disabled product stays in history (spec 07 records reference products by id) but leaves the technician's picker.
12. `checkLabelRate` compares the amount per unit of carrier or area against the matching label rate entry for the site; when no entry matches it returns `no_rate_on_file` so spec 06 can warn without blocking. Restricted-use products are flagged on every product list; the assignment rule itself lives in spec 05.
13. Reads need `catalog.read`; writes need `catalog.write`. Default roles: every role reads the catalog; office and the licensed manager write it; owners write it through `*`. Quote line changes keep needing `agreements.write`.
14. Archiving a service type hides it from new quotes, agreements and templates but keeps existing references valid; a service type referenced by an active price book item, quote line or (later) agreement cannot be deleted, only archived.

## Edge cases
- A tenant works in a state with no researched pack: the service type page shows "No rule pack for XX yet" per state, with empty categories and unknown tax class, and the owner can enter what their licensed manager knows; the row records `pack_version = null` so a later pack refresh is visible.
- A tenant adds a branch in a new state after the catalog exists: the next save of any service type, or the "Refresh state rules" button, adds the missing rows. Spec 05 also calls `ensureStateRules` when it meets a property state without a row.
- A pack update removes a category: refresh keeps the category in `required_cert_categories` (tightening is always allowed) and updates `pack_cert_categories`; nothing becomes invalid.
- Two bands meet at a boundary (0 to 2000 and 2000 to 3500): valid, because the upper bound is exclusive. 1999 to 2001 overlapping both: rejected by the database.
- A property with no size on file and a price book keyed by size: the quote builder shows the item with "Enter the home size first" instead of a price.
- Two tenants add the same unknown product: both have private rows; approving one moves it to the master list, and the second tenant's approval is refused with "already in the master list; enable that row and archive yours".
- A FIFRA 25(b) minimum-risk product has no EPA registration number: stored as `25b-exempt`; uniqueness then relies on name and manufacturer, and spec 07 records it as exempt.
- A product's label rate is per 1,000 square feet while the technician entered ounces per gallon: `checkLabelRate` returns `no_rate_on_file` for that site rather than comparing unlike units.

## Decisions
- State defaults are copied onto `service_type_state_rules` (`pack_*` columns) rather than computed on every read, so the database can enforce "tighten, never loosen" and application records (spec 07) can show what the rule was at the time.
- The rule pack registry ships empty. Inventing a state's categories or taxability is forbidden by the compliance skill; unit tests use an injected fixture pack keyed `ZZ`, which can never be a real state.
- Tenant-added products are rows in the shared table with `tenant_id` set, not a separate table, so approval is a column change and ids stay stable for records already written.
- Label and SDS are links until platform file storage exists (spec 13). Links to the EPA pesticide product label system are acceptable for labels.
- Size bands use integer square feet with exclusive upper bounds and btree_gist exclusion, which Supabase supports.
- Tax class is the resolved answer (`taxable`, `exempt`, `unknown`) per service type per state, not a category name, because that is what billing needs and what a state's revenue department publishes.

## Open questions
- Which master product data source seeds the real list at launch (manual entry from the design partner's shelf, or a purchased label data feed)? The seed here is a demo list; it does not block.
- Should `tenant_products` carry a preferred supplier and pack size for purchasing? Deferred to the inventory spec.

## Verification
1. `npm test`: `tests/unit/pricing.test.ts` (band selection at boundaries, `none` basis, missing measurement, line fields per kind), `tests/unit/state-defaults.test.ts` (fixture pack `ZZ`: categories by service line, taxability by line and by treatment area override; no pack gives empty, unknown, null), `tests/unit/epa.test.ts` (normalization and rejection), `tests/unit/label-rates.test.ts` (ok, below, above, no rate, unit conversion).
2. `npm run test:rls` passes with the new tables discovered automatically; the seed gives Lakeshore rows in service_types, service_type_state_rules, price_book_items and tenant_products, and the shared `products` table has RLS and a select policy. Add checks: a tenant member cannot insert a master product row or update one; a platform admin can; a tenant cannot enable another tenant's private product.
3. `npm run typecheck && npm run lint && npm test && npx next build` pass.
4. `npm run test:e2e` runs `tests/e2e/catalog.spec.ts`: as the Northwind owner, create a service type from the "Mosquito and tick season" template, see one state rule row per Northwind state marked "no rule pack", add a certification category and set the tax class, add two size bands and an add-on to the price book, see an overlapping band rejected; enable a master product with a unit cost and add a private product that shows "unverified"; open a quote and add a line from the price book; as the platform admin, approve the private product; back as Northwind the product shows verified; as the Lakeshore owner, the Northwind service type is not visible and the approved product is. Screenshots go to `test-results/`.
