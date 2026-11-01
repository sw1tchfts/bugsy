# Spec 17: Sales and growth

Status: done
Depends on: 02, 04, 11 (and reads 03, 08, 09, 16)
Skills to load: pest-domain, pest-accounting

## Goal
The company grows from the doorstep and from its own customers. A door-to-door rep works a territory on a phone: the street's houses and what happened at each door, a quick quote from the price book, the customer's signature and card at the door, and the plan starts with its first visit on the board. Every sale pays its seller by the company's rules, held until the customer has stuck and taken back if they cancel early, and the books carry what is owed. Open quotes, renewals, seasonal upsells and lost customers get a sequence of messages that stops the moment they act. After a visit the customer can rate it, and a customer who sends a friend gets a credit when the friend signs.

## Users and stories
- As a sales manager, I draw territories (by ZIP codes and streets), assign reps, and see each territory's doors knocked, outcomes and sales.
- As a rep at a door, I see the houses already knocked and the do-not-knock list, record an outcome (not home, not interested, come back, sold, do not knock) with a note and a time to come back, and for a sale build a quick quote from the price book by service and size, take the customer's signature and card, and start the plan.
- As the owner, I set commission plans: who they cover (role or people), the basis (first visit, first-year value, or a flat amount), the percent or amount, the hold (days, and paid invoices), and the chargeback window for early cancellation.
- As a rep, I see my commissions: held, payable, paid and charged back, with when each releases.
- As the bookkeeper, payable commissions post to commissions payable; a chargeback after release reverses; paying a rep's commissions posts the payment.
- As the office, I set up sequences: open quotes, renewals coming due, seasonal upsells and win-backs, each a few timed messages that stop when the customer acts.
- As a customer, I rate my visit from 0 to 10 with a comment from the link in my visit summary, and share my referral link; when my friend signs a plan, I get the company's referral credit.

## Scope
### In scope
- Territories, rep assignment, knocks with outcomes and follow-ups, the do-not-knock list, the rep's door app (mobile web, queued offline like the technician app's sync is out of scope: the rep app needs a signal).
- Sale at the door: lead, account, property and contact in one step, a quick quote from the price book, the agreement signed with a typed name and drawn signature, the card saved for autopay, the agreement active and its visits planned.
- Commission plans, commissions with holds, releases and chargebacks, the commissions report and payouts, ledger postings.
- Sequences with triggers, steps, enrollment, stop conditions, under the messaging consent rules (spec 11).
- Post-visit surveys (NPS) and the referral program with credits.
### Out of scope
- Production pay for technicians and payroll export: spec 18.
- Route optimization of knocks and GPS tracks: spec 19.
- Offline door app: knocks need a signal for now.

