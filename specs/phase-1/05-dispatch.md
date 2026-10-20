# Spec 05: Dispatch board

Status: stub (run /write-spec on this file)
Depends on: 04
Skills to load: pest-domain, wi-pesticide-compliance

## Goal
Dispatchers turn due windows into dated routes on a map-based board with drag and drop.

## Already decided (from the discovery doc)
- Phase 1 is manual dispatch with simple sequencing; route optimization is Phase 2.
- The board blocks assigning work a technician is not licensed for, and blocks bat exclusions inside the DNR blackout window (rules from lib/compliance/rules/wi.ts).
- Yard mosquito and tick jobs, and structural jobs reaching more than 10 feet from the building, at addresses on the DATCP landscape registry need advance notice before they can be scheduled.

## Questions for the spec interview
- Board layout: by technician rows, by day columns, or map-first?
- Customer time windows (morning, afternoon) in Phase 1?
- Bulk reschedule for weather in Phase 1?

## Verification will use
- fixtures/scheduling/rules.json (license, trainee, restricted-use and blackout cases).

The interview fills in the remaining template sections: users and stories, scope, data, interfaces, business rules, edge cases, decisions, open questions and verification.
