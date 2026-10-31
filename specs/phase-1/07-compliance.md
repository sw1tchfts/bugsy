# Spec 07: Compliance: credentials, records, notices, state rules

Status: stub (run /write-spec on this file)
Depends on: 06
Skills to load: pesticide-compliance

## Goal
The compliance manager sees every technician credential, every locked application record, and proof that every required notice went out, and can export it all for a state inspection. Each state's rules are a rule pack in lib/compliance/rules/.

## Already decided (from the discovery doc)
- Records are generated from the visit, completed when the state requires (Wisconsin: same day), locked, corrected only by amendment, and kept for the state's retention period (Wisconsin: 2 years).
- Post-application information within the state's window (Wisconsin: 30 days); email or text only where the state allows it and with prior written consent.
- Pre-application offers on continuing contracts where the state requires them.
- Notification registries imported per state; matching jobs need the state's advance notice (Wisconsin: 12 hours, or mail postmarked 2 business days ahead).
- Credential alerts at 60 and 30 days before expiry; license and certification terms come from the state pack (Wisconsin licenses expire December 31).

## Questions for the spec interview
- Registry file formats for each launch state (Wisconsin's is an open question in its state file).
- Inspector export format: one PDF, a CSV bundle, or both?
- Who may amend a locked record?

## Verification will use
- fixtures/states/wi/application-record.json, notices.json and scheduling-rules.json (Wisconsin pack; each launch state adds its own folder).

The interview fills in the remaining template sections: users and stories, scope, data, interfaces, business rules, edge cases, decisions, open questions and verification.
