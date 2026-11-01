# Spec 19: Routing and fleet

Status: done
Depends on: 05, 06, 11 (and reads 18)
Skills to load: pest-domain, pesticide-compliance

## Goal
A day's route costs less driving and keeps its promises. The dispatcher orders a technician's day in one click, with the morning and afternoon windows kept and an arrival time for every stop; spreads the day's due visits across the technicians who may do them, balancing the load; and fills a gap left by a cancellation with the due visits and nearby customers that fit best. While a technician works, the phone shares where they are, so the board shows every truck on a map and the customer's on-the-way text says when to expect them. Route density is the profit lever of a pest company (12 to 18 stops a day within 10 to 15 miles is the benchmark); this spec makes it a button, not a morning of dragging cards.

## Users and stories
- As a dispatcher, I optimize a technician's day: the stops are reordered to cut the miles, morning stops stay before afternoon ones, and I see each stop's estimated arrival and the miles saved before I accept.
- As a dispatcher, I spread a branch's unassigned due visits for a day across the technicians, each assignment passing the dispatch check (spec 05), with stops and minutes balanced, and accept or drop each suggestion.
- As a dispatcher, when a stop cancels or a day has room, I see the due visits that would add the least driving to that day, and the customers near the route whose next visit could come forward, and schedule one with a click.
- As a technician, while I am clocked in or on my way to a stop, my phone shares my position; I can see that it does.
- As a dispatcher, I see each technician's last position and how old it is on a map with their stops.
- As a customer, my on-the-way text says about when the technician will arrive.

## Scope
### In scope
- Day optimization (ordering with arrival windows, estimated arrivals, miles before and after), branch-day assignment with workload balancing, fill-in suggestions, technician positions from the app, the dispatch map, the arrival estimate in the on-the-way text.
- Distances by great-circle miles and a company speed; start and end at the branch.
### Out of scope
- Road routing and traffic from a map provider, vehicle telematics: integrations (spec 20). The distance function is one module so a provider can replace it.
- Multi-day route planning and territory design: not built.

