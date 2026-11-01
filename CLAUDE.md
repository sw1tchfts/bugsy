# Pest control platform

Multi-tenant SaaS for independent pest control companies: CRM, scheduling, technician app, pesticide compliance, billing and a built-in general ledger. Build order and specs: `specs/README.md`. Data model: `docs/data-model.md`.

Scope is pest control only: general pest, rodent, termite, mosquito and tick, bed bug, wildlife. Lawn care, tree and shrub care, and other trades are out of scope; do not add features for them.

## Stack
- Next.js App Router, TypeScript strict, deployed on Vercel
- Supabase: Postgres, Auth, Storage; migrations in `supabase/migrations/`
- Stripe Connect (one connected account per tenant)
- Tests: Vitest for unit and database tests, Playwright for end-to-end

## Commands
Keep this list in sync with package.json. Setup paths are in `docs/dev-setup.md`.
- `npm run dev`, `npm run typecheck`, `npm run lint`, `npm test`
- `npm run test:rls` runs the tenant isolation suite against `DATABASE_URL`; `npm run test:e2e` runs Playwright against the dev server
- `npm run seed` loads the demo companies and users (password in `docs/dev-setup.md`)
- `npm run compliance:run`, `npm run billing:run` and `npm run messaging:run` run the scheduled jobs for every company
- `supabase start`, `supabase db reset`, `supabase migration new <name>` with the Supabase local stack; `npm run db:reset-local` is the stand-in when running native Postgres plus GoTrue instead
- All tenant data access in the app goes through `withRls` in `lib/db.ts`, which runs each query under the signed-in user's claims so row level security applies. Never query tenant tables with the superuser connection from request code. The exceptions are the scheduled jobs and the payment webhook, which have no user: `POST /api/compliance/run`, `POST /api/billing/run` and `POST /api/messaging/run` under their secrets run `lib/compliance/db.ts`, `lib/billing/db.ts` (which ends with `lib/ledger/db.ts`) and `lib/messaging/db.ts` for every tenant, and the webhooks (`POST /api/payments/webhook`, `/api/messaging/twilio`, `/api/messaging/postmark`, and the development-only `/api/messaging/local`) record provider events; a signed-in member runs the same job code under their own session. Public pages with no user (`/m/[token]`, `/u/[token]`, `/invite/[token]`) use `withAnon` and definer functions granted to anon.

## Rules that are easy to get wrong
- Every tenant-owned table has `tenant_id uuid not null`, row level security enabled, and policies that call `app.is_member(tenant_id)`. Shared tables carry a `-- shared-table: <reason>` comment. A hook rejects migrations that break this.
- A new tenant table also gets the read-only guard: `create trigger tenant_write_guard before insert or update or delete on public.<table> for each row execute function app.guard_tenant_write();`. The isolation suite fails without it.
- IMPORTANT: never edit a committed migration. Add a new one.
- Money is integer cents (`bigint`), never floating point. Rates are `numeric`.
- Pesticide application records are immutable once locked. Corrections are amendment rows.
- State rules live as data in one rule pack per state, `lib/compliance/rules/<state>.ts`, applied by the treated property's state. Never hardcode a notice window, retention period, license rule or blackout date anywhere else.
- Store timestamps as `timestamptz` in UTC. Business dates use the tenant's time zone.
- An account pays; a property is where work happens. Notices go to the people at the property, which is not always the account.
- A visit's arrival and departure times are the legal application start and end times.

## Workflow
- Work from a spec in `specs/`. If the feature has no finished spec, run `/write-spec` first.
- Plan before any multi-file change. Implement with `/implement-spec <path>`.
- Before calling work done, run typecheck, tests and the spec's verification step, and show the output.
- Load `pesticide-compliance` for licensing, records, notices or scheduling restrictions (and its `states/<state>.md` for the state at hand); `pest-accounting` for invoices, revenue, tax or the GL; `pest-domain` for industry terms.
- Verification fixtures in `fixtures/` are the source of truth for expected numbers. If code and a fixture disagree, stop and ask; do not edit the fixture to make a test pass.
