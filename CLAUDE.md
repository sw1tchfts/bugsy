# Pest control platform

Multi-tenant SaaS for independent pest control companies: CRM, scheduling, technician app, pesticide compliance, billing and a built-in general ledger. Build order and specs: `specs/README.md`. Data model: `docs/data-model.md`.

Scope is pest control only: general pest, rodent, termite, mosquito and tick, bed bug, wildlife. Lawn care, tree and shrub care, and other trades are out of scope; do not add features for them.

## Stack
- Next.js App Router, TypeScript strict, deployed on Vercel
- Supabase: Postgres, Auth, Storage; migrations in `supabase/migrations/`
- Stripe Connect (one connected account per tenant)
- Tests: Vitest for unit and database tests, Playwright for end-to-end

## Commands
Spec 01 creates these scripts; keep this list in sync with package.json.
- `npm run dev`, `npm run typecheck`, `npm run lint`, `npm test`
- `npm run test:rls` runs the tenant isolation suite against the local database
- `supabase start`, `supabase db reset`, `supabase migration new <name>`

## Rules that are easy to get wrong
- Every tenant-owned table has `tenant_id uuid not null`, row level security enabled, and policies that call `app.is_member(tenant_id)`. Shared tables carry a `-- shared-table: <reason>` comment. A hook rejects migrations that break this.
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
