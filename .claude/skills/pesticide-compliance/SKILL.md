---
name: pesticide-compliance
description: Pesticide compliance for pest control across US states (business and applicator licensing, certification categories, application records, customer and resident notices, posting, notification registries, restricted-use products, seasonal blackouts) and how each state's rules become a rule pack in lib/compliance/rules/. Use when building or changing visits, the technician app, scheduling restrictions, credentials, application records, notices, product catalog fields or tax classes, or when adding a state.
---

# Pesticide compliance

Rules differ by state, so each state's rules are data in its own rule pack, `lib/compliance/rules/<state>.ts`, applied for the state of the property being treated (not the tenant's home state). Product code reads rule values only from packs; never hardcode a notice window, retention period, license rule or blackout date anywhere else. Each researched state gets a file in `states/<state>.md` next to this one, with its values, citations and open questions. No state is researched yet: the launch states follow the design partner (PRD decision 2).

## What every state pack answers

Federal law (FIFRA) makes the product label the law and sets minimum standards for certifying applicators; states license businesses and applicators and add their own rules. Every pack answers the questions below. When a state's answer is unknown, the pack says so and the product applies the conservative default until it is confirmed.

| Area | What the pack defines | Conservative default |
| --- | --- | --- |
| Business licensing | Whether each business location needs a license, and when it expires | Block work for a branch without a current license |
| Applicator credentials | Certification categories each service line needs, license year, certification term, recertification credits, trainee or registered-technician rules and supervision | Block assignment when a license or category is missing or expired |
| Restricted-use products | Who may apply them, and any extra record fields | Only licensed, certified applicators; never trainees working alone |
| Application records | Required fields, when the record must be complete, how long it is kept | Require every listed field before completion; keep the longest period found |
| Customer notices | Pre-application offers, post-application information and timing; whether email or text needs prior written consent | Paper delivery unless consent is on file |
| Resident and occupant notices | Notices to people at the property who are not the customer, such as tenants | Notify residents of multi-unit properties |
| Posting | Signs before or after an application: when, size, placement, removal | Post when a product has a restricted entry interval |
| Notification registries | People who must get advance notice before nearby applications; lead time, channels, registry file format | A registry match blocks the visit until notice is recorded |
| Seasonal and wildlife rules | Blackouts such as bat exclusion seasons, wildlife operator permits, landowner authorization | Block the job type during a blackout until confirmed |
| Sales tax touchpoint | Whether pest control or yard spraying is taxable in the state | Taxability stays on the service type per state; see `pest-accounting` |

## Rule pack shape

Every rule is a key, a value, a source citation and an effective date. Keys are shared across states so product code stays state-agnostic. Starter keys:

| Key | Meaning |
| --- | --- |
| `business.licensePerLocation`, `business.licenseExpires` | Business license rules |
| `license.expires`, `certification.validYears`, `certification.recertCredits` | Applicator license and certification terms |
| `certification.categoriesByServiceLine` | Categories each service line requires |
| `trainee.maxDays`, `trainee.supervision` | Trainee or registered-technician limits |
| `records.requiredFields`, `records.completeBy`, `records.retentionYears` | Application record rules |
| `notice.preApplicationOffer`, `notice.postApplication.withinDays`, `notice.electronicNeedsConsent` | Customer notices |
| `notice.resident` | Notices to residents and occupants |
| `sign.restrictedEntry` | Posting rules |
| `registry.advanceNoticeHours`, `registry.mailLeadBusinessDays`, `registry.triggers` | Notification registries and which treatments trigger them |
| `blackout.<jobKind>` | Seasonal blackouts, for example `blackout.bat_exclusion` |

A key a state does not define means the rule does not apply there; an unknown value is recorded as unknown, never guessed. Packs are versioned, and every locked application record stores the pack version it was checked against.

## Behavior the product must enforce in every state

- A technician can be assigned a visit only with a current license in the property's state and every certification category the service type requires there. Trainee rules (time limits, supervision) come from the pack.
- Restricted-use products can be recorded only by a licensed, certified applicator.
- A completed visit produces an application record with every field the pack requires. Missing fields block completion in the app, not later.
- Records lock when the pack says they must be complete. Corrections are amendment rows with author and reason.
- Every required notice gets a `notices` row with due time, channel and proof of sending. Electronic delivery only where the pack allows it and consent is on file.
- Blackouts and advance-notice requirements block scheduling until they are satisfied.

## Adding a state

1. Research the state's pesticide regulator (often the department of agriculture), its administrative code for pesticide use and licensing, and its applicator training program. Cite every value.
2. Write `states/<state>.md`: rule values by key with citations, certification categories by service line, open questions.
3. Add the pack `lib/compliance/rules/<state>.ts` and fixtures in `fixtures/states/<state>/` with expected outcomes (valid and invalid records, notice due times, scheduling allow and block cases, taxability).
4. Never invent a value. Put unknowns under open questions, with the conservative default the product applies meanwhile.

Scope is pest control only: general pest, rodent, termite, mosquito and tick, bed bug and wildlife. Lawn care, tree and shrub care, and other trades are out of scope.
