# Spec 14: Commercial programs

Status: done
Depends on: 04, 06 (and reads 03, 05, 07, 12)
Skills to load: pest-domain, pesticide-compliance, dataviz

## Goal
A commercial account (a restaurant, a warehouse, a food plant) buys a monitoring program: numbered devices (rodent bait stations, traps, insect light traps, glue boards, pheromone monitors) placed on a floor plan, every one checked at every service. Bugsy keeps each site's device inventory and maps, takes each device's check in the technician app offline, adds or moves a device on the map in the same step, shows activity trends per site and per device, logs sightings and recommendations through to a closed date, keeps the site's documents, and builds the audit binder an AIB, SQF or BRC auditor asks for, for any date range, in one click.

## Users and stories
- As the office, I set up a site: its floor plans, its devices with numbers, barcodes, kinds and places on the map, and the documents the customer's auditor wants.
- As a technician at a commercial stop, I see the devices to check, scan or pick each one, record what I found and did, add a new station or move one by tapping the map, and the app will not let me finish until every device in the program is accounted for.
- As a service manager, I see each site's activity by month and kind, the devices with repeated activity, open sightings and open recommendations.
- As the office, I record a sighting the customer phoned in, raise a recommendation with who owns it and by when, and close it with a note.
- As the office, I enter checks from paper service reports for history from before Bugsy.
- As the account's contact (through the office for now; the portal is spec 16), I get the audit binder for a date range.

## Scope
### In scope
- Site maps (raster floor plans), devices, device history (installed, moved, removed, relabeled), device checks, sightings, recommendations, site documents.
- Service types name the device kinds their visits check; the completion gate requires a check for every active device of those kinds at the property.
- Technician app: devices at the stop, check, add, move, remove, recommendations; offline, through the existing sync.
- Office: sites list, site page (map editor, devices, checks entry, trends, sightings, recommendations, documents), audit binder export.
### Out of scope
- The customer portal's view of all this (spec 16 reads these tables).
- Smart trap sensors: `device_checks.source` has `sensor` for spec 20 to feed.
- Consolidated commercial invoicing beyond spec 08's PO numbers and net terms.

## Data
Migration `supabase/migrations/20261101200000_commercial.sql`. Every table: tenant_id, row level security, the write guard (spec 13).
- `service_types.device_kinds text[]`: the device kinds a visit of this type checks; empty for most types.
- `site_maps`: property_id, name, file_id (PNG, JPEG or WebP), width, height, position, archived_at.
- `devices`: property_id, number (unique per property among active devices), barcode (unique per company when set), kind (`bait_station`, `rodent_trap`, `multi_catch`, `glue_board`, `insect_light_trap`, `pheromone_trap`, `termite_station`), zone (`interior`, `exterior`, `perimeter`), location, map_id, x and y (0 to 1 on the map, or null), product_id (the bait loaded, if any), installed_on, removed_on, status (`active`, `removed`), client_id.
- `device_events`: device_id, kind (`installed`, `moved`, `removed`, `relabeled`), before and after (number, location, map, x, y, zone), visit_id, at, by. Written by a trigger on devices, so no change escapes history.
- `device_checks`: device_id, visit_id (null for office paper entry and sensors), checked_at, checked_by, source (`technician`, `office`, `sensor`), status (`checked`, `inaccessible`, `missing`, `damaged`), activity (`none`, `low`, `medium`, `high`), count, bait_consumed_pct (0 to 100), pest, actions (`cleaned`, `rebaited`, `replaced`, `repaired`, `relocated`, `glue_board_replaced`, `bulb_replaced`), notes, client_id. One check per device per visit; a visit's checks are read only once it is completed.
- `sightings`: property_id, seen_at, location, pest, count, reported_by, source (`customer`, `office`, `technician`), notes, resolved_at, resolution, visit_id.
- `recommendations`: property_id, visit_id, sighting_id, category (`sanitation`, `exclusion`, `structural`, `storage`, `moisture`, `landscaping`, `other`), description, responsibility (`customer`, `company`), priority (`low`, `medium`, `high`), owner_name, due_on, status (`open`, `in_progress`, `closed`), closed_on, closed_note, client_id.
- `site_documents`: property_id, file_id, title, kind (`program`, `insurance`, `license`, `map`, `label`, `sds`, `report`, `other`), valid_until, shared (for the portal, spec 16).

