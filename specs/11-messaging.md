# Spec 11: Customer messaging: email and SMS

Status: done
Depends on: 01, 02, 05, 06, 07, 08
Skills to load: pest-domain, pesticide-compliance

## Goal
Customers hear from the company at the moments that matter without anyone typing it: a reminder before the visit, a text when the technician is on the way, the visit summary when the stop is done (which doubles as the legal post-application notice when they consented), a review request, the invoice. When a customer texts back, the office sees it on the account and answers from there. Electronic and paper notices go out through the same pipe, and the delivery status becomes the notice's proof. Texting is included in the base price (PRD), every send respects consent, STOP and quiet hours, and the office can send a campaign to a filtered list.

## Users and stories
- As a customer, I get a reminder the day before my visit and a text when the technician is on the way; I reply STOP and never get another text.
- As a customer, I get the visit summary by email or a link by text, with what was applied, where, and what to do.
- As office staff, I see every message to and from an account on its timeline, in order, with its delivery status, and reply to a text from there.
- As office staff, I see the conversations waiting for a reply in one inbox.
- As the licensed manager, I see a notice that went out electronically marked sent with the message and its delivery status as proof, and a failed one back on my task list.
- As the owner, I edit the company's message templates, set quiet hours and which automations run, and see how many texts and emails went out this month.
- As the owner, I send a campaign (for example, mosquito season to last year's mosquito customers) to a filtered audience after seeing how many it reaches.

## Scope
### In scope
- Channels: email, SMS, and mail (letters through a print and mail service, for customers without electronic consent), each behind a provider interface: a local provider that records and delivers in the database (default, no keys), and Postmark (email), Twilio (SMS) and Lob (mail) when their keys are set.
- One messages table: the outbox, the account timeline and the notice proof. Status queued, sent, delivered, failed, suppressed (never sent, with the reason), received (inbound).
- Consent and suppression checked at send time: SMS only to a contact with SMS opt-in and not opted out; email not to a bounced, complained or unsubscribed address (marketing only for unsubscribe); quiet hours for SMS in the company's zone (default 08:00 to 21:00), a send outside them waits for the next allowed minute.
- Inbound SMS and keywords: STOP, STOPALL, UNSUBSCRIBE, CANCEL, END and QUIT opt out with a confirmation; START, UNSTOP and YES opt back in; HELP answers with the company's name and phone. Any other reply lands on the account timeline.
- Automations (each on or off per company): visit reminder N days ahead (default 1), on-the-way text when the technician taps On my way, visit summary at completion, review request a set number of hours after completion (only when a review link is set, at most once per account per set number of days), invoice email on issue.
- Notices (spec 07): due notices on email, SMS or mail are sent by the messaging job; delivery marks the notice sent with the message as proof; a failure marks it failed so the notice tasks pick it up. The visit summary carries the post-application notice when that notice is due on the same channel to the same person.
- Templates: built-in defaults per purpose and channel, company overrides, variables checked when saved.
- Public pages: `/m/[token]` shows a sent message's content (the summary or notice) without signing in; `/u/[token]` unsubscribes an email address from campaigns.
- Campaigns: audience filters (account type, state, service line of an active agreement, no completed visit in N days, agreement ending within N days), a count and sample before sending, send now or at a time.
- The account timeline and an inbox; monthly usage per channel on the messaging settings page.
- The messaging job: `POST /api/messaging/run` under `MESSAGING_RUN_SECRET`, `npm run messaging:run`, a member's "Send now".
### Out of scope
- Drip sequences for quotes, renewals and win-backs; surveys and referral credits (spec 17).
- Enforcing the monthly texting allowance and carrier registration workflow (spec 13 platform operations; this spec stores the number and its registration status).
- Phone system integration and call logging (spec 20).
- MMS, chat widgets, push notifications to customers.

## Data
Migration `supabase/migrations/20261101160000_messaging.sql`.
- `messaging_settings` (one per tenant): sender_name, reply_to_email, sms_number (E.164), sms_registration [none, pending, approved], quiet_start time default 08:00, quiet_end time default 21:00, reminders_enabled, reminder_days default 1, on_the_way_enabled, summary_enabled, review_enabled default false, review_url, review_delay_hours default 2, review_every_days default 180, invoice_email_enabled, email_provider [local, postmark], sms_provider [local, twilio], mail_provider [local, lob], company_phone.
- `message_templates`: tenant_id, key (purpose), channel, subject, body; unique per tenant, key and channel. Built-in defaults live in `lib/messaging/templates.ts`.
- `messages`: tenant_id, direction [outbound, inbound], channel [email, sms, mail], purpose [reminder, on_the_way, summary, review, invoice, notice, campaign, reply, keyword, inbound, other], account_id, property_id, contact_id, visit_id, notice_id, invoice_id, campaign_id (all null), to_address, from_address, subject, body, body_html, status, suppressed_reason, provider, provider_message_id (unique per provider), error, segments, dedupe_key (unique per tenant), token (unique), send_after, sent_at, delivered_at, failed_at, read_at, created_by, created_at.
- `message_opt_outs`: tenant_id, channel [sms, email], address (phone digits or lower-case email), reason [stop, unsubscribe, bounce, complaint, manual], message_id; unique per tenant, channel and address.
- `campaigns`: tenant_id, name, channel, subject, body, audience jsonb, status [draft, scheduled, sending, sent, cancelled], scheduled_for, counts jsonb, created_by, sent_at.
- Permissions `messages.send` (one-off messages and replies; office and dispatcher templates gain it) and `messages.manage` (templates, settings, campaigns; owners through `*`).

## Interfaces
- `lib/messaging/providers.ts` (interface, `providerFor(settings, channel)`), `local.ts`, `postmark.ts`, `twilio.ts` (send, inbound and status parsing, signature check), `lob.ts`.
- `lib/messaging/templates.ts` (defaults, `render(template, vars)`, `templateVariables`, `checkTemplate`), `lib/messaging/content.ts` (visit summary and notice text and HTML from a loaded visit), `lib/messaging/rules.ts` (pure: `keyword(body)`, `smsSegments(body)`, `withinQuietHours`, `nextAllowed`, `chooseChannel(contact, settings)`, `normalizeAddress`).
- `lib/messaging/db.ts`: `ensureMessagingSettings`, `queueMessage` (through `app.queue_message`), `sendQueued(tx, tenantId, now, ids?)`, `recordStatus` (through `app.record_message_status`, which also marks a linked notice), `handleInbound`, `visitRecipients`, `queueReminders`, `queueOnTheWay`, `queueVisitSummary`, `queueReviewRequests`, `queueInvoiceEmail`, `queueDueNotices`, `audience(filters)`, `launchCampaign`, `runMessaging(tx, tenantId, timeZone, now)`, `timeline(accountId)`, `inbox()`, `usage(month)`.
- Hooks: `lib/tech/sync-db.ts` queues the on-the-way text on en_route and the summary after completion; `lib/billing/db.ts` `issueInvoice` queues the invoice email; the compliance notice rows are read by the messaging job.
- Routes: `app/(office)/messages/page.tsx` (inbox), `app/(office)/messages/campaigns/page.tsx`, `campaigns/[campaignId]/page.tsx`, `app/(office)/settings/messaging/page.tsx` (settings, templates, usage), timeline and reply on `app/(office)/customers/[accountId]/page.tsx`, `app/(office)/messages/actions.ts`; `app/m/[token]/page.tsx`, `app/u/[token]/page.tsx` (public, through `withAnon` and definer functions); `app/api/messaging/run/route.ts`, `app/api/messaging/twilio/route.ts` (inbound and status), `app/api/messaging/postmark/route.ts` (delivery and bounce), `app/api/messaging/local/route.ts` (local inbound for development, refused in production and when the SMS provider is not local).

## Business rules
1. Every outbound message is a row before it is sent; the provider call and the status it returns are recorded on that row, and a provider id is recorded once (webhooks update by it, idempotently).
2. An SMS goes only to a contact whose sms_opt_in is on and whose number is not opted out; otherwise the message is suppressed with the reason and nothing is sent (TCPA consent; carriers require opt-out handling).
3. STOP and its synonyms opt the number out for the company at once and answer with one confirmation; START and its synonyms opt it back in; HELP answers with the company's name and phone. Keywords match the whole message, case and spacing aside.
4. An SMS whose send time falls outside the company's quiet hours waits until the next allowed minute in the company's zone; email is not held. Two texts go at once: a keyword's confirmation (carriers require it), and an office reply while the customer's own text is under 24 hours old (they started the conversation).
5. Email is not sent to an address that bounced or complained; campaign email is not sent to an unsubscribed address and carries an unsubscribe link.
6. Each automation sends at most once per occasion by a dedupe key: reminder per visit and scheduled date, on-the-way per visit, summary per visit, review per visit and at most once per account per review_every_days, invoice email per invoice, notice per notice.
7. A visit message goes to the property's primary or site contact, else the account's primary contact, on their preferred channel when it is usable, else SMS when they opted in, else email when they have an address; with none usable, nothing is queued.
8. The visit summary carries what was applied, where, when, by whom (with certification number), the target pests and the recommendations; when the visit's post-application notice is due on the same channel to the same person, the summary is that notice and its delivery is the notice's proof (spec 07).
9. A due notice on email, SMS or mail that no message carries is sent by the messaging job with its kind's template; the first sent or delivered marks the notice sent with proof {method, message_id, provider, provider_message_id, sent_at, delivered_at}, and that proof never changes after (spec 07; the message row keeps its later delivery); a failure before the hand-off marks it failed, and a required failed notice is a compliance task at once; a bounce or undelivered report after the notice was marked sent leaves the proof and opens a "notice not delivered" task to reach the person another way. Proof recorded by hand first wins, and the message that goes out later leaves it alone.
10. Templates use only their purpose's variables; an unknown variable is refused when the template is saved; rendering escapes HTML in email bodies.
11. A campaign's audience is the accounts the filters select, one message per account to its primary contact, with rules 2, 4 and 5 applied at send time; the preview count is what the filters select before consent is checked.
12. Inbound SMS is matched to the company by the number it was sent to and to a contact by phone digits; an unmatched number still lands in the inbox, unattached.
13. The public message page shows only the message's subject, content and the company's name, by an unguessable token, through a definer function; no other tenant data is reachable from it.
14. Access: customers.read reads messages of accounts it can see; messages.send sends one-off messages and replies; messages.manage edits templates, settings and campaigns; automations queue messages through `app.queue_message`, which needs the event's row in the company and, for a caller without dispatch (or compliance, for a notice), a place on the visit's crew and an address that belongs to a contact of the visit's account or property; other companies see nothing. A provider call has a deadline and never throws into the run: a network error or a timeout records the message failed.

## Edge cases
- A reminder queued for a visit that is then moved: the dedupe key includes the scheduled date, so the new date gets its own reminder and the old one, if still queued, is suppressed as stale.
- A technician taps On my way offline: the change syncs later; an on-the-way text more than two hours after the tap is suppressed as stale.
- STOP arrives while a text is queued: the send-time check suppresses it.
- A contact shares a phone with another contact: inbound attaches to the most recent conversation with that number.
- A notice whose recipient has no email or phone of the kind its channel needs: the message is suppressed and the notice marked failed, so the task asks for paper.
- A campaign scheduled in quiet hours: queued at its time, its texts wait for the next allowed minute.

## Decisions
- Providers behind one interface with a local provider by default, as payments did: every flow runs locally and in tests with no keys.
- Messages are sent by the job and, for on-the-way and replies, right after they are queued, so a reply does not wait for the next run.
- The summary doubles as the notice only when channel and recipient match; otherwise both go, so the legal notice never depends on the courtesy message.
- Quiet hours are the company's setting, default 08:00 to 21:00 in its zone; stricter state telemarketing hours apply to campaigns and are the company's to set.

## Open questions
- Which email and SMS providers to contract (Postmark and Twilio assumed): not blocking.
- Whether review requests should skip customers with an open complaint: not blocking; the office can turn reviews off.

## Verification
1. `npm test`: `tests/unit/messaging-rules.test.ts` (keywords, segments, quiet hours across midnight and DST, channel choice), `tests/unit/messaging-templates.test.ts` (render, escaping, unknown variables), `tests/unit/messaging-content.test.ts` (the summary and notice texts carry the required facts), `tests/unit/twilio.test.ts` (signature check against Twilio's published example).
2. `npm run test:rls`: new tables discovered with seeded Lakeshore rows; the office reads its accounts' messages, a technician queues only an on-the-way text for their own visit, nobody updates a message's body after it is sent, opt-outs are per company.
3. `npm run typecheck && npm run lint && npm test && npx next build` pass.
4. `npm run test:e2e` runs `tests/e2e/messaging.spec.ts` with the local providers: the owner sets quiet hours to the whole day and turns reviews on; the dispatcher schedules a visit for tomorrow and the job sends Maria's reminder; Maria replies "running late?" through the local inbound route and the office sees it in the inbox and replies; Maria texts STOP and the next reminder is suppressed with the reason; a technician's completion sends the summary by email, the public link shows it, and its post-application notice reads sent with the message as proof; a campaign to residential accounts shows its count and sends; the other company sees none of it. Screenshots go to `test-results/`.
