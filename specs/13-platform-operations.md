# Spec 13: Platform operations

Status: done
Depends on: 01 (and reads 03, 05, 07, 08, 10, 11, 12)
Skills to load: pest-domain, pesticide-compliance

## Goal
Bugsy's own staff can run the platform without ever seeing a company's data by default. Support reaches a company's data only through a grant the company's owner approves, for a set number of hours, with every page they open logged where the company can see it. A new company is set up from the console and walks a checklist to its first route; the console shows how far each company has got without showing its data. The shared product catalog and the state rule packs have a console. A company can take all of its data with it at any time, and when it leaves, its records stay readable for each state's retention period: the company goes read only, and its data can only be removed once every record's retention has run out.

## Users and stories
- As platform support, I ask a company for read (or change) access for a few hours with a reason, and once the owner approves I open the company, every page I open logged; when the time is up I am out.
- As a company owner, I see a request on my screen, approve or deny it, see who looked at what and when, and end the access early.
- As a platform admin, I create a company, invite its owner, and see each company's setup progress, size and last activity; I suspend a company (read only, no jobs) or archive one that has left.
- As a new owner, I follow a checklist from company details to the first completed route, each step linking to where it is done.
- As a platform admin, I review the shared product catalog (spec 03) and see the state rule packs: which exist, their rules with sources and dates, and which states the companies serve without a pack.
- As an owner, I download everything the company holds: every table as CSV and every photo, signature and document.
- As the owner of a company that has left, I can still sign in, read and export its records, and nothing can be changed.

## Scope
### In scope
- Support grants: request, approve or deny, expire, revoke; access log; banners for the support user and for the company.
- Company lifecycle: active, suspended, archived; read only for everyone but the platform's own jobs and webhooks when not active; jobs skip companies that are not active; purge only of an archived company whose records are all past retention.
- Onboarding checklist computed from the company's data, on its own page and as progress in the console.
- Console: company overview (counts and dates only), support requests, lifecycle actions, rule packs and state coverage, the product catalog (from spec 03).
- Full company export for owners: `/api/company/export.zip`.
### Out of scope
- Billing companies for Bugsy itself (subscriptions, invoices to companies); the platform fee in Stripe Connect stays zero (spec 08).
- Editing rule packs in the browser: packs are code, reviewed and versioned in `lib/compliance/rules/` (pesticide-compliance skill).
- Point-in-time recovery and the restore drill: hosting configuration, done on the production project, not in the app.
- A support ticket system.

## Data
Migration `supabase/migrations/20261101190000_platform.sql`.
- `tenants` gains `status_reason`, `status_changed_at`, `archived_at` (set when archived, cleared when made active).
- `support_grants`: tenant_id, user_id (the platform admin), access (`read` or `write`), reason, hours (1 to 72), requested_at, approved (null while pending), decided_at, decided_by, expires_at (decided_at plus hours), revoked_at, revoked_by. Written only through definer functions; read by the company's members with audit.read and by the support user. Audited.
- `support_access_log`: tenant_id, grant_id, user_id, path, method, at. Written only through `app.log_support_access`; read like the grants.
- `app.support_access(tenant)`: the caller's live grant's access, or null. `app.is_member` and `app.has_permission` also answer for a live grant: read grants every `.read` permission, write grants every permission except users.write, settings.write and data.import; `app.is_owner` never does.
- `app.guard_tenant_write()`: a trigger on every tenant table (except audit_log, support_grants and support_access_log) that refuses a signed-in user's write to a company that is not active, and any write under a read grant. Jobs, webhooks and the seed (no signed-in user) and platform admins working outside any company's data (product approval) pass.
- `app.onboarding_status(tenant)` (definer; members with settings.read, platform admins): each step's done flag. `app.platform_overview()` (definer; platform admins): per company status, dates, member, account, agreement and visit counts, last activity, steps done, and days from import to first route; no names, addresses or amounts.
- `app.purge_tenant(tenant)` (definer; platform admins): deletes an archived company only when it was archived at least 90 days ago and every application record has a retention date that has passed.

## Interfaces
- `lib/platform/support.ts` (pure): grant state (`pending`, `live`, `expired`, `denied`, `revoked`), the permissions a grant carries, limits.
- `lib/platform/onboarding.ts` (pure): the steps in order with labels and links; `progress(status)`.
- `lib/platform/db.ts`: support requests and decisions, access log, overview, coverage, `exportCompany`.
- `lib/auth/session.ts`: memberships include live grants as support memberships, and each company's status; the first page or action of a request under a grant writes one log row.
- Routes: `app/(office)/settings/support/page.tsx`, `app/(office)/onboarding/page.tsx`, `app/(platform)/admin/tenants/page.tsx` (overview, lifecycle, support), `app/(platform)/admin/rules/page.tsx`, `app/api/company/export.zip/route.ts`.

