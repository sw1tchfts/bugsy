# Spec 21: AI features

Status: done
Depends on: 06, 12 (and reads 03, 07, 11, 16)
Skills to load: pest-domain, pesticide-compliance

## Goal
AI takes the typing and the noticing off people's hands, and never the deciding. A technician gets a plain-language summary for the customer drafted from their own notes and edits it before it goes; the office reads a label's directions into the product's rate rows and confirms them before the label check uses them; unusual amounts are flagged for a licensed manager to review; every active plan carries a churn risk score with its reasons, so the office calls the right customers first; and a customer asking in the portal gets an answer drawn only from their own records, or a person. Every AI output is a draft or a flag that a person reviews; none changes a legal record (an application record, a notice, a product's verified label) on its own.

## Users and stories
- As a technician, at the end of a stop I tap "Draft a summary", get a short note for the customer written from my notes, findings and recommendations, edit it, and it goes with the visit summary.
- As office staff, I paste a product label's directions for use, see the rate rows read from it, correct them, and save them into the product myself.
- As a licensed manager, I see applications whose amount is far above what the company usually uses for that product and site, and review them.
- As the owner or office, I see the plans most at risk of cancelling, each with its reasons, and work the list.
- As a residential customer, I ask the portal "when is my next visit?" or "what did you spray last time?" and get an answer from my own visits and invoices; a question it cannot answer from them goes to the office, whose answer I see in the portal.
- As the owner, I turn each AI feature on or off and see how many AI calls the company made this month.

## Scope
### In scope
- An AI provider: Claude through the official Anthropic SDK when `ANTHROPIC_API_KEY` is set, a deterministic local provider otherwise (development, tests, and companies that keep AI off), the way payments and geocoding work.
- Service summary drafts in the technician app; label reading on the product page; unusual amount flags on the compliance home; churn risk scores (job, report, account badge); portal answers with the office's fallback; AI settings and a monthly call limit.
### Out of scope
- AI that writes or changes application records, notices, credentials or invoices: never (PRD).
- Voice and phone answering: the AI receptionists connect through the API (spec 20).
- Photo identification of pests and route suggestions by AI: not planned for the first build.

## Data
Migration `supabase/migrations/20261101270000_ai.sql`. Every new table has tenant_id, row level security and the write guard.
- `ai_settings` (one per tenant): enabled, summaries, label_reading, portal_answers, churn (booleans, default true), monthly_limit integer (default 2000 calls).
- `ai_runs`: feature (`summary`, `label`, `portal_answer`), provider (`claude`, `local`), model, status (`ok`, `refused`, `failed`, `limited`), input_tokens, output_tokens, ms, subject_id, created_by, created_at. Usage only: no prompt or answer text is kept here.
- `churn_scores`: agreement_id (unique), account_id, score (0 to 100), band (`low`, `medium`, `high`), reasons jsonb (each a code, a sentence and its points), computed_on.
- `portal_questions`: account_id, portal_user_id (the asking login), question, answer, sources jsonb (record ids the answer used), status (`answered`, `waiting`, `answered_by_office`), office_answer, answered_by, answered_at, created_at.
- `visit_notes.kind` gains `customer_summary`: the customer's note for the visit (the latest one is used), with `ai_drafted` boolean.
- Permissions: ai_settings readable by members, changed with settings.write; ai_runs with settings.read; churn_scores with customers.read; portal_questions with customers.read (office answers with customers.write); a portal login reads and asks only for its own account through definer functions.

## Interfaces
- `lib/ai/provider.ts`: `aiProvider()` picks Claude or local; each feature is a typed call (`draftSummary`, `readLabel`, `answerQuestion`) returning its result and usage. `lib/ai/claude.ts`: the Claude client (model `claude-opus-5-5`, low effort for drafting and answers, medium for labels, structured JSON output, refusal handled). `lib/ai/local.ts`: the deterministic provider. `lib/ai/db.ts`: settings, the monthly limit, `ai_runs` logging.
- `lib/ai/churn.ts` (pure): score and reasons from a plan's signals. `lib/ai/churn-db.ts`: signals per active agreement and the daily recompute in the billing job. `lib/ai/amounts.ts` (pure): unusual amounts against the company's own history.
- `lib/ai/portal.ts`: the customer's records as the answer's context (their properties, visits, applications as recorded, invoices, plan, open requests), nothing else.
- Technician app: "Draft a summary" on the completion step (online only), `POST /api/tech/summary-draft`; the edited text is a `customer_summary` note, synced like any note. Messaging: the summary template gains `{{customer_summary}}`, placed above the visit's facts in the default email; the summary page always shows it.
- Office: the product page's "Read the label" (`app/(office)/catalog/products/[productId]`), the compliance home's "Amounts to review", `app/(office)/reports/churn-risk`, the account page's risk badge, portal questions waiting for the office on the requests inbox, `app/(office)/settings/ai`.
- Portal: "Ask a question" on the portal home; the answer, and the office's when it comes.

