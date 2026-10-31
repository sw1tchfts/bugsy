-- Spec 01: foundation. Tenancy, auth helpers, roles, memberships, invitations, branches and audit.
-- Every tenant-owned table carries tenant_id and row level security; platform-wide tables are marked shared.

create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- shared-table: the list of pest companies; each row is visible only to its members and to platform admins
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  timezone text not null,
  stripe_account_id text,
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.tenants enable row level security;

-- shared-table: users with access to the platform console; they belong to no tenant
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.platform_admins enable row level security;

-- Roles are bundles of permission strings. Rows with tenant_id null are platform defaults that every
-- tenant can use; tenants copy a default and edit the copy.
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  description text,
  permissions text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create unique index roles_tenant_key
  on public.roles (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
alter table public.roles enable row level security;

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id),
  branch_ids uuid[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, user_id)
);
comment on column public.memberships.branch_ids is 'Null means every branch of the tenant.';
alter table public.memberships enable row level security;

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  role_id uuid not null references public.roles(id),
  branch_ids uuid[],
  token uuid not null unique default gen_random_uuid(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.invitations enable row level security;

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  address text not null,
  state_code text not null check (state_code ~ '^[A-Z]{2}$'),
  business_license_number text,
  license_year integer check (license_year between 2000 and 2100),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, name)
);
alter table public.branches enable row level security;

-- Written only by triggers. tenant_id is null for platform-level rows such as default roles.
create table public.audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.tenants(id),
  actor_id uuid,
  table_name text not null,
  row_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_tenant_created on public.audit_log (tenant_id, created_at desc);
alter table public.audit_log enable row level security;

-- ---------------------------------------------------------------------------
-- Helper functions. Security definer, stable, fixed search_path; they read memberships for auth.uid().
-- ---------------------------------------------------------------------------

create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.platform_admins p where p.user_id = auth.uid());
$$;

create or replace function app.is_member(tenant uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = tenant and m.user_id = auth.uid()
  );
$$;

create or replace function app.has_permission(tenant uuid, perm text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.memberships m
    join public.roles r on r.id = m.role_id
    where m.tenant_id = tenant
      and m.user_id = auth.uid()
      and (r.permissions @> array[perm] or r.permissions @> array['*'])
  );
$$;

create or replace function app.role_is_owner(role uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.roles r where r.id = role and r.permissions @> array['*']);
$$;

