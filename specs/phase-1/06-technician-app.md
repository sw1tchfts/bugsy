# Spec 06: Technician app and visit capture (offline)

Status: done
Depends on: 05
Skills to load: pesticide-compliance, pest-domain

## Goal
Technicians run their day from a mobile app that opens today's route with no signal, captures everything the legal record and the customer notices need at the stop, and syncs it without losing a visit. Arrival and departure are the legal application start and end. Products come from the catalog, so EPA numbers, label rates and restricted-use flags are already there; the app warns when an amount is outside the label and refuses a restricted-use product from anyone but a certified applicator. Completion is blocked until every field the record needs is present. Photos, notes, recommendations, conditions and the customer's signature ride along. The app is built as the web layer of the native wrapper the PRD chose (decision 4); the wrapper itself is a packaging step.

## Users and stories
- As a technician, I open the app in a basement and see today's stops in route order with the address, arrival window, what the work is, interior-only flags, dispatch notes and gate codes, and I can start, work and finish a stop with no connection.
- As a technician, I tap "On my way" and "Arrived"; the app records the times, which become the legal start of the application. "Done" records the departure.
- As a technician, I pick the products I used from the company's enabled list (or scan a label's barcode), enter the amount, unit, site and target pests, and the app fills in the EPA number and warns me when the rate is outside the label.
- As a technician, I note conditions (temperature, wind, sky) with one tap from the weather at the address when online, and type them when not.
- As a technician, I add photos, notes and recommendations for the customer, and the customer signs on my phone.
- As a technician, when I tap "Complete" the app tells me exactly which record fields are still missing, in my language, and lets me fix them before anything leaves the phone.
- As a Spanish-speaking technician, I switch the app to Spanish once and it stays that way.
- As a dispatcher, I see on the visit page what the technician captured, when they arrived and left, and that an in-progress visit cannot be rescheduled under them.
- As a licensed manager (07), I can rely on completed visits carrying every field the pack lists, the applicator's credential, and the crew that applied or supervised.
- As a customer (11), my post-service summary lists what was applied, where, and the technician's recommendations.

## Scope
### In scope
- Tables: visit_products, visit_notes, visit_photos, visit_signatures, files, sync_log; `conditions`, `areas_treated`, `target_pests`, `started_by` on visits; `upc` on products; `locale` on memberships.
- The technician route group `/tech`: today's route and the stop screen as a client-rendered app that works from a local store (IndexedDB) when offline, a service worker that caches the app shell and static assets, and a sync queue with client-generated ids.
- `GET /api/tech/route?date=`: the technician's route for a day with everything the stop needs (visits where they are lead or crew, property, account, agreement, service type, enabled products with label rates and restricted-use flags, crew with credentials summary, captured data so far, the state rule row, the pack's required record fields).
- `POST /api/tech/sync`: idempotent application of queued changes (status moves, products, notes, conditions, areas and pests, photos, signature, completion) under the technician's own session, each change logged once by its client id.
- The completion gate (`lib/compliance/records.ts`): the federal record floor for pesticide applications plus the pack's `records.requiredFields`, applied on the server at completion and on the device before sync for immediate feedback.
- Label rate warnings on every product line through `checkLabelRate` (spec 03); restricted-use products only from a crew member whose credential in the property's state qualifies (spec 05 check), never from a trainee.
- Conditions: manual entry always; one-tap fill from the weather provider adapter when online (Open-Meteo, no key), editable afterward.
- Photos (camera or file picker) and the signature (drawn on a canvas) stored through the `files` adapter: Postgres rows now, Supabase Storage later behind the same `lib/files.ts` interface.
- Barcode scanning of product labels with the browser's `BarcodeDetector` where available and typed entry otherwise; products gain a `upc` column the platform console and the catalog page can fill.
- Spanish and English strings for the whole technician app through one dictionary; the technician's choice is saved on their membership.
- Office side: the dispatch visit page shows arrival and departure, products, notes, conditions, photos and the signature; started visits cannot be moved or unscheduled by the office (the status trigger already refuses it), which is the "held for review" rule from the PRD.
- A printable visit summary at `/tech/visits/[visitId]/summary` and `/dispatch/visits/[visitId]/summary` (products applied, areas, pests, conditions, notes, recommendations, crew, times), which spec 11 sends as the post-service summary and spec 07 reuses as the record view.
- Seed: a visit in progress for the demo technician with products and a note, so the office page has something to show; UPCs on the demo products.
### Out of scope
- The Capacitor wrapper build (iOS and Android projects, truck printer, card reader and tap-to-pay plugins, native background sync): a packaging step documented in `docs/dev-setup.md`, needing toolchains this environment lacks. The web layer is built so the wrapper adds capabilities without changing screens.
- Field payments (08): the completion screen shows what the stop bills under per-visit billing and leaves the collection controls to spec 08.
- Application records as locked snapshots, amendments, notices and signs generated from the pack, inspector export (07). This spec captures the data and blocks completion when it is incomplete; 07 freezes it.
- Device programs, station checks and device maps (14): barcode scanning here covers product labels; device barcodes reuse the same scanner in 14.
- Tenant-built forms and checklists (15).
- Route optimization, live technician location and on-the-way texts (11, 19).

