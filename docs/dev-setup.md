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
```

The RLS suite discovers every table in the `public` schema. A new table without row level security or without a select policy fails it, and a new tenant table needs a seeded Lakeshore row so the isolation checks have something to test against.

## Hosted Supabase and Vercel

Set the same variables in Vercel: `DATABASE_URL` (the project's pooler connection string), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only). Do not set `SUPABASE_AUTH_INTERNAL_URL`. Apply migrations with `npx supabase db push` from a linked project.