## Data
Migration `supabase/migrations/20261101250000_routing.sql`. Every new table has tenant_id, row level security and the write guard.
- `branches` gain `lat` and `lng` (the route's start and end), set on the branch form (geocoded, or typed).
- `route_settings` (one per tenant): average_speed_mph numeric (default 25), day_starts_at time (default 08:00), morning_ends_at (12:00), afternoon_ends_at (17:00), fill_in_miles numeric (default 5), position_days integer (default 30, how long positions are kept).
- `technician_positions`: user_id, lat, lng, accuracy_m, recorded_at. The latest per person is what the board shows; rows older than position_days are deleted by the messaging job.
- `route_runs`: technician_id, date, kind (`optimize`, `assign`), before jsonb, after jsonb, miles_before, miles_after, created_by, applied_at: what a suggestion proposed and whether it was taken.

## Interfaces
- `lib/routing/geo.ts` (pure): great-circle miles, drive minutes at the company speed. `lib/routing/optimize.ts` (pure): a day's order with windows (nearest neighbor, then 2-opt inside each window), estimated arrivals, miles; branch-day assignment by cheapest insertion with a balance penalty; fill-in ranking by detour. `lib/routing/db.ts`: loading a day, applying an order, assignment through the dispatch check, fill-ins, positions.
- Technician app: a position ping (online only; offline pings are dropped, they are not records) every few minutes while clocked in or on the way, posted to `app/api/tech/position`; a note on the clock bar that the position is shared.
- Office: `app/(office)/dispatch/routes` (linked from the board) with "Optimize day", "Assign the day" and "Fill this day" and their previews, and a map of the day's stops and the technicians' positions (`components/dispatch/route-map.tsx`, plain SVG, no tiles); settings `app/(office)/settings/routing` (speed, day times, branch coordinates).
- Messaging: the on-the-way template gains `{{eta}}` (spec 11), from the technician's last position when it is fresh, else the stop's estimate.

## Business rules
1. Distance is great-circle miles between coordinates; drive time is distance over the company's average speed, rounded up to the minute. A stop without coordinates is placed last in its window and flagged; it never blocks the rest.
2. Optimizing a day keeps every stop with the same technician and date; it orders "morning" stops first, then "any" and "afternoon" stops (any fills where it saves the most), then "evening", and inside each group minimizes miles from the branch and back. A stop the technician has started (en route, on site or done) keeps its place, and the order after it starts from there.
3. Each stop's estimated arrival is the day start (or the last started stop's real arrival and departure) plus drive and the previous stops' durations (the service type's default duration). A stop reached before its window opens waits for it, so no estimate is earlier than the window; a window the estimate reaches after its close is flagged on the preview, not hidden. Ordering counts the time a day takes as well as its miles, so "any" stops fill the morning rather than the technician waiting for an afternoon window.
4. Assigning a branch's day takes the planned visits due on that day (inside their due window) with no technician, and the technicians who work from the branch; each candidate placement must pass the dispatch check (credentials, licenses, blackouts, registry notice, and the crew the visit already carries) for that technician and day, and the technician's day must be under the company's stops per technician day (the same limit online booking uses, spec 16). The choice minimizes added miles plus a balance penalty for a technician already over the day's average minutes, and the visit is inserted into the day where it adds the least, without reordering the rest. Visits no technician can take are listed with the reason (the check's, a full day, or no room in the window). Owners and dispatchers count as technicians when they hold an applicator credential.
5. Fill-in suggestions for a technician's day are planned visits due on that day, then active customers within the fill-in miles of the route whose next visit is due within 14 days and may come forward (the agreement's due window allows it), ranked by detour miles; scheduling one runs the dispatch check like any schedule and inserts it where it adds the least, without reordering the day.
6. Suggestions change nothing until the dispatcher applies them. Each preview is recorded as a run (what it proposed); applying writes route positions (and, for assignment, the technician and date) in one step and marks the run applied, with the placements taken. A day changed by someone else after the preview (a stop moved, started or given another window, or a placed visit scheduled elsewhere) is refused with "the day changed; preview again"; the rows are locked while applying, so of two dispatchers applying at once the second is refused.
7. The phone shares its position only while the person is clocked in (spec 18) or a stop is on the way; it stops when they clock out. Positions are visible to the people who dispatch (dispatch.write) and to the person, not to other technicians; they are kept position_days days.
8. The on-the-way text's arrival estimate comes from the last position if it is under 10 minutes old, else from the stop's estimate; with neither it says "shortly". The estimate is a range of 15 minutes, never a promise to the minute.

## Edge cases
- A day with one stop optimizes to itself; an empty day has nothing to do.
- A crew visit (spec 05) moves with its lead; assignment never splits a crew.
- A technician with no branch coordinates starts from their first stop.
- A visit with a fixed time agreed with the customer (arrival window set) is never moved out of its window by optimization or assignment.
- Two dispatchers optimizing the same day: the second apply is refused (rule 6).

## Decisions
- Great-circle distance with a speed is good enough for ordering stops inside a town and needs no map provider or key; a provider can replace `geo.ts` later.
- Heuristics (nearest neighbor, 2-opt, cheapest insertion) over an exact solver: a pest route is 8 to 20 stops, they run instantly and give good routes.
- Positions are pings, not a track log: enough to show where a truck is, and less personal data kept.

## Open questions
- None blocking.

## Verification
1. `npm test`: `tests/unit/routing.test.ts` (miles and minutes, window order kept, 2-opt shortens a crossed route, started stops stay, arrivals and missed windows, assignment balances and respects a refused check, fill-in ranking).
2. `npm run test:rls`: the new tables discovered with seeded rows and guarded; a technician writes only their own positions and reads their own; dispatch reads every position in the company; another company sees nothing.
3. `npm run typecheck && npm run lint && npm test && npx next build` pass.
4. `npm run test:e2e` runs `tests/e2e/routing.spec.ts`: the dispatcher optimizes a seeded zigzag day and the miles drop with the morning stop first; fills the day's open room with the nearest due visit; assigns the rest of the branch's day with the visit in a state the technicians are not certified in refused with its reason; the technician's phone shares a position and the board's map shows it; the customer's on-the-way text carries an arrival estimate; another company sees none of it. Screenshots go to `test-results/`.