## Data
As in `docs/data-model.md` under Agreements and visits, with these details:
- `visits`: add `conditions jsonb` (`{ temperature_f, wind_mph, wind_direction, sky, captured_at, source }` where source is `weather` or `manual`), `areas_treated text[] default '{}'`, `target_pests text[] default '{}'`, `started_by uuid` (who tapped Arrived), `summary_sent_at` (filled by 11).
- `visit_products`: `visit_id`, `product_id` (same tenant's enabled product or a master row), `applied_by uuid` (crew member), `site_treated`, `location_description`, `amount numeric`, `amount_unit [fl_oz, oz, lb, gal, ml, l, g, kg, each]`, `concentration_percent numeric null`, `carrier_amount numeric null`, `carrier_unit null`, `area_treated numeric null`, `area_unit [sqft, sqm, acre, linear_ft, each] null`, `mix_load_site`, `target_pests text[]`, `label_check jsonb` (`{ status, reason }` from `checkLabelRate` at capture), `client_id uuid unique` (the device's id for the row), `recorded_at timestamptz`. Check: amount greater than zero.
- `visit_notes`: `visit_id`, `kind [note, recommendation, condition_found, access]`, `content`, `client_id unique`, `recorded_at`.
- `files` (tenant-owned, RLS): `kind [photo, signature, document]`, `content_type`, `byte_size`, `sha256`, `data bytea` (at most 5 MB), `client_id unique`. `lib/files.ts` exposes `putFile`, `getFile`, `fileUrl` and is the seam for Supabase Storage.
- `visit_photos`: `visit_id`, `file_id`, `kind [before, after, posting, device, other]`, `caption`, `taken_at`, `client_id unique`.
- `visit_signatures`: `visit_id` (one per visit), `file_id`, `signer_name`, `signed_at`, `client_id unique`.
- `sync_log`: `user_id`, `client_change_id uuid unique`, `kind`, `visit_id`, `result [applied, rejected, duplicate]`, `detail jsonb`, `applied_at`. The idempotency ledger.
- `products.upc text null` with a partial unique index on master rows; `memberships.locale text not null default 'en' check in ('en', 'es')`.
- Every tenant table: `tenant_id uuid not null references tenants(id)`, RLS, `created_at`, `updated_at`, `created_by`.

