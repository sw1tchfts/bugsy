# Spec 06: Technician app and visit capture (offline)

Status: stub (run /write-spec on this file)
Depends on: 05
Skills to load: pesticide-compliance, pest-domain

## Goal
Technicians run their day from an installable mobile web app that works offline and captures everything the legal record and customer notices need.

## Already decided (from the discovery doc)
- Installable mobile web app first, offline-capable; barcode scanning through the camera.
- Arrival and departure times become the legal application start and end times.
- Products are picked from the tenant catalog, which fills in EPA numbers; the technician enters amount and concentration or rate and area.
- Photos, notes, recommendations and customer signature are captured on the visit.
- Where the state requires them, residential jobs produce the resident notice at the time of application, and a restricted-entry warning sign when a product requires one.

## Questions for the spec interview
- Offline sync conflict policy (office edits a visit while the technician is offline)?
- Which device features are required on day one (camera, GPS, printing)?
- Field payments in Phase 1 or later?

## Verification will use
- fixtures/states/wi/application-record.json (a completed visit must yield a valid record (Wisconsin pack; each launch state adds its own folder)).

The interview fills in the remaining template sections: users and stories, scope, data, interfaces, business rules, edge cases, decisions, open questions and verification.
