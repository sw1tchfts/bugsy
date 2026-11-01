# Spec 20: Integrations and API

Status: done
Depends on: 01, 09 (and reads 02, 05, 11, 14)
Skills to load: pest-accounting, pest-domain

## Goal
Other tools plug into Bugsy without custom work. A company issues an API key to its AI receptionist, website or lead marketplace, which can look up a caller, book a request and drop in a lead with its source; outgoing webhooks tell those tools when a lead arrives, a visit is booked or done, or an invoice is paid. A company that keeps its books in QuickBooks Online gets Bugsy's journal there as summarized daily entries on its own accounts. A phone system pops the caller's account on screen when the phone rings, logs the call on the account, and dials with a click. Smart traps report catches into the device history. API first, so the next integration is configuration, not a project.

## Users and stories
- As the owner, I create an API key with only the scopes a tool needs (for example leads and availability for an AI receptionist), see when it was last used, and revoke it.
- As an integrator, I call `GET /api/v1/...` and `POST /api/v1/...` with the key and get JSON in the documented shape, errors with a code and a message, and a clear limit when I call too fast.
- As the owner, I subscribe a URL to events and see each delivery, its response and retries; the receiver can check every delivery's signature.
- As the bookkeeper, I connect QuickBooks Online, map Bugsy's accounts to theirs, and each day's journal is summarized and sent once; a failed day is shown with the reason and can be sent again.
- As office staff, when a call comes in through the phone system, the matching account opens (or a new lead starts with the number), the call is logged on the account with its length and recording link, and I can dial a contact from their page.
- As the owner of a commercial program, smart trap events land in the device's history like a check.

## Scope
### In scope
- API keys with scopes, the v1 REST API (accounts and properties lookup, leads create, service requests create, availability read, visits read, invoices read), rate limits, request log.
- Outgoing webhooks: subscriptions, events, signed deliveries, retries with backoff, delivery log, test send.
- QuickBooks Online: OAuth connection, account mapping, daily summarized journal entries, sync log, a local test provider when no keys are set.
- Phone integration: inbound call events (caller lookup and call logs), click to call through the provider or `tel:`.
- Inbound integration events through the API: marketplace leads (with their source), smart trap events (device catch or alert).
### Out of scope
- Accounting systems other than QuickBooks Online (PRD: out of scope).
- A built-in phone service (PRD: out of scope); Bugsy integrates with the company's phone system.
- Termite bait program reporting in a manufacturer's own format and partner financing: their formats and contracts are not known yet; the API's visits and device endpoints already expose the data. Revisit with the partner's specification.

## Data
Migration `supabase/migrations/20261101260000_integrations.sql`. Every new table has tenant_id, row level security and the write guard.
- `api_keys`: name, prefix (shown), key_hash (sha-256 of the secret; the secret is shown once), scopes text[], created_by, last_used_at, revoked_at.
- `api_requests`: api_key_id, method, path, status, at: the last 30 days of calls, for the owner and for rate limits (60 a minute per key).
- `webhook_subscriptions`: url (https), events text[], secret (for signing), active, created_by.
- `webhook_deliveries`: subscription_id, event, payload jsonb, attempt, status (`pending`, `delivered`, `failed`), response_status, response_body (first 1 KB), next_at, delivered_at.
- `integration_connections`: provider (`quickbooks`, `phone`), status, settings jsonb (realm id, phone provider, the company's call number), tokens encrypted at rest (access and refresh, never readable by members), connected_by, connected_at.
- `quickbooks_account_map`: gl_account_id, qbo_account_id, qbo_account_name.
- `quickbooks_syncs`: day, status (`sent`, `failed`), qbo_entry_id, lines jsonb, error, attempts, sent_at. Unique per tenant and day.
- `calls`: direction (`inbound`, `outbound`), from_number, to_number, account_id, contact_id, lead_id, user_id, started_at, duration_seconds, recording_url, provider_call_id (unique per tenant), notes.
- `leads`, `service_requests` and `device_checks` gain `api_key_id`: what a key wrote names the key (rule 1); only the API's own functions set it.
- Permissions: `integrations.manage` (owner): keys, webhooks, the phone connection. QuickBooks (connection, mapping, sync) belongs to the books: gl.read to see it, gl.write to change it. Calls readable with customers.read.

## Interfaces
- `lib/api/keys.ts` (pure): key format `bgy_<prefix>_<secret>`, hashing, scope checks. `lib/api/auth.ts`: the request's key, its tenant and scopes, the rate limit and the log. Routes under `app/api/v1/` (`accounts/lookup`, `leads`, `service-requests`, `availability`, `visits`, `invoices`, `device-events`), each running under the key's tenant with the key's scopes enforced in the database (`app.api_*` definer functions that take the tenant and the scope).
- `lib/webhooks/events.ts` (pure): event names and payload shapes, the signature (`t=<unix>,v1=<hex hmac-sha256 of "t.body">`), the retry schedule (1 m, 5 m, 30 m, 2 h, 12 h, then failed). `lib/webhooks/db.ts`: enqueue from the places events happen (lead created, service request created, visit scheduled and completed, invoice paid), deliver in the messaging job.
- `lib/quickbooks/summary.ts` (pure): a day's journal lines summed per mapped account into one balanced entry. `lib/quickbooks/provider.ts`: the QuickBooks Online client (OAuth, JournalEntry create) and the local provider. `lib/quickbooks/db.ts`: the daily sync in the billing job.
- `lib/phone/db.ts`: caller lookup by number (accounts, contacts, leads), call logging; `app/api/integrations/phone/[key]` for the provider's call events (signed like Bugsy's webhooks, with the connection's own secret); `app/api/calls/ringing` for the caller pop and `app/api/calls` for click to call (logged, then dialed by the person's phone with `tel:`).
- Office: `app/(office)/settings/integrations` (keys, webhooks with deliveries, QuickBooks connection and mapping and sync log, phone connection), the account page's calls, a caller pop on the office layout.
- Docs: `docs/api.md`, the v1 reference.