## Data
Migration `supabase/migrations/20261101230000_sales.sql`. Every new table has tenant_id, row level security and the write guard.
- `territories`: name, zip_codes text[], streets text[], rep_ids uuid[], active.
- `knocks`: territory_id, rep_id, address, normalized_address, lat, lng, outcome (`not_home`, `not_interested`, `come_back`, `sold`, `do_not_knock`), notes, follow_up_at, lead_id, agreement_id, knocked_at.
- `agreements` gain `sold_by` (user: one of the company's people, fixed once signed) and `knock_id`.
- New permission `payments.capture` (save a card on an account; no charges or refunds), granted to the sales rep, office and owner roles.
- `commission_plans`: name, role_keys text[], user_ids uuid[], basis (`initial`, `first_year`, `flat`), percent numeric, flat_cents, hold_days, hold_paid_invoices, chargeback_days, active.
- `commissions`: user_id, agreement_id, plan_id, basis_cents, amount_cents, status (`held`, `payable`, `paid`, `charged_back`), earned_on, releasable_on, released_on, paid_on, payout_id, charged_back_on, recovered_payout_id, reason, and the plan's hold_paid_invoices and chargeback_days as they stood when earned.
- `commission_payouts`: user_id, paid_on, amount_cents, method, reference, paid_by.
- `sequences`: name, trigger (`quote_open`, `renewal_due`, `seasonal_upsell`, `win_back`), settings jsonb (days open, days before end, month and service type, days since cancel), steps jsonb [{delay_days, channel, subject, body}], active.
- `sequence_enrollments`: sequence_id, account_id, lead_id, quote_id, agreement_id, step, next_at, status (`active`, `completed`, `stopped`), stopped_reason.
- `surveys`: visit_id (one per visit), account_id, token, score (0 to 10), comment, sent_at, responded_at.
- `accounts.referral_code` (unique across every company, since the link names no company); `leads.referred_by_account_id`; `referral_credits`: referrer account, referred account, agreement_id (one per agreement), amount_cents, credit_memo_id.
- Settings: `growth_settings` (one per tenant): referral_credit_cents, survey_enabled.

## Interfaces
- `lib/sales/territory.ts` (pure): whether an address is in a territory, the do-not-knock check, knock stats. The quick quote is the price book's own band pick (`priceBookOffers` in `lib/catalog/pricing.ts`, spec 03) for the house's size.
- `lib/sales/commissions.ts` (pure): a sale's commission under a plan, release and chargeback decisions. `lib/sales/db.ts`: knocks, the door sale, commissions run (release, chargeback, ledger).
- `lib/growth/sequences.ts` (pure): who enters and when each step is due; `lib/growth/db.ts`: enrollment and sending in the messaging job, surveys and referral credits (at signing by billing staff, otherwise in the billing job).
- Database: `app.commissions_guard()` (a member's commission is the seller's, on a signed agreement, under a plan that covers them, for the amount `app.commission_terms` works out; then only release, payout and in-window chargeback), `app.agreement_seller_guard()`, `app.survey`/`app.answer_survey`, `app.referral`, `app.intake_referral`, `app.intake_address` (the booking form's lead gets its normalized address, spec 16).
- Routes: `app/(sales)/door/...` (the door app: territories, `[territoryId]` with the knock map and knock form, `[territoryId]/sell`), office `app/(office)/sales/territories`, `sales/commissions` (plans, report, payouts), `settings/growth` (sequences, referral credit, surveys), public `app/s/[token]` (survey) and `app/r/[code]` (referral link to the booking form).
- Ledger: source types `commission` (release: commissions expense to commissions payable; chargeback after release reverses) and `commission_payout` (commissions payable to the bank).

## Business rules
1. A knock records the rep, the time, the address and an outcome; a do-not-knock address warns every rep before the next knock there, and it stays until the office clears it.
2. A rep knocks only in a territory they are assigned to and sees only those territories and their knocks; a manager (customers.write and users.read, since reps also write customers) sees and edits every territory. A knock carries the phone's location when the rep allows it, else the address's geocode.
3. A door sale creates the lead (source door to door), converts it to the account, property and primary contact, builds the agreement from the service type's price book band for the property's size, signs it with the customer's typed name and drawn signature, saves the card for autopay (with Stripe the card goes into Stripe's field and only a payment method id reaches the server, spec 16 rule 3), and plans its visits, all in one transaction; the agreement's seller is the rep. An agreement written in the office names its seller from the people a plan covers; a sales rep is always their own seller.
4. A signed agreement earns its seller one commission per active plan that covers them (by role or by name): basis initial is the initial visit price, first_year the first twelve months of visit prices, flat a fixed amount; the amount is the basis times the percent, half up to the cent, or the flat amount. The database works the amount out again and refuses any other figure, so a seller cannot write their own pay.
5. A commission is held until both its hold days have passed and the account has paid the number of the agreement's invoices the plan asks for (both as the plan stood when earned); then it is payable and posts commissions expense to commissions payable once. Only billing staff or the billing job release it.
6. An agreement cancelled within the plan's chargeback days of signing charges back its commissions: a held one is simply charged back; a payable or paid one also reverses its posting (paid ones show as owed back on the rep's next payout).
7. Paying a rep's payable commissions records one payout and posts commissions payable to the bank; a payout never includes held or charged-back commissions.
8. A sequence enrolls each matching subject once: quote_open a quote sent and not accepted after its days; renewal_due an agreement within its days of ending that has not renewed and does not auto-renew; seasonal_upsell, in its month, an active customer without a plan of its service type; win_back an account whose last agreement was cancelled its days ago. Each step goes out its delay after the previous one, under spec 11's consent and quiet hours, and the enrollment stops when the subject acts (quote accepted, agreement renewed, plan bought) or opts out.
9. A survey goes with the visit summary when surveys are on; one answer per visit, 0 to 10 with an optional comment; the report shows the score (promoters minus detractors).
10. A lead that came through a referral link names the referrer; when that lead's account signs its first agreement, the referrer's account gets the referral credit once, as a credit memo: at signing when the signer may issue credits (billing.write), otherwise on the billing job's next run. A customer sees their referral link on the portal home when the company pays a credit and has a booking form.

## Edge cases
- A door sale where the address already has an account warns (spec 02 duplicates) and offers to add the property to it instead.
- A rep removed from a territory keeps their past knocks and commissions.
- A commission plan changed later does not change commissions already earned.
- A chargeback on an agreement cancelled after the window does nothing.
- A sequence step whose channel the subject has not consented to is skipped, not sent another way.

## Decisions
- Commissions accrue only when payable (a held commission is contingent), so the books carry what is owed, not what might be.
- Door sales need a signal; offline knocking adds sync complexity the first build does not need.
- Referral credits are credit memos on the referrer's account, so they apply to their next invoice like any other credit.
- Sellers hold agreements.write, so the commission's amount and its moves are checked in the database, not trusted from the app; referral credits are written only by billing staff or the billing job.
- A sequence step goes to the account's decision maker for its channel: the primary contact, then billing, then a property manager, then the account's own address; never a resident or a site contact.

## Open questions
- Whether to prorate chargebacks by the months the customer stayed. Not built: within the window the chargeback is the whole commission.

## Verification
1. `npm test`: `tests/unit/sales.test.ts` (territory match, quick quote band, commission math, hold and chargeback decisions, sequence due steps, NPS).
2. `npm run test:rls`: the new tables discovered with seeded rows and guarded; a rep sees only their territories' knocks and their own commissions; another company sees nothing.
3. `npm run typecheck && npm run lint && npm test && npx next build` pass.
4. `npm run test:e2e` runs `tests/e2e/sales.spec.ts`: the manager assigns a territory; the rep knocks a door (not home), marks another do not knock and is warned there next time, and sells a plan at a third door with a signature and card; the plan is active with visits; the rep's commission is held; after the hold the billing job makes it payable and the ledger shows it in commissions payable; cancelling another rep's fresh sale charges back its commission; a renewal sequence sends its first step; a customer rates a visit; a referral lead's signed plan credits the referrer; another company sees none of it. Screenshots go to `test-results/`.
