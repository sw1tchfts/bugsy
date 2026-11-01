# Spec 15: Specialty services: termite, wildlife, bed bug

Status: done
Depends on: 04, 06 (and reads 05, 07, 08, 09, 11, 14)
Skills to load: pest-domain, pesticide-compliance, pest-accounting

## Goal
The work that is not a quarterly plan runs in Bugsy too. A bed bug job is a treatment and two follow-ups on set offsets, with a prep checklist the customer gets before each visit and the technician confirms at the door. A wildlife job is trapping, checks, exclusion and repair over a couple of weeks, with the landowner's written authorization before any trap goes out, every animal caught logged with what happened to it, and the materials used billed. Termite work has the property diagram (the graph) with stations and findings marked on it, bait station checks (spec 14 devices), the WDI report a real estate sale needs, and the yearly warranty whose renewal fee is earned evenly over the year rather than on the inspection day.

## Users and stories
- As the office, I sell a bed bug job: the service type's plan (treatment, follow-up at 14 days, final at 28) becomes the job's visits, priced as the job, and its prep checklist goes out with each visit's reminder.
- As a technician at a bed bug visit, I see the prep checklist, record whether the unit was ready and what was missing.
- As the office, I sell a wildlife job, record the landowner's authorization (who signed, their relationship to the property, when, the signed form), and dispatch refuses to schedule trapping or exclusion until it is on file.
- As a technician on a wildlife job, I log each animal caught (species, count, what happened to it, where) and the materials I used; the billable materials are invoiced when the visit completes.
- As a termite inspector, I mark findings on the property's diagram, and write a WDI report from the inspection visit; once issued it cannot change and prints for the agent, buyer and lender.
- As the office, I sell a termite warranty: a yearly fee billed at each renewal, with an annual reinspection, and revenue spread evenly over each warranty year.

## Scope
### In scope
- Agreements gain the `job_plan` cadence (visits from steps with day offsets) and straight-line revenue recognition (warranties).
- Service types gain a job plan template and a prep checklist.
- Wildlife: authorizations, captures, the dispatch blocker; materials on any visit, billed at completion.
- Bed bug: prep checks at the visit; the checklist in the reminder.
- Termite: diagram marks on site maps (spec 14), WDI reports, warranty recognition in the ledger job and in cancellation settlement.
- Technician app: prep check, captures and materials sections, offline through the sync.
### Out of scope
- Bait program reporting to manufacturers (Sentricon and others): spec 20.
- State-specific WDI forms: a pack's `report.format` adds one later; the generic report ships.
- Drawing lines and areas on diagrams: marks are points with a label.

## Data
Migration `supabase/migrations/20261101210000_specialty.sql`; every new table has tenant_id, row level security and the write guard.
- `agreements.cadence` gains `job_plan` with `cadence_rule.steps` = [{label, offset_days, window_days}]; `agreements.recognition` (`per_visit` default, `straight_line`).
- `visits.step_label` (the job plan step it came from).
- `service_types.job_plan jsonb` (steps, the default for new job agreements) and `service_types.prep_checklist text[]`.
- `job_authorizations`: agreement_id, signer_name, relationship (`owner`, `owner_agent`, `tenant_with_consent`, `property_manager`), signed_on, scope, file_id, recorded_by.
- `wildlife_captures`: visit_id, species, count, disposition (`relocated`, `released_on_site`, `euthanized`, `transferred`, `escaped`, `dead_on_arrival`), location, notes, client_id.
- `visit_materials`: visit_id, description, quantity, unit, unit_price_cents, billable, client_id.
- `prep_checks`: visit_id (one per visit), ready, missing text[], notes, checked_by, checked_at, client_id.
- `diagram_marks`: map_id, kind (`damage`, `evidence`, `treated`, `inaccessible`, `moisture`, `note`), x, y, label, created_by.
- `invoices.source` gains `materials`: the materials invoice, which the crew of the visit may write at completion like the per-visit invoice (spec 08 rule 15).
- `wdi_reports`: visit_id (one per visit), number, requested_by, buyer, seller, structures, inspected_areas, inaccessible_areas, findings jsonb (live insects, dead insects or wings, damage, frass or tubes, previous treatment, each with where), treatment_recommended, notes, inspector_id, status (`draft`, `issued`), issued_at. Issued reports never change.