## Business rules
1. Every AI output is a draft or a flag; a person accepts, edits or ignores it. A summary draft is sent only as the technician saved it; label rows enter a product only when a person saves the product form; amount flags and churn scores change nothing.
2. An AI call happens only when that feature is on and under the company's monthly limit, counted from the start of the month in the company's time zone; a call reserves its place under a lock before the model is asked, outside any transaction, so parallel calls cannot pass the limit; over the limit the feature says so and the person writes it themselves. Each call is logged in `ai_runs` with its usage and outcome, without its text.
3. A summary draft is written from the stop's own capture (notes, conditions found, recommendations, areas and pests, products by name) in plain language for the customer, without rates, EPA numbers or anything not in the capture; the visit summary keeps its factual lines (spec 11, the post-application notice content of spec 07) below the customer note.
4. Label reading returns rate rows in the catalog's shape (site, minimum and maximum rate, rate unit, target pests); rows the reader is unsure of are left out rather than guessed; the label check (spec 06) uses only rows a person saved.
5. An application is flagged when its amount is above the label's maximum (spec 06) or more than three times the company's median for the same product, site and unit over the last 180 days (at least five applications); flags list on the compliance home for licensed managers, newest first.
6. A plan's churn risk is the sum of transparent signals, each with its points and sentence: re-services in the last 90 days, skipped or cancelled visits in the last 180, the account past due, a price increase in the last 60 days, a low survey score (spec 17) in the last 180, an inbound message asking to cancel or complaining in the last 60, a first year, and an overdue visit. Bands: under 30 low, 30 to 59 medium, 60 and over high. Scores are recomputed once a day by the billing job.
7. A portal answer uses only the asking customer's records, given to the model as data; it never reveals another account, staff notes, internal prices or other people's details; it does not give medical or legal advice beyond the label and safety data sheet facts on record, and points health questions to the office and poison control. A question it cannot answer from the records goes to the office as waiting, and the customer sees the office's answer when it comes. A portal login sees only its own questions and asks at most 20 a day (the question takes its place under a lock before the model is asked); an office answer comes back to the top of the list.
8. Without an API key, or with AI off for the company, the local provider answers: summaries from a template of the notes (without rates or EPA numbers), label rows from a pattern reader, portal answers for next visit, last visit, balance and plan; health, safety and action questions, and anything else, go to the office (with Poison Control's number for a possible exposure). A single feature turned off does nothing.

## Edge cases
- The technician is offline: "Draft a summary" is unavailable and they type the note; nothing waits on the network.
- The model refuses or fails: the feature falls back to the person (no draft, or the question goes to the office), and the run is logged as refused or failed.
- A label with several sites: one row per site; a label with no rates in the pasted text: no rows and a note saying so.
- A customer with two properties: the context carries both, labeled by address.
- A plan cancelled since the last score: its score is removed.

## Decisions
- Claude through the official SDK, with a local provider when no key is set: development and tests run without a key, and a company can keep AI off.
- AI drafts, people decide: the PRD's rule, and pesticide records are legal records.
- Churn risk is a transparent points model, not a black box: the office needs the reason to act on it, and it is testable.
- Usage is logged without the text: enough to bound cost and see use, without keeping customers' words twice.

## Open questions
- None blocking.

## Verification
1. `npm test`: `tests/unit/ai.test.ts` (churn points and bands; unusual amounts; the local provider's summary, label rows and portal intents; the portal context holds only the customer's records; the Claude provider builds its request and parses its structured answer, with a stubbed client).
2. `npm run test:rls`: the new tables discovered with seeded rows and guarded; a portal login records and reads only its own account's questions; churn scores and runs hidden from another company.
3. `npm run typecheck && npm run lint && npm test && npx next build` pass.
4. `npm run test:e2e`: `tests/e2e/technician.spec.ts` writes the customer's note offline (drafting says it needs a connection), completes the stop, and the summary carries the note; `tests/e2e/ai.spec.ts`: the technician's draft comes from the stop's capture; the office reads a label into rate rows and saves them; the compliance home lists an unusual amount the test records; the churn report lists a seeded at-risk plan with its reasons; a portal customer asks for their next visit and gets its date, asks something off the record and the office answers it; another company sees none of it. Screenshots go to `test-results/`.