## Interfaces
- `lib/commercial/devices.ts` (pure): kinds and labels, `hasActivity(check)`, `uncheckedDevices(devices, checks, kinds)`, `hotDevices(checks, window)`, `trend(checks, devices, months)`, map coordinate checks.
- `lib/commercial/db.ts`: sites list, site detail, device writes, checks, sightings, recommendations, documents; `binderData(tx, tenantId, propertyId, from, to)`.
- `lib/commercial/binder.ts`: the binder's HTML and CSVs from binder data (pure), zipped by the route.
- Tech: `RouteVisit.site` (devices of the visit's kinds, maps, open sightings and recommendations) and `captured.device_checks`; change kinds `device_check`, `device_add`, `device_move`, `device_remove`, `recommendation`; the gap `devices`.
- Routes: `app/(office)/sites/page.tsx`, `app/(office)/sites/[propertyId]/page.tsx` and `actions.ts`, `app/api/sites/[propertyId]/binder.zip/route.ts`. Office nav gains Sites.

## Business rules
1. A device belongs to one property. Its number is unique among the property's active devices and its barcode unique in the company; a removed device keeps its number in history and frees it.
2. Every add, move, relabel or removal writes a device event with the before and after, the time, who, and the visit when it happened at one; the map shown for any date is the devices installed by then and not removed, at their position then.
3. A device on a map has x and y between 0 and 1 (fractions of the map's width and height); a device may be unmapped, with only its location text.
4. A visit whose service type names device kinds checks every active device of those kinds at the property. The completion gate refuses to complete it while any is unaccounted for; inaccessible, missing and damaged are answers, and need a note.
5. A check shows activity when its activity is not none, its count is above zero, or bait was consumed. A device is hot when at least two of its last three checks show activity.
6. The trend for a site is per month and device kind: devices checked, devices with activity, the activity rate (with activity over checked) and total captures.
7. Adding a device at a stop places it in the same step: its location, and its map position when the technician taps the map. Moving one records the old and new place.
8. A recommendation is open until closed with a date and a note; it has an owner (a person's name on the customer's side, or the company) and may have a due date; overdue is open past its due date.
9. A sighting stays open until resolved with a note; a recommendation may come from it.
10. The audit binder for a property and a date range holds: the company and its license, the applicators who serviced the site with their credentials, the device list, every map with its devices, device changes in the range, every check in the range, the trend, sightings and recommendations (open, or touched in the range), the pesticide applications at the site in the range (spec 07 records), and the site's documents list; as a printable page plus CSVs.
11. Access: customers.read or visits.read reads a site; customers.write or dispatch.write writes it from the office; a technician writes devices, checks and recommendations only at a property where they are on the crew of a visit not yet completed, and checks only for that visit.
12. Map images are PNG, JPEG or WebP; files are served with a sandbox content security policy so no stored file runs script.

## Edge cases
- A device added at a stop is checked at that stop (its first check); it is in the gate from then on.
- A device removed at a stop needs no check at that visit.
- A visit at a site whose service type names no kinds has no device gate (a termite inspection at a restaurant).
- Office paper entry for a date with no visit records the check with no visit and source office.
- A device whose map is archived stays listed as unmapped until placed again.

## Decisions
- Device history by trigger rather than app code, so office, technician and future sensor paths all record it.
- Checks are not pesticide records; bait put in a station is a product application recorded through the normal product capture (spec 06), so it lands in the application record.
- Raster maps only: an uploaded SVG could carry script.

## Open questions
- Whether a site needs per-device check frequencies (some devices monthly, others weekly). Not built: every visit of a program type checks every device of its kinds.

## Verification
1. `npm test`: `tests/unit/commercial.test.ts` (activity, hot devices, trend by month and kind, the device gate with removed and added devices, binder HTML escaping and contents).
2. `npm run test:rls`: the new tables discovered with seeded Lakeshore rows and guarded; device history written by the trigger; a technician writes devices and checks only on their own open visit's property, and nothing after completion; another company sees nothing.
3. `npm run typecheck && npm run lint && npm test && npx next build` pass.
4. `npm run test:e2e` runs `tests/e2e/commercial.spec.ts`: the office uploads a floor plan and places a device on it; the technician at the seeded commercial stop is refused completion with devices unchecked, checks them (one with activity), adds a station by tapping the map, raises a recommendation, and completes; the office sees the checks, the new station on the map, the hot devices and the trend; logs a sighting and closes the recommendation; downloads the binder with the device list, checks and applications; another company sees none of it. Screenshots go to `test-results/`.