## Business rules
1. An API key belongs to one company, carries only its scopes (`accounts.read`, `leads.write`, `requests.write`, `availability.read`, `visits.read`, `invoices.read`, `devices.write`), and is stored as a hash; its secret is shown once. A revoked key fails at once. A key never acts as a person: what it writes is attributed to the key.
2. The API reads and writes only the key's company's rows, through definer functions that check the scope; a call outside the scopes is 403, an account or property of another company is 404, over the limit is 429 with Retry-After (the count and the call's place in it are taken in one step; refused calls do not count), and every call is logged without its body.
3. A lead from the API keeps its source (a marketplace's name becomes a lead source) and runs the same duplicate check as the office (spec 02), returning possible matches rather than refusing.
4. Availability is the days in the next 14 where a technician of the property's branch has fewer stops than the company's limit, with arrival windows: weekdays, and a weekend day where the company has worked that day of the week in the last 90 days; it promises nothing and books nothing. A service request from the API lands in the office's requests inbox (spec 16) to confirm.
5. A webhook delivery is signed with the subscription's secret over the timestamp and body; it goes only to an https URL on a public host (never an address inside a private network); it is sent at least once, in order of creation per subscription (a delivery waits while an earlier one is retried), after the messaging job commits and in its own transaction, retried on failure on the schedule, and marked failed after the last retry or a 410; the delivery log keeps 30 days.
6. Webhook payloads carry ids and the facts of the event, never card data, pesticide application details or anything the subscription's events do not name.
7. QuickBooks receives one journal entry per closed day: the day's posted lines summed per mapped Bugsy account, balanced (an entry dated into a day already sent goes with the day it was recorded, so corrections still reach QuickBooks); a day with an unmapped account is not sent and says which account; a day is sent once (the sync key is the day, a lock per company, and the day as Intuit's request id), from the first unsent day since the sync began, after the billing job commits and in its own transaction. Bugsy stays the ledger of record for contract positions; QuickBooks gets the summary.
8. A call event matches the caller by number to a contact, an account or a lead (newest first); an unknown caller starts nothing until the office chooses to make a lead; every call is logged once by its provider id.
9. A smart trap event names the device by barcode on the key's company's sites and becomes a device check with source `sensor` (spec 14); an unknown barcode is refused with 404.

## Edge cases
- A key used from two tools at once shares one limit.
- A webhook URL that times out (10 s) counts as a failure; a 410 Gone deactivates the subscription.
- A QuickBooks token that expires is refreshed; a refresh that fails marks the connection as needing reconnection and stops the sync, which resumes from the first unsent day.
- A call from a number shared by two accounts pops both.
- An API lead with the same email as an existing account returns the match in the response and is still created as a lead (the office merges).

## Decisions
- Hashed keys with prefixes, not OAuth for integrators: the integrators are small tools a company sets up itself.
- Summarized daily entries to QuickBooks, not every Bugsy entry: the accountant wants totals by account, and contract positions stay in Bugsy.
- Webhooks are delivered by the messaging job, not inline, so a slow receiver never slows the office.

## Open questions
- Manufacturer bait program formats (Sentricon) and the financing partner: not built (see Out of scope).

## Verification
1. `npm test`: `tests/unit/integrations.test.ts` (key format and hash, scopes; the webhook signature, retry schedule and payload contents; a day's QuickBooks summary balances and unmapped accounts are refused).
2. `npm run test:rls`: the new tables discovered with seeded rows and guarded; key hashes and connection tokens never readable by members; the API functions refuse another company's rows and missing scopes; another company sees nothing.
3. `npm run typecheck && npm run lint && npm test && npx next build` pass.
4. `npm run test:e2e` runs `tests/e2e/integrations.spec.ts`: the owner creates a key with leads and availability scopes; the API looks up a caller, reads availability and creates a lead (refused for visits without the scope); a webhook subscription receives the lead's event with a valid signature (a local receiver); the bookkeeper maps accounts and sends yesterday's summary to the local QuickBooks provider; a phone event pops and logs a call on the account; a smart trap event appears in the device history; another company sees none of it. Screenshots go to `test-results/`.
