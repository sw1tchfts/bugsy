# Spec 04: Agreements and visit generation

Status: stub (run /write-spec on this file)
Depends on: 02, 03
Skills to load: pest-domain, pest-accounting

## Goal
Office staff can sign a customer to a service agreement and the system generates the visits it promises, each with a due window.

## Already decided (from the discovery doc)
- The agreement is the central object: account, property, service type, cadence, initial and recurring price, billing mode, term, auto-renew, cancellation fee.
- Cadence: monthly, every other month, quarterly, custom, and seasonal rounds inside a date window.
- The initial visit is a separate, higher-priced visit.
- Re-services are $0 visits tied to the agreement, with labor and product cost captured.
- Billing mode is per visit, flat monthly or annual prepay, chosen per agreement.
- Winter: skipped months and interior-only visits allowed.

## Questions for the spec interview
- How far ahead are visits generated (rolling 90 days, full term)?
- What happens to generated visits when an agreement's cadence or price changes mid-term?
- Bulk yearly price increase: Phase 1 or later?
- Renewal flow at term end: automatic, or a renewal task for the office?

## Verification will use
- fixtures/accounting/agreement-ledger.json scenarios define the visit schedules and prices the generator must produce.

The interview fills in the remaining template sections: users and stories, scope, data, interfaces, business rules, edge cases, decisions, open questions and verification.
