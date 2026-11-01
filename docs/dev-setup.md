# Local development

Bugsy runs against Supabase (Postgres, Auth) and deploys to Vercel. Locally there are two ways to get the same database and auth server. Both use the migrations in `supabase/migrations/`, so what runs locally is what runs hosted.

## Option A: the Supabase local stack (needs Docker)

The standard path and the one CLAUDE.md's commands assume.

```bash
npm install
npx supabase start          # prints the API URL, anon key and service role key
cp .env.example .env.local  # paste the keys; DATABASE_URL is already right for the local stack
npx supabase db reset       # applies every migration
npm run seed                # two demo companies, one user per role, a platform admin
npm run dev
```

## Option B: native Postgres plus GoTrue (no Docker image pulls larger than a few MB)

Used in environments where the Supabase images cannot be pulled. Postgres runs natively; Supabase's auth server (GoTrue) runs on its own; the app forwards `/auth/v1/*` to it.

1. Start Postgres 16 or 17 on port 54322 with the `postgres` superuser and trust auth for localhost.
2. Create the auth roles and schema, then start GoTrue (see the `docker run` in the commit history of this file, or any GoTrue v2 setup) with `DATABASE_URL=postgres://supabase_auth_admin:postgres@127.0.0.1:54322/postgres?search_path=auth`, `GOTRUE_JWT_SECRET` set, `GOTRUE_MAILER_AUTOCONFIRM=true`, listening on 9999.
3. `.env.local`:

   ```
   DATABASE_URL=postgres://postgres@127.0.0.1:54322/postgres
   NEXT_PUBLIC_SUPABASE_URL=http://localhost:3000
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon JWT signed with the secret>
   SUPABASE_SERVICE_ROLE_KEY=<service_role JWT signed with the secret>
   SUPABASE_AUTH_INTERNAL_URL=http://127.0.0.1:9999
   ```

