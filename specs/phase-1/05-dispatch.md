# Spec 05: Dispatch board

Status: done
Depends on: 04
Skills to load: pest-domain, pesticide-compliance

## Goal
Dispatchers turn due windows into dated, ordered stops on a board of technician rows by day columns with a map pane, by drag and drop or by a plain form. Every assignment passes the compliance checks before it sticks: the technician holds a current license and every certification category the service type needs in the property's state, trainees are supervised, the job kind is not inside a state blackout, and addresses on a notification registry have their advance notice. Customer arrival windows promised at booking are shown and honored. A technician's whole day moves at once when weather hits.

## Users and stories
- As a dispatcher, I see this week's board: each technician's stops per day in route order, and a panel of visits due that are not yet on a day, with the ones running out of window first.
- As a dispatcher, I drag a due visit onto a technician's day, or pick the technician and day in a form, and the board refuses it with a plain reason when that technician cannot legally do that work there.
- As a dispatcher, I reorder a technician's day, move one visit to another day or technician, send a visit back to the due panel, and skip a visit with a reason.
- As a dispatcher, I move a technician's whole day to another date when a storm closes the day.
- As a dispatcher, I see the day's stops on a map, colored by technician, with the unscheduled due visits in grey, so routes stay dense.
- As a licensed manager, I keep each technician's credentials per state (certification number, categories, expiry, license, trainee status and supervisor), and confirm a service type's state rules where no rule pack is researched yet, so dispatch has something to check against.
- As office staff, I promise a morning or afternoon arrival window when booking a re-service or confirming a visit, and the board keeps morning stops ahead of afternoon stops.
- As a technician (06), I can trust that every stop on my day is one I am allowed to do, with the crew and arrival window attached.

## Scope
### In scope
- Tables: applicator_credentials (one row per technician per state); `arrival_window`, `route_position`, `dispatch_notes`, `skip_reason` on visits; `confirmed_at` and `confirmed_by` on service_type_state_rules; `display_name` on memberships.
- The pure dispatch check (`lib/dispatch/checks.ts`) that returns blockers and warnings for a visit, a crew, a date and a state, reading rule values only from the state pack and the service type's state rules.
- The board at `/dispatch`: technician rows by day columns for a week, a due panel, drag and drop plus a form fallback, route order, per-visit unassign and skip, move a technician's day, a Leaflet map pane for the selected day.
- Visit page at `/dispatch/visits/[visitId]`: the check results in full, crew with roles (lead, applicator, supervisor, helper), arrival window, dispatch notes, schedule or unschedule.
- Credentials page at `/compliance/credentials`: list and edit per technician per state. Spec 07 adds expiry alerts, renewal tasks and recertification credits on top.
- A "Confirm" action on the catalog's state rule rows for licensed managers, which is what lets dispatch assign work in a state with no researched pack.
- Technician display names on memberships, editable on the users page, shown on the board, the visit page and later the technician app.
- Seed: display names, a full credential for each demo technician in the tenant's state, confirmed state rules for the seeded service types, and a few visits scheduled this week so the board is not empty.
- Audit triggers on applicator_credentials; visits are already audited.
### Out of scope
- Route optimization, drive-time estimates and workload balancing (PRD build plan: later; the board orders stops by hand).
- The technician app, arrival and departure capture and status changes past `scheduled` (06); application records and product capture (06, 07).
- Credential expiry alerts, renewal tasks, recertification credit tracking, registry imports and address matching, and the notices themselves (07). The dispatch check reads `properties.registry_matches` and the pack's registry rules, so once 07 fills them the block appears here without code changes.
- Customer-facing arrival window messages (11, 16).
- Time off and availability per technician (12 reporting or a later operations spec); the board shows every technician every day.

## Data
As in `docs/data-model.md` under Compliance, with these details:
- `applicator_credentials`: `user_id` (a member of the tenant), `state_code`, `cert_number`, `categories text[] not null default '{}'`, `cert_expires_on date null`, `license_number`, `license_expires_on date null`, `license_year integer null`, `recert_credits jsonb not null default '{}'`, `trainee_registered_on date null` (set means a registered trainee or technician-in-training, not a certified applicator, whatever else the row carries; it is cleared when the person is certified), `supervisor_id uuid null` (a member), `notes`, `archived_at`. Unique `(tenant_id, user_id, state_code)` among unarchived rows. Check: a row has a certification number or a trainee registration.
- `visits`: add `arrival_window text not null default 'any' check in (any, morning, afternoon, evening)`, `route_position integer null`, `dispatch_notes text`, `skip_reason text`. Scheduling sets `scheduled_for`, `technician_id` (the lead) and `route_position`; unscheduling clears them (the status trigger already clears date and technician on the way back to planned).
- `visit_crew`: unchanged; the lead row mirrors `visits.technician_id` and is written together with it.
- `service_type_state_rules`: add `confirmed_at timestamptz null`, `confirmed_by uuid null`. Refreshing from a pack clears the confirmation only when the pack's categories changed.
- `memberships`: add `display_name text`.
- Every tenant table: `tenant_id uuid not null references tenants(id)`, RLS, `created_at`, `updated_at`, `created_by`.

