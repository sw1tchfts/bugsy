# Spec 07: Compliance: credentials, records, notices, registry

Status: stub (run /write-spec on this file)
Depends on: 06
Skills to load: wi-pesticide-compliance

## Goal
The compliance manager sees every technician credential, every locked application record, and proof that every required notice went out, and can export it all for a DATCP inspection.

## Already decided (from the discovery doc)
- Records are generated from the visit, completed the same day, locked, corrected only by amendment, kept at least 2 years.
- Post-application notice within 30 days; email or text only with prior written consent.
- Yearly pre-application offer on continuing residential and landscape contracts.
- Landscape registry imported yearly; matching jobs need 12 hours advance notice (mail postmarked 2 business days ahead).
- Credential alerts at 60 and 30 days before expiry; licenses expire December 31.

## Questions for the spec interview
- Format of the DATCP landscape registry file (see discovery open questions).
- Inspector export format: one PDF, a CSV bundle, or both?
- Who may amend a locked record?

## Verification will use
- fixtures/compliance/application-record.json, fixtures/compliance/notices.json, fixtures/scheduling/rules.json.

The interview fills in the remaining template sections: users and stories, scope, data, interfaces, business rules, edge cases, decisions, open questions and verification.
