# Spec 16: Customer portal and online booking

Status: done
Depends on: 02, 08 (and reads 04, 05, 07, 11, 14, 15)
Skills to load: pest-domain, pest-accounting, pesticide-compliance

## Goal
The company's customers serve themselves. A homeowner signs in to see when the technician comes next, what was applied at their home and the notices they were sent, pays an open invoice, keeps a card on file for autopay, asks for a re-service when pests come back, and moves a visit to another day within the rules the office sets. A property manager sees every property they manage; a restaurant's manager sees the device map, the activity trend and the open recommendations, logs a sighting, and downloads the audit binder before the auditor arrives. People who are not customers yet book from a form the company embeds on its own website, and the request lands in the office as a lead.

## Users and stories
- As the office, I invite a customer's contact to the portal for their account (all properties, or chosen ones for a property manager), see who has access, and turn it off.
- As a customer, I accept the invitation by setting a password (or signing in with the account I already have), and I land on my portal.
- As a customer, I see my next visits (date and arrival window), my past visits with the products applied and the areas treated, the notices sent to me, my balance and invoices, and my requests.
- As a customer, I pay an open invoice with my card on file or a new card, add or remove a card, pick the default and turn autopay on or off.
- As a customer, I ask for a re-service (what I am seeing, where), or ask to book another service, and I see the office's answer.
- As a customer, I move a scheduled visit to another day in its window when the company allows it; the move is refused when it breaks the office's notice rule, the technician's capacity or a dispatch check, and I can send it as a request instead.
- As a commercial customer, I see my sites' maps with devices and marks, the activity trend, open recommendations and sightings, the documents the company shares, I log a sighting, and I download the audit binder for a date range.
- As the office, I work the requests inbox: book a re-service from a request, open an agreement for a booking request, or decline with a note.
- As the office, I create a booking form, copy its embed snippet onto our website, and see each submission as a new lead with the service and the day the prospect asked for.
- As a prospect, I fill in the form on the company's website (name, contact, address, service, preferred day and window, a message) and get a thank-you.

## Scope
### In scope
- Portal access: invitations, acceptance, several portal identities per person (a person may be a customer of two companies, or manage two accounts), disabling.
- Portal pages: overview, visit detail, invoice detail and payment, payment methods, requests, sites (commercial), settings the customer may change (none beyond cards and autopay).
- Self-service reschedule within the office's rules and the dispatch check; re-service and booking requests; the office's requests inbox.
- Booking forms: a hosted, embeddable page per form and a JSON intake endpoint; submissions become leads (spec 02) with the request details.
- Settings: portal rules (reschedule on or off, notice hours, technician stops per day, which service types customers may ask for), the invitation message template (spec 11).
### Out of scope
- Instant online booking that creates a visit for a prospect with no account: a prospect's booking is a lead the office converts (spec 02 flow).
- Hosted websites and SEO pages (PLT-06 says out of scope).
- Portal answers from the customer's history (spec 21).
- Customer-signed agreements in the portal (spec 04 signing stays in the office for now).

