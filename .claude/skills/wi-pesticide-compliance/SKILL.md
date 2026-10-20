---
name: wi-pesticide-compliance
description: Wisconsin pest control compliance rules (DATCP ATCP 29 licensing, application records, customer notices, landscape registry, bat exclusion blackout, sales tax on lawn work). Use when building or changing visits, the technician app, scheduling restrictions, credentials, application records, notices, product catalog fields or tax classes.
---

# Wisconsin pest control compliance

Rules become data in `lib/compliance/rules/wi.ts`, read by scheduling, the technician app, records and notices. Never hardcode a value below anywhere else. Full field lists and citations: [reference.md](reference.md). These rules were researched in October 2026; when changing behavior, re-check the cited source.

## Values the code depends on

| Rule key | Value | Source |
| --- | --- | --- |
| `records.retentionYears` | 2 | ATCP 29.21(1) |
| `records.completeBy` | same day as the application | ATCP 29.21(1) |
| `notice.postApplication.withinDays` | 30, in writing; electronic only with prior written consent | ATCP 29.22 |
| `notice.preApplicationOffer` | before the first application, then at least yearly on continuing contracts (residential and landscape) | ATCP 29.55(2), 29.56(2) |
| `notice.resident` | at the time of application; left with an adult or posted at the unit entrance; common areas and perimeter jobs posted in entryways | ATCP 29.55(3) |
| `sign.restrictedEntry` | sign at each entrance to the treated area when the label sets a restricted entry interval; 8.5 x 11 inches; up before, down after the interval ends | ATCP 29.55(4) |
| `landscape.advanceNoticeHours` | 12, to anyone on the DATCP landscape registry for that parcel | ATCP 29.56(8) |
| `landscape.mailPostmarkBusinessDays` | 2 business days before the application, if notice is mailed | ATCP 29.56(8) |
| `landscape.structuralBeyondFeet` | 10: structural work more than 10 feet from the structure follows landscape rules | DATCP structural checklist |
| `license.expires` | December 31 each year (individual and business) | ATCP 29.25(3), DATCP |
| `certification.validYears` | 5 | DATCP |
| `trainee.maxDays` | 30, under direct on-site supervision by a certified applicator | ATCP 29.32, UW PAT |
| `wildlife.batExclusionBlackout` | June 1 to July 31, every year | Wisconsin DNR |

## Certification categories by service line

| Service line | Required category |
| --- | --- |
| General pest, rodent, bed bug | 7.1 Structural |
| Termite | 7.3 Termite (with structural) |
| Lawn and turf | 3.0 Turf and Landscape |
| Mosquito (yard) | 5.0 Aquatic and Mosquito |
| Mosquito misting systems | 26.0 Chemigation subcategory, on top of a base category |
| Tick (yard) | Unconfirmed: treat as 3.0 plus 5.0 until DATCP confirms |
| Wildlife (no pesticide) | None from DATCP; DNR rules apply |

Structural certification excludes mosquito control. A lawn applicator needs 5.0 to treat for mosquitoes.

## Behavior the product must enforce

- A technician can be assigned a visit only if their license is current for the visit date and they hold every category the service type requires. Trainees can work only inside their 30-day window, with a supervisor assigned.
- Restricted-use products can be recorded only by a licensed, certified applicator.
- A completed visit produces an application record containing every ATCP 29.21 field. Missing fields block completion in the app, not later.
- Records lock at day end. Corrections are amendment rows with author and reason.
- Every required notice gets a `notices` row with due time, channel and proof of sending.
- Scheduling blocks bat exclusion visits inside the blackout. DNR's health exemption covers a landowner conducting the exclusion (form filed within 5 days of starting); whether a hired operator may work under it is unconfirmed, so keep the block until it is.
- Lawn and beyond-10-feet structural jobs at a registry address cannot start until the advance notice is recorded as sent in time.

## Sales tax touchpoint

Wisconsin taxes lawn spraying and fertilizing and tree and shrub spraying (DOR Publication 210). Structural pest control does not appear among taxable services in the sources reviewed. Treat it as not taxable until confirmed with DOR; keep taxability on the service type so it can change without code. Details in the `pest-accounting` skill.

## Open questions (do not invent answers)

- Which certification category covers yard tick control.
- Whether yard mosquito and tick spraying is taxable like lawn spraying.
- What DNR rule NR 12.10 requires of a hired wildlife operator (written landowner approval fields, permits).
- The file format DATCP uses for the yearly landscape registry.
- Whether a hired wildlife operator may perform a bat exclusion inside the blackout under a landowner's health exemption.
- How "business days" treats state holidays for the mailed landscape notice.