-- Members' sign-in emails come from auth.users, which the office app cannot read directly.
create or replace function app.member_directory(tenant uuid)
returns table (user_id uuid, email text, last_sign_in_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, u.email::text, u.last_sign_in_at
  from public.memberships m
  join auth.users u on u.id = m.user_id
  where m.tenant_id = tenant and app.is_member(tenant);
$$;

-- What an invitee may learn from their token before accepting: the company, the role and whether it still stands.
create or replace function app.invitation_preview(invite_token uuid)
returns table (tenant_name text, email text, role_name text, valid boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.name, i.email, r.name, (i.accepted_at is null and i.expires_at >= now())
  from public.invitations i
  join public.tenants t on t.id = i.tenant_id
  join public.roles r on r.id = i.role_id
  where i.token = invite_token;
$$;

-- Accepting an invitation joins the signed-in user to the tenant. An email that already has an account
-- gets a membership on its existing user, never a duplicate user.
create or replace function app.accept_invitation(invite_token uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inv public.invitations;
  uid uuid := auth.uid();
  mail text := lower(coalesce(auth.email(), ''));
  membership_id uuid;
begin
  if uid is null then
    raise exception 'sign in before accepting an invitation' using errcode = '28000';
  end if;
  select * into inv from public.invitations where token = invite_token for update;
  if not found or inv.accepted_at is not null or inv.expires_at < now() then
    raise exception 'this invitation is no longer valid' using errcode = 'P0002';
  end if;
  if inv.email <> mail then
    raise exception 'this invitation was sent to a different email address' using errcode = '42501';
  end if;
  insert into public.memberships (tenant_id, user_id, role_id, branch_ids, created_by)
  values (inv.tenant_id, uid, inv.role_id, inv.branch_ids, inv.created_by)
  on conflict (tenant_id, user_id) do update
    set role_id = excluded.role_id, branch_ids = excluded.branch_ids
  returning id into membership_id;
  update public.invitations set accepted_at = now(), accepted_by = uid where id = inv.id;
  return membership_id;
end $$;

revoke all on function app.is_platform_admin() from public;
revoke all on function app.is_member(uuid) from public;
revoke all on function app.has_permission(uuid, text) from public;
revoke all on function app.role_is_owner(uuid) from public;
revoke all on function app.member_directory(uuid) from public;
revoke all on function app.accept_invitation(uuid) from public;
revoke all on function app.invitation_preview(uuid) from public;
grant execute on function app.invitation_preview(uuid) to anon, authenticated, service_role;
grant execute on function app.is_platform_admin() to authenticated, service_role;
grant execute on function app.is_member(uuid) to authenticated, service_role;
grant execute on function app.has_permission(uuid, text) to authenticated, service_role;
grant execute on function app.role_is_owner(uuid) to authenticated, service_role;
grant execute on function app.member_directory(uuid) to authenticated, service_role;
grant execute on function app.accept_invitation(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Triggers: updated_at, data checks, last-owner protection, audit
-- ---------------------------------------------------------------------------

create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- A membership's role must be a platform default or belong to the same tenant, and its branches must too.
create or replace function app.check_membership() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  role_tenant uuid;
  owned integer;
begin
  select r.tenant_id into role_tenant from public.roles r where r.id = new.role_id;
  if not found then
    raise exception 'role % does not exist', new.role_id using errcode = '23503';
  end if;
  if role_tenant is not null and role_tenant <> new.tenant_id then
    raise exception 'role belongs to another tenant' using errcode = '23514';
  end if;
  if new.branch_ids is not null then
    select count(*) into owned from public.branches b
    where b.id = any(new.branch_ids) and b.tenant_id = new.tenant_id;
    if owned <> cardinality(new.branch_ids) then
      raise exception 'branch scope includes a branch of another tenant' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- The last owner of a tenant cannot be removed or downgraded.
create or replace function app.protect_last_owner() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  others integer;
begin
  if not app.role_is_owner(old.role_id) then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.tenant_id = old.tenant_id and app.role_is_owner(new.role_id) then
    return new;
  end if;
  select count(*) into others from public.memberships m
  where m.tenant_id = old.tenant_id and m.id <> old.id and app.role_is_owner(m.role_id);
  if others = 0 then
    raise exception 'a tenant must keep at least one owner' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;

-- A role that makes its holders owners cannot lose that power while it is the tenant's only source of owners.
create or replace function app.protect_owner_role() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  others integer;
begin
  if old.permissions @> array['*'] and not new.permissions @> array['*'] and old.tenant_id is not null then
    select count(*) into others from public.memberships m
    where m.tenant_id = old.tenant_id and m.role_id <> old.id and app.role_is_owner(m.role_id);
    if others = 0 and exists (select 1 from public.memberships m where m.role_id = old.id) then
      raise exception 'a tenant must keep at least one owner' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create or replace function app.write_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  tenant uuid;
  row_uuid uuid;
begin
  if tg_table_name = 'tenants' then
    tenant := coalesce(new.id, old.id);
  else
    tenant := coalesce(new.tenant_id, old.tenant_id);
  end if;
  row_uuid := coalesce(new.id, old.id);
  insert into public.audit_log (tenant_id, actor_id, table_name, row_id, action, before, after)
  values (
    tenant, auth.uid(), tg_table_name, row_uuid, lower(tg_op),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger tenants_updated_at before update on public.tenants for each row execute function app.set_updated_at();
create trigger roles_updated_at before update on public.roles for each row execute function app.set_updated_at();
create trigger memberships_updated_at before update on public.memberships for each row execute function app.set_updated_at();
create trigger invitations_updated_at before update on public.invitations for each row execute function app.set_updated_at();
create trigger branches_updated_at before update on public.branches for each row execute function app.set_updated_at();

create trigger memberships_check before insert or update on public.memberships for each row execute function app.check_membership();
create trigger memberships_last_owner before update or delete on public.memberships for each row execute function app.protect_last_owner();
create trigger roles_owner_power before update on public.roles for each row execute function app.protect_owner_role();

create trigger tenants_audit after insert or update or delete on public.tenants for each row execute function app.write_audit();
create trigger roles_audit after insert or update or delete on public.roles for each row execute function app.write_audit();
create trigger memberships_audit after insert or update or delete on public.memberships for each row execute function app.write_audit();
create trigger invitations_audit after insert or update or delete on public.invitations for each row execute function app.write_audit();
create trigger branches_audit after insert or update or delete on public.branches for each row execute function app.write_audit();

-- ---------------------------------------------------------------------------
-- Row level security policies
-- ---------------------------------------------------------------------------

create policy tenants_select on public.tenants for select to authenticated
  using (app.is_member(id) or app.is_platform_admin());
create policy tenants_insert on public.tenants for insert to authenticated
  with check (app.is_platform_admin());
create policy tenants_update on public.tenants for update to authenticated
  using (app.has_permission(id, 'settings.write') or app.is_platform_admin())
  with check (app.has_permission(id, 'settings.write') or app.is_platform_admin());

create policy platform_admins_select on public.platform_admins for select to authenticated
  using (user_id = auth.uid() or app.is_platform_admin());
create policy platform_admins_insert on public.platform_admins for insert to authenticated
  with check (app.is_platform_admin());
create policy platform_admins_delete on public.platform_admins for delete to authenticated
  using (app.is_platform_admin() and user_id <> auth.uid());

create policy roles_select on public.roles for select to authenticated
  using (tenant_id is null or app.is_member(tenant_id));
create policy roles_insert on public.roles for insert to authenticated
  with check (
    (tenant_id is null and app.is_platform_admin())
    or (tenant_id is not null and app.has_permission(tenant_id, 'settings.write'))
  );
create policy roles_update on public.roles for update to authenticated
  using (
    (tenant_id is null and app.is_platform_admin())
    or (tenant_id is not null and app.has_permission(tenant_id, 'settings.write'))
  )
  with check (
    (tenant_id is null and app.is_platform_admin())
    or (tenant_id is not null and app.has_permission(tenant_id, 'settings.write'))
  );
create policy roles_delete on public.roles for delete to authenticated
  using (tenant_id is not null and app.has_permission(tenant_id, 'settings.write'));

create policy memberships_select on public.memberships for select to authenticated
  using (app.is_member(tenant_id));
create policy memberships_insert on public.memberships for insert to authenticated
  with check (app.has_permission(tenant_id, 'users.write'));
create policy memberships_update on public.memberships for update to authenticated
  using (app.has_permission(tenant_id, 'users.write'))
  with check (app.has_permission(tenant_id, 'users.write'));
create policy memberships_delete on public.memberships for delete to authenticated
  using (app.has_permission(tenant_id, 'users.write'));

-- Platform admins may read and create invitations so they can invite a new tenant's first owner.
create policy invitations_select on public.invitations for select to authenticated
  using (app.has_permission(tenant_id, 'users.read') or app.has_permission(tenant_id, 'users.write') or app.is_platform_admin());
create policy invitations_insert on public.invitations for insert to authenticated
  with check (app.has_permission(tenant_id, 'users.write') or app.is_platform_admin());
create policy invitations_update on public.invitations for update to authenticated
  using (app.has_permission(tenant_id, 'users.write'))
  with check (app.has_permission(tenant_id, 'users.write'));
create policy invitations_delete on public.invitations for delete to authenticated
  using (app.has_permission(tenant_id, 'users.write'));

create policy branches_select on public.branches for select to authenticated
  using (app.is_member(tenant_id));
create policy branches_insert on public.branches for insert to authenticated
  with check (app.has_permission(tenant_id, 'settings.write'));
create policy branches_update on public.branches for update to authenticated
  using (app.has_permission(tenant_id, 'settings.write'))
  with check (app.has_permission(tenant_id, 'settings.write'));
create policy branches_delete on public.branches for delete to authenticated
  using (app.has_permission(tenant_id, 'settings.write'));

-- Audit rows are written by triggers only; nobody inserts, updates or deletes them directly.
create policy audit_log_select on public.audit_log for select to authenticated
  using (
    (tenant_id is not null and app.has_permission(tenant_id, 'audit.read'))
    or app.is_platform_admin()
  );

-- ---------------------------------------------------------------------------
-- Grants. Row level security does the filtering; these let the API roles reach the tables at all.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage on all sequences in schema public to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Platform default roles
-- ---------------------------------------------------------------------------

insert into public.roles (tenant_id, key, name, description, permissions) values
  (null, 'owner', 'Owner', 'Everything in the tenant, including settings, pricing, the ledger and user management.',
    array['*']),
  (null, 'office', 'Office staff', 'Customers, agreements, scheduling, billing and collections; no ledger settings or payroll data.',
    array['customers.read', 'customers.write', 'agreements.read', 'agreements.write', 'dispatch.read', 'visits.read',
          'billing.read', 'billing.write', 'reports.read', 'settings.read', 'users.read']),
  (null, 'dispatcher', 'Dispatcher', 'Dispatch board, routes, technician workloads and the re-service queue.',
    array['customers.read', 'agreements.read', 'dispatch.read', 'dispatch.write', 'visits.read', 'visits.write', 'reports.read']),
  (null, 'technician', 'Technician', 'Own route, visit records, truck inventory and limited customer details.',
    array['dispatch.read', 'visits.read', 'visits.write', 'customers.read']),
  (null, 'sales_rep', 'Sales rep', 'Leads, quotes, own accounts and own commissions.',
    array['customers.read', 'customers.write', 'agreements.read', 'agreements.write', 'reports.read']),
  (null, 'compliance_manager', 'Licensed manager', 'Licenses, application records, notices and inspector exports.',
    array['compliance.read', 'compliance.write', 'visits.read', 'customers.read', 'reports.read', 'users.read']),
  (null, 'bookkeeper', 'Bookkeeper', 'Ledger, reports and reconciliations; read-only elsewhere.',
    array['gl.read', 'gl.write', 'billing.read', 'reports.read', 'customers.read', 'agreements.read']);