## Data
Migration `supabase/migrations/20261101220000_portal.sql`. Every new table has tenant_id, row level security and the write guard.
- `portal_users`: account_id, contact_id, email, user_id (set on acceptance), property_ids uuid[] (null: every property of the account), status (`invited`, `active`, `disabled`), token (the invitation link: it goes only into the customer's message; staff read every column but this one, and the audit trail drops it), invited_by, invited_at, accepted_at, last_seen_at. One active row per user and account.
- `portal_settings` (one per tenant): allow_reschedule, reschedule_notice_hours (default 24), max_stops_per_day (default 18), requestable_service_type_ids uuid[], allow_requests.
- `service_requests`: account_id, property_id, portal_user_id, kind (`reservice`, `booking`, `reschedule`), visit_id, agreement_id, service_type_id, preferred_date, arrival_window, details, status (`open`, `done`, `declined`), response, result_visit_id, handled_by, handled_at.
- `lead_forms`: key (uuid, public), name, service_type_ids uuid[], ask_preferred_date, thank_you, active, created_by.
- `intake_log`: form_id, ip_hash, result (`accepted`, `limited`, `refused`), lead_id. Rate limiting and a record of what came in.
- `leads` gain service_type_id, preferred_date, arrival_window, form_id, sms_consent.
- Portal reads go through the tables' own row level security: additive select policies for a portal identity (below). Portal writes: payments, payment allocations, payment methods, sightings and service requests, each limited to the identity's account and properties.

## Interfaces
- Identity in the database: `app.portal_user_id()` reads the `portal_user` claim the server puts in the session claims and returns it only when that portal user belongs to `auth.uid()` and is active. A signed Supabase token never carries that claim, so the Data API never grants portal access; only the server's own connection does. `app.portal_account(tenant)` and `app.portal_property(tenant, property)` answer for policies.
- Definer functions: `app.portal_identities()` (the signed-in person's active portal rows with company and account names), `app.portal_invitation(token)` (anon preview), `app.accept_portal_invitation(token)`, `app.portal_reschedule_context(visit)` (what the dispatch check needs), `app.portal_move_visit(visit, date)`, `app.portal_staff_names(tenant)` (display names of the people who served the account), `app.intake_lead(key, payload, ip_hash)` (anon).
- `lib/portal/session.ts`: the active portal identity (cookie, like the active company), `portalDb(session, identity, fn)`; `lib/portal/db.ts`: overview, visit, invoice, requests, sites; `lib/portal/rules.ts` (pure): reschedule rules; `lib/portal/intake.ts` (pure): form payload validation.
- Routes: `app/(portal)/portal/...` (overview, `visits/[visitId]`, `invoices/[invoiceId]`, `billing`, `requests`, `sites/[propertyId]`, `select`), `app/portal/invite/[token]`, `app/api/portal/files/[fileId]`, `app/api/portal/sites/[propertyId]/binder.zip`, `app/f/[key]` (hosted form), `app/api/intake/[key]` (JSON intake, CORS), office `app/(office)/requests`, account page portal card, `settings/portal`.
- Billing reuse: `chargeInvoice` and `addPaymentMethod` (spec 08) under the portal session; the payment's journal entry posts on the ledger job's next sweep (spec 09), since posting needs a member.

## Business rules
1. Only the office invites (customers.write); an invitation names an account, the email it was sent to and, for a property manager, the properties. The office never sees the link, cannot make an identity active or point it at a login, and cannot change its account, address or link; only the invited person accepts. Acceptance needs a signed-in user with that email, confirmed by the auth provider: a new person sets a password on the invitation page and confirms the address from the provider's email before the invitation is accepted (production keeps email confirmation on).
2. A portal identity sees only its account, and only its listed properties when it has a list. It never sees another account's or another company's rows, internal notes, dispatch notes, other customers, prices on the price book, or staff beyond the names of the people who served it. Its notices are the ones sent to the account's own contacts or posted at its properties, never a registry advance notice or a notice to another resident; its payments are the ones whose invoices it can see. The pages filter the same way, so a customer who is also staff sees only their portal rows there.
3. Payments in the portal use the company's gateway (spec 08); the money is allocated to the invoice paid. A failed charge leaves the invoice open and says why. Cards are tokenized by the gateway: with Stripe the card goes into Stripe's own field and only a payment method id reaches the server; the portal stores what billing stores (brand, last four, expiry). A suspended or archived company (spec 13) is read only in the portal too: no payments, cards or requests, refused before the gateway is called.
4. A re-service request needs an active agreement at the property and a description; the office books it (spec 04 rule) or declines with a note. A booking request names a service type the company lets customers ask for. Requests of every kind go in only while the office takes them online (on until it turns them off).
5. A customer may move a scheduled visit only when the company allows it, to a day in the visit's due window, at least the notice hours ahead of both the old and the new day, onto a day where the lead technician has fewer stops than the limit, and only when the dispatch check (spec 05) passes for the crew on the new day. Anything else is refused with the reason, and the customer may send it as a request.
6. A commercial customer logs sightings at their own sites (source customer); they cannot edit devices, checks or recommendations. The binder they download is the office's binder (spec 14 rule 10) for their site and range.
7. Shared site documents and the site's map images are the only files a portal identity can open.
8. A booking form submission needs a name, a way to reach the person (email or phone), an address and, when the form asks, a service from its list; a filled honeypot field is dropped quietly; more than 5 submissions an hour from one address hash (across all of a company's forms and every company), or 200 a day to one form, are refused; parallel submissions wait their turn, so the limits hold; every refusal is logged. Each accepted submission is one lead with source `website_form` ("Website form").
9. Disabling a portal user ends their access at once; their payments and requests stay.

## Edge cases
- A person invited to two accounts (a landlord with two entities) picks which one to open; the choice is remembered like the active company.
- An invitation to an email that already has a Bugsy login (a staff member who is also a customer) is accepted by signing in, not by setting a password.
- A visit rescheduled by the customer and then moved by dispatch: dispatch wins; the customer sees the new date.
- A property manager limited to some properties sees only those properties' visits, invoices with lines at them, and sites; an invoice with no property is shown when the account is theirs.
- A form posted with a service type the form does not list is refused.

## Decisions
- Portal reads use the tables' own row level security with additive policies keyed to a server-set claim that the database verifies against the signed-in user; nothing grants portal access through the public Data API.
- Re-services and bookings are requests the office acts on; self-service reschedule is the one change customers make directly, because the rules for it are checkable.
- Portal payments post to the ledger on the next sweep rather than at once: posting is a member's act, and the sweep already exists for exactly this.

## Open questions
- Whether customers should be able to cancel a visit outright. Not built: cancelling is a conversation (retention), so it is a request.

## Verification
1. `npm test`: `tests/unit/portal.test.ts` (reschedule rules, intake validation, property scoping helpers).
2. `npm run test:rls`: the new tables discovered with seeded rows and guarded; a portal identity reads its own account's visits, invoices and sites and nothing of another account or company; the claim without a matching active portal user grants nothing; a disabled user reads nothing; a portal user writes sightings and requests only at its properties.
3. `npm run typecheck && npm run lint && npm test && npx next build` pass.
4. `npm run test:e2e` runs `tests/e2e/portal.spec.ts`: the office invites Maria; she sets a password and sees her next visit and open invoice; she adds a card and pays the invoice, which shows paid in the office; she asks for a re-service and the office books it from the inbox; she moves a scheduled visit inside its window and is refused outside it; the Corner Bistro manager sees the site map, logs a sighting and downloads the binder; a prospect submits the booking form and the office sees the lead; Maria cannot open another account's invoice and another company sees none of it. Screenshots go to `test-results/`.
