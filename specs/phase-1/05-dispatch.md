# Spec 05: Dispatch board

Status: stub (run /write-spec on this file)
Depends on: 04
Skills to load: pest-domain, pesticide-compliance

## Goal
Dispatchers turn due windows into dated routes on a map-based board with drag and drop.

## Already decided (from the discovery doc)
- Phase 1 is manual dispatch with simple sequencing; route optimization is Phase 2.
- The board blocks assigning work a technician is not licensed for in the property's state, and blocks job kinds inside a state blackout window (for example bat exclusions); rules come from the state rule packs in lib/compliance/rules/.
- Jobs at addresses on a state notification registry need the advance notice the state requires before they can be scheduled (in Wisconsin: yard mosquito and tick jobs, and structural work more than 10 feet from the building, at landscape registry addresses).

## Questions for the spec interview
- Board layout: by technician rows, by day columns, or map-first?
- Customer time windows (morning, afternoon) in Phase 1?
- Bulk reschedule for weather in Phase 1?

## Verification will use
- fixtures/states/wi/scheduling-rules.json (license, trainee, restricted-use and blackout cases (Wisconsin pack; each launch state adds its own folder)).

The interview fills in the remaining template sections: users and stories, scope, data, interfaces, business rules, edge cases, decisions, open questions and verification.