## Interfaces
- `supabase/migrations/<timestamp>_technician.sql`: tables and columns above, `app.check_visit_product()` (product is enabled for the tenant or a master row; restricted-use needs a certified `applied_by` in the property's state, no trainee), status trigger additions (`en_route`, `in_progress` and `completed` set `started_by`, `arrived_at`, `departed_at` and `completed_at` when the payload does not), RLS policies, audit triggers on visit_products and visit_signatures.
- `lib/compliance/records.ts`: `FEDERAL_RECORD_FIELDS` (the record floor from the federal restricted-use rule, applied to every pesticide application until a pack says more), `requiredRecordFields(pack)` (floor plus `records.requiredFields`), `recordGaps(visit, captures, crew, required) -> Gap[]` with field keys and messages; `isPesticideVisit(jobKind)`.
- `lib/weather/provider.ts`: `currentConditions(lat, lng) -> Conditions | null` (Open-Meteo, 5-second timeout, null on failure); `app/api/tech/weather/route.ts` proxies it for the device.
- `lib/files.ts`: the file adapter over the `files` table.
- `lib/tech/i18n.ts`: `MESSAGES` for `en` and `es`, `t(locale, key, vars?)`; every string the technician sees goes through it.
- `lib/tech/store.ts` (client): IndexedDB store for the route cache, captured changes and blobs; `lib/tech/sync.ts` (client): queue, retry, idempotent post; `lib/tech/route-types.ts`: the route payload shape shared by the API and the app.
- `app/(tech)/tech/layout.tsx` (mobile shell, service worker registration, language toggle), `app/(tech)/tech/page.tsx` (client app: route list and stop screen by `?visit=`), `app/(tech)/tech/visits/[visitId]/summary/page.tsx`, `public/sw.js`, `public/manifest.webmanifest`.
- `app/api/tech/route/route.ts`, `app/api/tech/sync/route.ts`, `app/api/tech/weather/route.ts`, `app/api/files/[fileId]/route.ts` (serves a file under RLS).
- Office: `app/(office)/dispatch/visits/[visitId]/page.tsx` gains the capture section and a link to the summary; `components/tech/*` for the client screens.
- Server actions: `setLocale` (through `app.set_my_locale`, since a member cannot update their own membership row); the barcode is a field of the shared product form, so the office fills it on products it added (`catalog.write`) and the platform console on master rows.
- Events: audit rows; `sync_log` rows; no notices yet.

## Business rules
1. The stop's legal times: `arrived_at` is set when the technician taps Arrived (status in_progress) and `departed_at` when they tap Done (status completed); both are instants from the device clock, sent with the change and never later than the server's receipt time. Status moves scheduled to en_route to in_progress to completed happen only through the sync endpoint by a crew member of the visit with `visits.write`, and only forward.
2. Every product line names a product the company enabled (or a master row), who applied it, the site, the amount with its unit, and at least one target pest. `checkLabelRate` runs at capture and its result is stored on the line; `below_label` and `above_label` are warnings the technician must acknowledge, never blocks. The amount is `numeric`, never a float in arithmetic.
3. Restricted-use products: the line's `applied_by` must hold a credential in the property's state that passes the spec 05 qualification (certified, current, with the service type's required categories) and must not be a trainee; the database trigger refuses the line otherwise. A trainee can be on the crew, not on the RUP line.
4. Completion gate: `recordGaps` lists every missing field; the device shows them and will not queue a completion while gaps exist; the server re-checks on sync and rejects a completion with gaps (the visit stays in progress, the rejection is logged). The floor for a pesticide job kind: arrival and departure, the property address and state, the service type, each product's name and EPA number, amount and unit, site treated, target pests, areas treated, the lead applicator's name and certification number from their credential in that state, and the date. The pack's `records.requiredFields` adds keys such as `conditions.wind_mph` or `conditions.temperature_f`; a key the pack names must be present. Non-pesticide job kinds need arrival, departure and a note or photo.
5. Offline: the route for the day is cached on the device when loaded; every change is written to the local store with a client-generated UUID before the screen moves on; the queue syncs whenever online, in order per visit, and a change whose id already exists in `sync_log` is reported `duplicate` and not applied twice. A full day with photos works with no signal (photos are kept as blobs locally and uploaded on sync, 5 MB each at most).
6. Sync applies changes under the technician's session through `withRls`; a change for a visit the technician is not on the crew of is rejected. The office owns the schedule: once a visit is en_route or in_progress, dispatch cannot move, unassign or skip it (the status trigger refuses), and an office note on it is shown to the technician at the next route load.
7. Conditions: entered by hand or filled from the weather provider for the property's coordinates at the time of arrival (`source: weather`, with `captured_at`); the technician may edit, which flips `source` to `manual`. Nothing in this spec decides which conditions a state needs: the pack does, through rule 4.
8. Photos and the signature are stored through `lib/files.ts`; the signature is one per visit with the signer's typed name; files are tenant rows under RLS and served only through the file route under the viewer's session.
9. Language: strings come from the dictionary for the membership's `locale`; a missing Spanish string falls back to English rather than a blank. The toggle is on the technician shell and saves to the membership.
10. Barcode: a scanned UPC matches `products.upc` among enabled products; no match offers the typed search. Scanning never bypasses the enablement or restricted-use rules.
11. Reads of captured data need `visits.read`, `dispatch.read` or `agreements.read`; captures are written by crew members with `visits.write`; `sync_log` rows are visible to the technician who sent them and to `dispatch.read`.
12. The summary page lists products with EPA numbers, amounts, sites and pests, areas, conditions, notes and recommendations, the crew with roles, times and the signature, in the viewer's language; spec 11 sends it and spec 07 locks the same facts.

## Edge cases
- No signal all day: the route loaded that morning (or the night before) is on the device; every tap is durable locally; the queue syncs on the drive home. The sync log shows every change once.
- Phone dies mid-stop: the local store survives; reopening the app shows the stop with everything captured so far and the queue resumes.
- The office reschedules a planned visit while the technician is offline with an old route: on sync, a status change for a visit no longer scheduled to that technician is rejected with a clear reason and the route refreshes; captured products on it are kept and shown to dispatch.
- Two phones on one crew capture products for the same visit: both sets land; each line names who applied it.
- A product the office disabled yesterday sits in the cached catalog: the device still offers it (cache), the server rejects the line, the technician picks another; the summary never shows the rejected line.
- The weather API is down: the one-tap fill does nothing and the manual fields stay.
- A label rate in different units than the technician's entry: `no_rate_on_file` shows "could not compare to the label" and completion proceeds.
- The technician's certification expires during the day: the route load that morning passed; the RUP trigger at sync refuses an RUP line applied after expiry (the check uses the application date).
- Spanish string missing: English shows; a test asserts every English key has a Spanish value so this stays theoretical.

## Decisions
- Web layer first, wrapper second: the PRD picked a native wrapper from the start; this environment cannot build iOS or Android projects, so the app ships as an installable web app whose screens, store and sync are the wrapper's web layer. Printer, card reader and tap-to-pay plugins attach in the wrapper without changing the screens.
- One client-rendered page for the technician app, so the service worker has one document and its chunks to cache; deep links use `?visit=`.
- IndexedDB and a hand-written queue instead of a sync library: the data is small, the ordering rules are specific (per visit, in order, idempotent by id) and the failure modes must be visible.
- Files in Postgres behind an adapter: the local stack has no object storage; Supabase Storage replaces the adapter's inside later. Five megabytes per file keeps rows sane.
- The federal restricted-use record floor applies to every pesticide application here: it is federal law, not a state rule, and it is the safest baseline until a state pack lists its own fields.
- Open-Meteo for conditions: free, keyless, good enough for a record; a state pack can later require a different source.

## Open questions
- Should the device delete its cached route after N days, or keep history for the technician to look back on? Default: keep seven days.
- Should the signature capture also record the signer's relationship to the account (resident, manager)? Spec 07 may need it for notices; the field is easy to add.

## Verification
1. `npm test`: `tests/unit/records.test.ts` (gaps for a pesticide visit with and without products, missing pests, missing applicator credential, pack-required condition keys, non-pesticide visits), `tests/unit/i18n.test.ts` (every English key has a Spanish value; interpolation; fallback), `tests/unit/sync-queue.test.ts` (ordering per visit, idempotent ids, retry after failure, in a fake store), `tests/unit/weather.test.ts` (provider parses a canned response and returns null on failure).
2. `npm run test:rls` passes with the new tables discovered automatically (the seed gives Lakeshore rows in visit_products, visit_notes, visit_photos, visit_signatures, files and sync_log); rule tests: a restricted-use line from a trainee is refused, a line on a product the tenant did not enable is refused, a technician cannot read another tenant's files, the office cannot move an in-progress visit.
3. `npm run typecheck && npm run lint && npm test && npx next build` pass.
4. `npm run test:e2e` runs `tests/e2e/technician.spec.ts`: as the Northwind owner, sign a fresh agreement for Maria whose first visit is due today; as the dispatcher, schedule it to Sam for today; as Sam, open `/tech`, see the stop, go offline (Playwright `setOffline`), tap On my way and Arrived, add a product with an amount outside the label and acknowledge the warning, add a note and a recommendation, enter conditions by hand, add a photo, draw a signature, tap Complete and read the gaps (target pests and areas missing), fix them, complete, go online and watch the queue sync with no rejection, open the summary; a Lakeshore file is not found for Sam through the file route; switch Sam's app to Spanish, see the route in Spanish after a fresh load, switch back; as the dispatcher, the visit page shows the capture with arrival and departure, the product line with its EPA number and label warning, the notes, the conditions and the signature. Against a production server (`npm run build && npx next start -p 3001`, `E2E_BASE_URL=http://localhost:3001`) the test also reloads the app while offline and gets the shell from the service worker and the route from the device; the dev server's HMR runtime does not hydrate without a connection, so there the test goes offline on the open stop. Screenshots go to `test-results/`.
