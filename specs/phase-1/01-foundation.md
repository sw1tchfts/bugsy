# Spec 01: Foundation (tenancy, auth, roles, branches, audit)

Status: ready for review
Depends on: none
Skills to load: pest-domain

## Goal
Stand up the app skeleton and the multi-tenant security model that every later slice relies on. When this ships, a platform admin can create a pest company (tenant) with branches, invite staff with roles, and staff can sign in and see only their own company's data. Getting isolation right now is cheaper than retrofitting it.

## Users and stories
- As a platform admin, I can create a tenant and its first owner so that a new pest company can start onboarding.
- As an owner, I can add branches (licensed business locations) and invite users with a role and optional branch scope.
- As any staff user, I sign in once and see only tenants I belong to; if I belong to several (an outside bookkeeper), I can switch the active tenant.
- As an owner, I can see an audit trail of who changed roles, memberships and settings.

## Scope
### In scope
- Next.js App Router project, TypeScript strict, ESLint, Vitest, Playwright, local Supabase
- Supabase Auth with email magic link and password
- Tables: tenants, branches, memberships, roles, audit_log (see `docs/data-model.md`)
- Database helpers `app.is_member(tenant uuid)` and `app.has_permission(tenant uuid, perm text)`
- RLS on every table, plus the tenant isolation test suite that runs against all tables automatically
- Office app shell: sign in, tenant switcher, settings pages for branches, users and roles
- Platform admin console route, restricted to platform admins
- Seed script with two demo tenants for local development and tests
### Out of scope
- Customer portal accounts (Phase 2)
- SSO, MFA enforcement settings (later)
- Billing tenants for the software (separate spec, later)

## Data
As in `docs/data-model.md` under Platform and tenancy, plus:
- `platform_admins(user_id)`: users with access to the platform console. `tenants` and `platform_admins` are marked `-- shared-table: <reason>` (they have no tenant_id) and still enable row level security, with policies limited to members and platform admins.
- `roles` rows with `tenant_id null` are platform defaults, readable by all signed-in users, writable only by platform admins.
- Default roles: owner, office, dispatcher, technician, sales_rep, compliance_manager, bookkeeper. Permissions are strings such as `customers.read`, `customers.write`, `gl.read`, `settings.write`.

## Interfaces
- `supabase/migrations/<timestamp>_foundation.sql`: tables, enums, helper functions, RLS policies, audit triggers
- `lib/supabase/server.ts`, `lib/supabase/client.ts`: typed clients; generated types in `lib/supabase/types.ts`
- `lib/auth/session.ts`: `getSession()`, `requireMembership(tenantId)`, `requirePermission(tenantId, perm)`
- `lib/tenancy/active-tenant.ts`: reads and sets the active tenant cookie; validates membership server-side
- `app/(auth)/sign-in/page.tsx`, `app/(office)/layout.tsx` with tenant switcher, `app/(office)/settings/{branches,users,roles}/page.tsx`
- `app/(platform)/admin/tenants/page.tsx`
- `scripts/seed.ts`: two tenants (Badger Pest, Lakeshore Exterminating), each with two branches and one user per role
- `tests/rls/tenant-isolation.test.ts`, `tests/e2e/foundation.spec.ts`
- package.json scripts: dev, build, typecheck, lint, test, test:rls, test:e2e, seed

## Business rules
1. Every table with a `tenant_id` column has RLS enabled and policies for select, insert, update and delete that require `app.is_member(tenant_id)`; writes also require the matching permission where one applies.
2. `app.is_member` and `app.has_permission` are `security definer`, `stable`, with a fixed `search_path`, and read `memberships` for `auth.uid()`.
3. A user's active tenant is a UI choice only; the database never trusts it. Server code still filters by the active tenant to avoid mixing data in views.
4. Removing a membership takes effect on the user's next request.
5. Changes to memberships, roles, branches and tenant settings write an `audit_log` row with before and after values.
6. Only platform admins can create tenants. Platform admin support access to tenant data is out of scope here; when added, it must be time-limited and logged.

## Edge cases
- A user invited to a second tenant: both appear in the switcher; data never mixes on one page.
- The last owner of a tenant cannot remove themselves or downgrade their role.
- An invited email that already has an account joins the tenant on accept rather than creating a duplicate user.

## Decisions
- Tenant isolation lives in Postgres RLS, not only in application code, so a bug in one query cannot leak another company's data.
- Branch scope is enforced in the app layer for now (filters and permissions). Revisit if a tenant needs hard branch isolation.

## Open questions
- None blocking. Confirm the stack choice (Next.js, Supabase, Vercel) in the discovery doc before starting.

## Verification
1. `supabase db reset && npm run seed` completes without errors.
2. `npm run test:rls` passes. The suite lists every table in the `public` schema that has a `tenant_id` column, and for each one asserts, signed in as a Badger Pest user: rows from Lakeshore cannot be selected, inserted, updated or deleted. A table missing RLS fails the suite, so new tables are covered without new tests.
3. `npm run typecheck && npm run lint && npm test` pass.
4. `npm run test:e2e` signs in as the Badger owner, creates a branch, invites a technician, and confirms the audit log shows both actions; then signs in as the Lakeshore owner and confirms the Badger branch is not visible. Save screenshots to `test-results/`.