## Interfaces
- `lib/agreements/cadence.ts`: the `job_plan` cadence and its issues; `lib/agreements/visits.ts` carries the step label.
- `lib/specialty/recognition.ts` (pure): `straightLineRecognized(billed, termMonths, through)` and `recognitionByMonth(billed, termMonths, fromMonth, toMonth, stopAfter)`; the ledger job's `postStraightLine` in `lib/ledger/db.ts`.
- `lib/specialty/wdi.ts` (pure): findings, `wdiProblems`, the report HTML; `lib/specialty/wdi-db.ts` loads a visit's report with its context. `lib/specialty/marks.ts` (pure): mark kinds and their map tags. `lib/specialty/materials.ts` (pure): material lines, dispositions, relationships, wildlife job kinds. `lib/specialty/db.ts`: authorizations, job records, marks, WDI reports, materials invoicing.
- Tech: `RouteVisit.specialty` (prep checklist and check, captures, materials, authorization on file); change kinds `prep_check`, `capture`, `material`.
- Routes: agreement page sections (job steps, authorization, job records), `app/(office)/visits/[visitId]/wdi/page.tsx` and its print view `wdi/print`, site page marks (spec 14 page), catalog service type fields.

## Business rules
1. A job plan has 1 to 20 steps with non-decreasing day offsets from the first visit date; each step's window starts on its offset day and lasts its window days (default 3). The first visit is the initial at the initial price; later steps are recurring at the recurring price; the plan must fit the term.
2. A straight-line agreement earns each billed amount evenly by day over the term it pays for (from that term's start to the next term's start); its visits earn nothing on completion. The ledger job posts each ended month's recognition once (source key per agreement and month); cancellation settles against the straight-line amount earned through the effective date.
3. A wildlife visit (job kinds trapping, exclusion, bat_exclusion, repair) is not scheduled while its agreement has no authorization on file; dispatch names the blocker.
4. Every capture has a species, a count of at least one and a disposition; the binder and the job page list them by visit.
5. Billable materials on a completed visit become one invoice for that visit (source key `materials:<visit>`), lines at quantity times unit price rounded half up to the cent; non-billable materials are recorded for job costing only.
6. A visit whose service type has a prep checklist shows it to the technician and asks for a prep check before completion; not ready needs the missing items or a note. The reminder (spec 11) carries the checklist.
7. A WDI report belongs to an inspection or WDI visit; it is issued only with the inspected and inaccessible areas, every finding answered, and an inspector holding a credential for the property's state; once issued nothing in it changes.
8. Diagram marks sit on a site map at fractions of its size (spec 14 rule 3), with a kind and a label.
9. Access: customers.write or dispatch.write records authorizations and marks; the crew of an open visit (spec 14 rule 11) records captures, materials and prep checks; compliance.write or the inspecting crew writes a draft WDI report; compliance.write issues it.

## Edge cases
- A job plan step offset past the term end is refused at save.
- A warranty cancelled mid-year settles: a refund of the unearned share of the year's fee when prepaid.
- A wildlife job sold with the account's own signature still needs the authorization when the signer is not the owner; the office records the owner's.
- A prep check marked not ready can still complete (the technician treated what they could); the office sees it on the job.
- Materials added to a visit after completion are refused: the visit is closed.

## Decisions
- Jobs and warranties are agreements with a different cadence and recognition, so billing, the contract balance, cancellation and the ledger stay one path.
- Straight-line recognition is posted monthly, not daily: the books close by month and a month's figure is stable.
- WDI report is generic and complete; a state's own form arrives with its pack.

## Open questions
- Whether warranty reinspections should be priced (some companies charge for the reinspection on top of the renewal fee). Not built: the reinspection visit is part of the warranty fee.

## Verification
1. `npm test`: `tests/unit/specialty.test.ts` (job plan visits and issues, straight-line recognition by month, settlement against it, materials lines rounding, WDI problems).
2. `npm run test:rls`: new tables discovered with seeded Lakeshore rows and guarded; captures, materials and prep checks only by the crew of an open visit; an issued WDI report never changes; another company sees nothing.
3. `npm run typecheck && npm run lint && npm test && npx next build` pass.
4. `npm run test:e2e` runs `tests/e2e/specialty.spec.ts`: the office sells a bed bug job and sees three visits on the plan's offsets; the technician records a prep check and completes; the office sells a wildlife job, dispatch refuses trapping without authorization, the office records it and schedules; the technician logs a capture and billable materials and completes; the materials invoice exists; the inspector writes and issues a WDI report that then cannot change; a warranty's ledger recognition for an ended month is the fee times that month's days over the warranty year's days; another company sees none of it. Screenshots go to `test-results/`.