## Business rules
1. Platform admins belong to no company and see no company data (spec 01 rule 6), except through a live grant. They invite only a new company's first people: their invitation is made while the company has no members, expires within 14 days, and is accepted only while the company still has none. Nobody joins a company that is not active. Platform staff change a company's status and its reason, never its settings.
2. A grant is asked for by a platform admin, for one company, with a reason of at least ten characters, read or write access, and 1 to 72 hours. One open (pending or live) grant per admin per company.
3. Only an owner of the company approves or denies, within 7 days of the request; approval starts the clock: the grant is live from approval until approval plus its hours. An owner, or the support user, ends a live grant at any time.
4. A live read grant reads everything a full read role reads and writes nothing; a write grant also writes, except users, roles, company settings and imports. A grant never makes its holder an owner.
5. Every page, download and action a support user opens under a grant writes a log row (path, method, time), at most one per request; the company's owners and audit.read members see the log and every grant, and the audit trail records each grant's changes.
6. While a request is pending or a grant is live, owners see it on every office page; the support user sees their access and when it ends on every page.
7. A company is active, suspended or archived. Suspended and archived companies are read only for every signed-in user: members still sign in, read, report and export. The scheduled jobs skip them; webhooks still record provider events.
8. Archiving records when; making the company active again clears it. An archived company's data is deleted only by `app.purge_tenant`, and only when it was archived at least 90 days ago and every application record has a retention date in the past. A record whose state pack sets no retention period has no retention date, so its company is never purged (pesticide-compliance skill: keep until a pack says otherwise).
9. The onboarding checklist is derived from data, never ticked by hand: company details (legal name), a branch, every branch's business license number, a service type, a price book item, an enabled product, an applicator credential, the payment account connected, the messaging sender, a second person (member or invitation), customers (an import or an account), a scheduled visit, and a completed visit that was not imported.
10. The console overview shows only counts and dates per company.
11. The full export is for owners: every table that holds the company's rows, as CSV with every column but file contents, run under the owner's session, plus each file's bytes under `files/` and a README listing the tables and row counts. Available while active, suspended or archived.
12. The rule pack console lists each pack's state, version, effective date and every rule with its source and effective date, and every state where a company has properties, with whether a pack covers it.

## Edge cases
- A grant that expires mid-session: the next page has no membership for the company and falls back to the console or the no-company page.
- An owner who is also a platform admin acts as a member; nothing is logged as support.
- A support user asks again after a denial: allowed, as a new request.
- Inviting into a suspended or archived company fails at accept: joining is a write.
- An archived company's owner downloads the inspector export (spec 07): reads work.

## Decisions
- Support access rides on the same row level security as members, through `app.is_member` and `app.has_permission`, so no table needs its own support policy and no service-role path exists for support.
- Read only is one trigger on every tenant table rather than a change to hundreds of policies; the isolation suite checks that every tenant table has it.
- Logging happens in the app at the request boundary (path and method), not per row read: Postgres does not log reads cheaply, and the page is what the company needs to see.
- Packs stay code (reviewed, versioned, cited); the console shows them and where they are missing.
- The Supabase Data API is off (locally in `supabase/config.toml`, and on the hosted project): the app reaches the database only through its server, so every read under a grant passes the access log.
- Pages that only read never write: settings rows are created on first write or read first, and logs of reads (the inspector export's) are skipped when the company is read only.

## Open questions
- Whether support should be able to act with no owner present (an emergency grant approved by two platform admins, shown to the company afterwards). Not built; a company with no reachable owner is handled outside the app.

## Verification
1. `npm test`: `tests/unit/platform.test.ts` (grant states and permissions, onboarding progress order).
2. `npm run test:rls`: support_grants and support_access_log discovered with seeded Lakeshore rows; every tenant table has the write guard; a platform admin sees nothing of a company until an owner approves, then reads it, cannot write under a read grant, and sees nothing once the grant expires or is revoked; only owners decide; the log is written only under a live grant and read by audit.read members; a suspended company refuses its owner's writes; purge refuses an active company and an archived company with records under retention.
3. `npm run typecheck && npm run lint && npm test && npx next build` pass.
4. `npm run test:e2e` runs `tests/e2e/platform.spec.ts`: the platform admin asks Northwind for read access; the owner sees the banner, approves for two hours; the admin opens Northwind from the console, sees customers with the support banner, and a change is refused; the owner sees the admin's pages in the access log and ends the grant, after which the admin cannot open Northwind; the owner walks the onboarding checklist and downloads the full export (accounts.csv, files and README); the admin creates a company, its new owner accepts and adds a branch, the admin archives it, the owner can still read and export but cannot add a branch, and purge is refused. Screenshots go to `test-results/`.