## Interfaces
- `supabase/migrations/<timestamp>_dispatch.sql`: the table, the columns, RLS policies, audit trigger; scheduling is not a database function (the action does it in one transaction). Credentials: read with `compliance.read` or `dispatch.write`, or your own rows; write with `compliance.write`.
- `lib/dispatch/checks.ts`: `checkAssignment(input) -> { blockers: Issue[]; warnings: Issue[] }` with `input = { visit: { kind, job_kind, treatment_areas, due_start, due_end, scheduled_for, arrival_window, property_state, registry_matches }, stateRule: { required_cert_categories, pack_version, confirmed_at } | null, crew: CrewMember[] (each with role and the credential for the state or null), pack: StatePack | undefined, today }`. Codes: `no_crew`, `no_state_rules`, `state_rules_unconfirmed`, `no_credential`, `cert_expired`, `license_expired`, `missing_categories`, `trainee_unsupervised`, `trainee_over_limit`, `blackout`, `registry_notice_due` as blockers; `outside_window`, `window_order`, `branch_mismatch`, `trainee_rules_unknown` as warnings.
- `lib/dispatch/week.ts`: `weekOf(date)` (Monday to Sunday in the tenant's zone), `weekDays(start)`.
- `lib/dispatch/db.ts` (server): `loadCheckInput(tx, tenantId, visitId, crewUserIds, date)`, `scheduleVisit(tx, tenantId, visitId, technicianId, date, position?)` (runs the check, writes visit and lead crew row), `unscheduleVisit`, `reorderDay`, `moveDay(tx, tenantId, technicianId, from, to)` (runs the check on each visit for the new date, moves what passes, reports what did not), `setCrew`.
- Pages and actions: `app/(office)/dispatch/page.tsx` (board, `?week=&day=&branch=`), `app/(office)/dispatch/visits/[visitId]/page.tsx`, `app/(office)/compliance/credentials/page.tsx`, `components/dispatch/board.tsx` (client: drag and drop, calls server actions, refreshes), `components/dispatch/map.tsx` (client, Leaflet, dynamic import, no server rendering).
- Server actions: `scheduleVisit`, `unscheduleVisit`, `moveVisit`, `reorderVisit`, `skipVisit`, `moveTechnicianDay`, `setArrivalWindow`, `setDispatchNotes`, `addCrewMember`, `removeCrewMember`, `saveCredential`, `archiveCredential`, `confirmStateRule`, `setDisplayName`.
- Nav: Dispatch link; Credentials under the catalog or a new Compliance link (Compliance). Home page tile: visits due this week not yet scheduled.
- Events: audit rows; no notices or records yet.

## Business rules
1. A visit is scheduled when it has `scheduled_for`, a lead technician (`technician_id`, mirrored as the `lead` crew row) and status `scheduled`. Scheduling, moving, reordering and crew changes run `checkAssignment`; any blocker aborts the whole change with its messages, and warnings are saved on the response and shown on the board.
2. Credential check, for job kinds that apply pesticide: every crew member in role `lead` or `applicator` needs an unarchived credential in the property's state whose `cert_expires_on` and `license_expires_on` (when set) are on or after the scheduled date and whose `categories` contain every `required_cert_categories` of the service type's state rule. A member with `trainee_registered_on` set may be on the crew only with a non-trainee `supervisor` or `lead` on the same crew who passes the check; when the pack defines `trainee.maxDays`, a trainee past it is refused. Helpers need no credential. Non-pesticide job kinds (inspection, WDI report, trapping, exclusion, bat exclusion, repair) skip the credential check.
3. State rules, for every job kind: the service type must have a state rule row for the property's state; when that row has no pack version and no confirmation by a licensed manager, assignment is refused (the conservative default from the compliance skill), with a link to the service type's state rules. Confirming is `compliance.write` and records who and when; refreshing from a pack that changes the categories clears it. Dispatchers read service types and state rules through their own permission.
4. Blackouts: when the pack defines `blackout.<job_kind>` as one or more month-day ranges, a scheduled date inside a range is refused.
5. Registry: when the property's `registry_matches` is not empty and the pack defines `registry.triggers` that include this service type's treatment areas or job kind, the visit is refused until spec 07 records the advance notice; until then the block message says so.
6. Arrival windows: `any` by default; morning, afternoon or evening when promised. Within a technician's day, a morning visit ordered after an afternoon or evening visit (or afternoon after evening) raises a warning, never a block.
7. A visit scheduled outside its due window raises a warning (the office sometimes does this on purpose); overdue visits in the due panel sort first.
8. Moving a technician's day re-checks every visit for the new date; visits that pass move with their order, visits that fail stay and are reported. Nothing moves when the target date already has stops for that technician, unless the dispatcher chooses to append.
9. Only `planned` and `scheduled` visits appear on the board; a scheduled visit can go back to planned (unassign) or to skipped with a reason; cancelled, completed and started visits are read only here.
10. Technicians on the board are members whose role grants `visits.write`; a member with `branch_ids` set is flagged when assigned work at another branch (warning). The board's technician names come from `display_name`, falling back to the email.
11. Reads need `dispatch.read`; board changes need `dispatch.write`; credentials need `compliance.read` or `dispatch.write` to view (compliance staff and the people who assign work) and `compliance.write` to edit, and a technician can always read their own; `confirmStateRule` needs `compliance.write`.
12. Every check reads rule values from the state pack through `getStatePack`; nothing in dispatch code names a state, a date range, a day count or a category.

## Edge cases
- No pack for the state and the licensed manager has not confirmed the rules: every assignment there is refused with one clear sentence and a link to the service type's state rules; confirming once unblocks the state.
- A technician certified in OH asked to work in IL: refused, no credential in IL.
- A certification that expires the day before the scheduled date: refused; the day of: allowed.
- A trainee as the only person on a crew for a pesticide job: refused; the same trainee with a certified lead: allowed, with a warning that trainee limits for the state are unknown when the pack lacks them.
- Dragging onto a cell for a date in the past: allowed with a warning (catching up paperwork happens), never for a cancelled visit.
- A morning window stop dragged under an afternoon stop: allowed with the order warning; the dispatcher reorders.
- Moving a day onto a date that already has stops: the action asks to append or stop; appending keeps the target's order first.
- A property without coordinates: shown in the due panel and on the board, listed under the map as "needs a pin" rather than placed at 0,0.
- Two dispatchers moving the same visit: the second change re-runs the check on fresh data; the visit lands where the last action put it, and the board refresh shows it.

## Decisions
- Native HTML drag and drop with a form fallback on every card, so the board works without JavaScript tricks and the e2e suite drives it through the form.
- Leaflet with OpenStreetMap tiles for the map pane, client only; the board never depends on the tiles loading.
- Credentials live in this spec because dispatch cannot check anything without them; alerts and renewal flows belong to 07.
- Confirmation of state rules by a licensed manager is the release valve for states without a researched pack; it is recorded, visible and reversible (a pack refresh that changes categories clears it).
- Route order is a column on visits, not a routes table; routes with planned start times, breaks and drive times come with optimization later and can be derived from this.

## Open questions
- Do dispatchers want a per-technician start location (home or branch) for the map before optimization exists? Not needed for the first build.
- Should skipping a visit with a reason be billable or noted on the agreement? Spec 08 decides; the reason is stored here.

## Verification
1. `npm test`: `tests/unit/dispatch-checks.test.ts` with a fixture pack `ZZ`: each blocker and warning code from rule 2 to 7, boundary dates for expiry, trainee with and without supervisor and over the limit, blackout inside and outside the range, registry trigger match, order warnings; `tests/unit/week.test.ts`.
2. `npm run test:rls` passes with applicator_credentials discovered automatically (the seed gives Lakeshore rows); rule tests: a technician reads their own credential but not a colleague's, a dispatcher reads all and cannot write, a licensed manager writes.
3. `npm run typecheck && npm run lint && npm test && npx next build` pass.
4. `npm run test:e2e` runs `tests/e2e/dispatch.spec.ts`: the Northwind owner signs a fresh agreement so a visit is due in a known week (and clears any credential the dispatcher holds); as the dispatcher, open the board, assign that due visit to the technician through the card's form and see it leave the due panel for the technician's cell; on the visit page, try to move it to the dispatcher (no credential) and read the refusal; add a helper to the crew; set a morning arrival window; move the technician's whole day to the next day and see the new date; as the licensed manager, add a credential for the dispatcher and the move succeeds; as the Lakeshore owner, the Northwind visit page is not found. Screenshots go to `test-results/`.