4. `npm run db:reset-local` applies `scripts/db-shim.sql` (Supabase's `auth.uid()` and friends, the API roles), every migration, and the seed.

Magic links need an email server; locally, sign in with a seeded password instead.

## Seeded users

Password for all of them: `bugsy-dev-password`.

- Platform admin: `admin@bugsy.test` (no company; opens the platform console)
- Northwind Pest Control: `owner@northwind.test`, `office@northwind.test`, `dispatcher@northwind.test`, `technician@northwind.test`, `sales-rep@northwind.test`, `compliance-manager@northwind.test`, `bookkeeper@northwind.test`
- Lakeshore Exterminating: the same roles at `@lakeshore.test`

## Checks

```bash
npm run typecheck
npm run lint
npm test            # unit tests
npm run test:rls    # tenant isolation suite against DATABASE_URL
npm run test:e2e    # Playwright against the dev server; screenshots land in test-results/
npm run db:types    # regenerate lib/supabase/types.ts after a migration
npm run compliance:run  # the compliance job for every company: records, locks, notices, alert tasks
npm run billing:run     # the billing job for every company: invoices, autopay, past due, late fees
```

The compliance job is idempotent and meant to run hourly. On Vercel, a cron calls `POST /api/compliance/run` with the `x-compliance-secret` header set to `COMPLIANCE_RUN_SECRET`; locally the script above does the same, and a licensed manager can press "Run the compliance job now" on the Compliance page for their own company.

The billing job is idempotent too and meant to run daily after midnight in each company's zone, hourly is fine. On Vercel, a cron calls `POST /api/billing/run` with the `x-billing-secret` header set to `BILLING_RUN_SECRET` (it falls back to `COMPLIANCE_RUN_SECRET`); locally the script above does the same, and anyone with billing write access can press "Run the billing job now" on the Billing page for their own company. It issues per-visit invoices for completed stops, the installments and prepayments whose dates have come, applies unallocated credit, charges autopay on due dates with retries on the configured days, marks invoices past due after the grace period, and adds late fees. It ends with the ledger's work (spec 09): a sweep that posts any business event still without its journal entry, the local gateway's payouts for the previous days' card money, and the period-end reclass for every ended month still open.

### Messages locally

Without provider keys, email, texts and letters go through local providers that record and deliver in the database: an email to a domain ending in `.bounce.test` bounces, a text to a number ending in `0000` fails, everything else is delivered. Every message is on the account's page and in Messages, with a public link at `/m/<token>`. A customer's text is simulated with:

```bash
curl -s -X POST localhost:3000/api/messaging/local -H 'content-type: application/json' -d '{"tenant":"Northwind Pest Control","from":"614-555-0100","body":"STOP"}'
```

`npm run messaging:run` (or "Send what is due now") queues reminders and due notices and sends what is due; on Vercel a cron calls `POST /api/messaging/run` every few minutes with `x-messaging-secret`. For Twilio, point the number's messaging webhook and status callback at `/api/messaging/twilio`; for Postmark, the delivery, bounce and complaint webhooks at `/api/messaging/postmark?secret=<POSTMARK_WEBHOOK_SECRET>`.

### Go-live import

Settings, Import takes the five CSV templates (download them from the page) and a go-live date. A dry run shows every row error and writes nothing; Import writes everything or nothing. `fixtures/import/` holds a sample set, and each demo company was seeded by importing it with go-live 2026-10-01, so the agreements G-1 to G-5 show visits done before Bugsy and opening contract balances.

### Payments locally

Without `STRIPE_SECRET_KEY` the gateway is the local one: the same flows, ids and webhook shapes as Stripe Connect, with nothing leaving the machine and no card data kept (only brand, last four and expiry). Test numbers for the office's "add a payment method" form:

- any card number with a valid length is approved, for example `4242 4242 4242 4242`
- a card ending `0002` is declined on every charge
- a card ending `0341` fails its first autopay attempt and succeeds on the retry
- a bank account is any routing-free account number; the last four are kept

With `STRIPE_SECRET_KEY` set, "Connect Stripe" on the billing settings page starts Stripe Connect onboarding for the company (a Standard account; charges are direct charges on it with `PLATFORM_FEE_BPS` as the application fee), and `POST /api/payments/webhook` verifies events with `STRIPE_WEBHOOK_SECRET` and records them idempotently in `gateway_events`.

The RLS suite discovers every table in the `public` schema. A new table without row level security or without a select policy fails it, and a new tenant table needs a seeded Lakeshore row so the isolation checks have something to test against.

The technician app's offline reload (service worker shell plus the route in IndexedDB) only hydrates on a production server: the dev server's HMR runtime waits for a connection. `tests/e2e/technician.spec.ts` notices which server it talks to; to exercise the reload path run it against a build:

```bash
npm run build && npx next start -p 3001
E2E_BASE_URL=http://localhost:3001 npx playwright test tests/e2e/technician.spec.ts
```

## Native wrapper (packaging, not yet built)

The technician app is the web layer of the native wrapper the PRD chose: a Capacitor project per platform wraps `/tech` and adds what a browser cannot do well (truck printer, card reader and tap-to-pay plugins, background sync, push). Nothing in the screens changes for it; the wrapper needs the iOS and Android toolchains, which this environment lacks, so it is a packaging step for a machine that has them: `npm i @capacitor/core @capacitor/cli`, `npx cap init`, point `server.url` at the deployment, then `npx cap add ios` and `npx cap add android`.

## Hosted Supabase and Vercel

Set the same variables in Vercel: `DATABASE_URL` (the project's pooler connection string), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only), the job secrets `COMPLIANCE_RUN_SECRET` and `BILLING_RUN_SECRET` for the crons, and for live payments `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `PLATFORM_FEE_BPS`. Do not set `SUPABASE_AUTH_INTERNAL_URL`. Apply migrations with `npx supabase db push` from a linked project.

Turn the Data API off on the hosted project (Project Settings, Data API), or expose no schemas. The app reaches the database only through its own server; a session token used directly against `/rest/v1` would read under row level security without the support access log (spec 13).

## Windows

Double-click `start-bugsy.bat` in the project folder (Node.js and Docker Desktop installed, Docker running). The first run installs packages, starts the local Supabase stack, writes `.env.local` from it, builds the database and loads the demo companies; later runs just start the database and the app and open http://localhost:3000. Delete `.bugsy-seeded` to rebuild the demo data on the next run.
