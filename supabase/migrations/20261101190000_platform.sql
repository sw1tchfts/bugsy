-- Spec 13: platform operations. Support access through owner-approved, time-limited grants that ride on the same row
-- level security as members; every page under a grant logged for the company; the company lifecycle with a write guard
-- on every tenant table; the onboarding checklist and the console overview as counts; a purge that waits out retention.

-- ---------------------------------------------------------------------------
-- Company lifecycle (rules 7 and 8)
-- ---------------------------------------------------------------------------

alter table public.tenants add column status_reason text;
alter table public.tenants add column status_changed_at timestamptz;
alter table public.tenants add column archived_at timestamptz;

create or replace function app.tenant_status_change() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    new.archived_at := case when new.status = 'archived' then now() when new.status = 'active' then null else old.archived_at end;
  end if;
  return new;
end $$;
create trigger tenants_status before update of status on public.tenants for each row execute function app.tenant_status_change();

-- Members keep their company's details, never its lifecycle: only platform staff change status, and a company that is
-- not active is read only to its members here too (the tenants row has no tenant_id for the general write guard).
create or replace function app.guard_tenant_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or app.is_platform_admin() then return new; end if;
  if old.status <> 'active' then raise exception 'this company is % and read only', old.status using errcode = '42501'; end if;
  if new.status is distinct from old.status or new.status_reason is distinct from old.status_reason or new.archived_at is distinct from old.archived_at
     or new.status_changed_at is distinct from old.status_changed_at then
    raise exception 'only platform staff change a company''s status' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger tenants_guard before update on public.tenants for each row execute function app.guard_tenant_row();

-- shared-table: a platform record that a company's data was removed; the company row itself is gone
create table public.tenant_purges (
  id uuid primary key default gen_random_uuid(),
  former_tenant_id uuid not null,
  name text not null,
  archived_at timestamptz,
  purged_at timestamptz not null default now(),
  purged_by uuid references auth.users(id) on delete set null,
  row_counts jsonb not null default '{}'::jsonb
);
alter table public.tenant_purges enable row level security;
create policy tenant_purges_select on public.tenant_purges for select to authenticated using (app.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Support grants and the access log (rules 1 to 6)
-- ---------------------------------------------------------------------------

create table public.support_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null,
  access text not null check (access in ('read', 'write')),
  reason text not null check (length(trim(reason)) between 10 and 500),
  hours integer not null check (hours between 1 and 72),
  requested_at timestamptz not null default now(),
  approved boolean,
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_grants_decided check ((approved is null) = (decided_at is null)),
  constraint support_grants_expiry check (approved is not true or expires_at is not null)
);
alter table public.support_grants enable row level security;
create index support_grants_tenant on public.support_grants (tenant_id, requested_at desc);
create index support_grants_user on public.support_grants (user_id, tenant_id);
create trigger support_grants_updated_at before update on public.support_grants for each row execute function app.set_updated_at();
create trigger support_grants_audit after insert or update or delete on public.support_grants for each row execute function app.write_audit();

create table public.support_access_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  grant_id uuid not null references public.support_grants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  path text not null,
  method text not null default 'GET',
  created_at timestamptz not null default now()
);
alter table public.support_access_log enable row level security;
create index support_access_log_tenant on public.support_access_log (tenant_id, created_at desc);

-- The caller's live grant on a company, 'write' over 'read', or null. Only platform staff hold grants.
create or replace function app.support_access(p_tenant uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case when bool_or(g.access = 'write') then 'write' when count(*) > 0 then 'read' end
  from public.support_grants g
  where g.tenant_id = p_tenant and g.user_id = auth.uid() and g.approved and g.revoked_at is null and now() < g.expires_at
    and exists (select 1 from public.platform_admins p where p.user_id = auth.uid());
$$;
revoke all on function app.support_access(uuid) from public;
grant execute on function app.support_access(uuid) to authenticated, service_role;

-- Membership, or a live grant (rule 1). Every tenant policy calls this, so support needs no policy of its own.
create or replace function app.is_member(tenant uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.memberships m where m.tenant_id = tenant and m.user_id = auth.uid())
      or app.support_access(tenant) is not null;
$$;

-- A role's permission, or what a live grant carries (rule 4): read grants every .read; write grants all but people,
-- settings and imports. Ownership never comes from a grant (app.is_owner reads memberships only).
create or replace function app.has_permission(tenant uuid, perm text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
           select 1 from public.memberships m join public.roles r on r.id = m.role_id
           where m.tenant_id = tenant and m.user_id = auth.uid() and (r.permissions @> array[perm] or r.permissions @> array['*']))
      or case app.support_access(tenant)
           when 'read' then perm like '%.read'
           when 'write' then perm <> all (array['users.write', 'settings.write', 'data.import', '*'])
           else false end;
$$;

-- Platform staff invite only a new company's first people (a company with no members yet). Spec 01 let them invite into
-- any company, which would let an admin invite themselves in and skip the owner's approval (rule 1).
create or replace function app.tenant_has_members(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.memberships m where m.tenant_id = p_tenant);
$$;
revoke all on function app.tenant_has_members(uuid) from public;
grant execute on function app.tenant_has_members(uuid) to authenticated, service_role;
drop policy invitations_insert on public.invitations;
create policy invitations_insert on public.invitations for insert to authenticated
  with check (app.has_permission(tenant_id, 'users.write') or (app.is_platform_admin() and not app.tenant_has_members(tenant_id)));

-- Grants: read by the company's audit.read members, and by the support user, whose own requests they are. The log: by
-- the company's audit.read members (a live read grant carries audit.read, so support sees it only while inside).
create policy support_grants_select on public.support_grants for select to authenticated
  using ((app.is_member(tenant_id) and app.has_permission(tenant_id, 'audit.read')) or user_id = auth.uid());
create policy support_access_log_select on public.support_access_log for select to authenticated
  using (app.is_member(tenant_id) and app.has_permission(tenant_id, 'audit.read'));

-- Rule 2: platform staff ask, with a reason, read or write, 1 to 72 hours; one open request or grant at a time.
create or replace function app.request_support(p_tenant uuid, p_access text, p_hours integer, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if not app.is_platform_admin() then raise exception 'only platform staff ask for support access' using errcode = '42501'; end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then raise exception 'no such company' using errcode = '23514'; end if;
  if exists (select 1 from public.support_grants g
             where g.tenant_id = p_tenant and g.user_id = auth.uid() and g.revoked_at is null
               and ((g.approved is null and g.requested_at > now() - interval '7 days') or (g.approved and now() < g.expires_at))) then
    raise exception 'a request for this company is already open' using errcode = '23514';
  end if;
  insert into public.support_grants (tenant_id, user_id, user_email, access, reason, hours)
  values (p_tenant, auth.uid(), (select u.email from auth.users u where u.id = auth.uid()), p_access, trim(coalesce(p_reason, '')), p_hours)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function app.request_support(uuid, text, integer, text) from public;
grant execute on function app.request_support(uuid, text, integer, text) to authenticated, service_role;

-- Rule 3: an owner approves or denies within 7 days; approval starts the clock.
create or replace function app.decide_support(p_grant uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g record;
begin
  select * into g from public.support_grants where id = p_grant for update;
  if g.id is null then raise exception 'no such request' using errcode = '23514'; end if;
  if not app.is_owner(g.tenant_id) then raise exception 'only an owner of the company decides' using errcode = '42501'; end if;
  if g.approved is not null or g.revoked_at is not null then raise exception 'this request is already decided' using errcode = '23514'; end if;
  if g.requested_at < now() - interval '7 days' then raise exception 'this request lapsed after 7 days' using errcode = '23514'; end if;
  update public.support_grants
  set approved = p_approve, decided_at = now(), decided_by = auth.uid(), expires_at = case when p_approve then now() + make_interval(hours => g.hours) end
  where id = p_grant;
end $$;
revoke all on function app.decide_support(uuid, boolean) from public;
grant execute on function app.decide_support(uuid, boolean) to authenticated, service_role;

-- Rule 3: an owner, or the support user, ends a live grant or withdraws a pending request.
create or replace function app.revoke_support(p_grant uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g record;
begin
  select * into g from public.support_grants where id = p_grant for update;
  if g.id is null then raise exception 'no such grant' using errcode = '23514'; end if;
  if not (app.is_owner(g.tenant_id) or g.user_id = auth.uid()) then raise exception 'only an owner or the support user ends access' using errcode = '42501'; end if;
  if g.revoked_at is not null or g.approved is false or (g.approved and now() >= g.expires_at) then raise exception 'this access has already ended' using errcode = '23514'; end if;
  update public.support_grants set revoked_at = now(), revoked_by = auth.uid() where id = p_grant;
end $$;
revoke all on function app.revoke_support(uuid) from public;
grant execute on function app.revoke_support(uuid) to authenticated, service_role;

-- Rule 5: one row per page, download or action under a live grant; a member is never logged as support.
create or replace function app.log_support_access(p_tenant uuid, p_path text, p_method text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_grant uuid;
begin
  if exists (select 1 from public.memberships m where m.tenant_id = p_tenant and m.user_id = auth.uid()) then return; end if;
  select g.id into v_grant from public.support_grants g
  where g.tenant_id = p_tenant and g.user_id = auth.uid() and g.approved and g.revoked_at is null and now() < g.expires_at
  order by (g.access = 'write') desc, g.decided_at desc limit 1;
  if v_grant is null then return; end if;
  insert into public.support_access_log (tenant_id, grant_id, user_id, path, method)
  values (p_tenant, v_grant, auth.uid(), left(coalesce(nullif(p_path, ''), '(unknown)'), 500), upper(left(coalesce(nullif(p_method, ''), 'GET'), 10)));
end $$;
revoke all on function app.log_support_access(uuid, text, text) from public;
grant execute on function app.log_support_access(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The write guard (rules 4 and 7)
-- ---------------------------------------------------------------------------

-- A signed-in user writes only to an active company, and never under a read grant. No signed-in user (jobs, webhooks,
-- the seed) passes; so does a platform admin working outside any company's data, such as approving a product.
create or replace function app.guard_tenant_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid;
  v_status text;
  v_access text;
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then v_tenant := old.tenant_id; else v_tenant := new.tenant_id; end if;
  if v_tenant is not null then
    if not exists (select 1 from public.memberships m where m.tenant_id = v_tenant and m.user_id = auth.uid()) then
      v_access := app.support_access(v_tenant);
      if v_access = 'read' then raise exception 'support access to this company is read only' using errcode = '42501'; end if;
      if v_access is null and app.is_platform_admin() then
        if tg_op = 'DELETE' then return old; end if;
        return new;
      end if;
    end if;
    select status into v_status from public.tenants where id = v_tenant;
    if v_status is distinct from 'active' then
      raise exception 'this company is % and read only', coalesce(v_status, 'gone') using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function app.guard_tenant_write() from public;

-- Every tenant table but the trail itself and the support tables (a company that is read only still records who looked).
do $$
declare
  t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and exists (select 1 from information_schema.columns col where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'tenant_id')
      and c.relname not in ('audit_log', 'support_grants', 'support_access_log')
  loop
    execute format('create trigger tenant_write_guard before insert or update or delete on public.%I for each row execute function app.guard_tenant_write()', t.relname);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Onboarding and the console (rules 9 and 10)
-- ---------------------------------------------------------------------------

create or replace function app.onboarding_status(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (app.is_platform_admin() or app.has_permission(p_tenant, 'settings.read')) then
    raise exception 'the setup checklist needs settings.read' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'details', exists (select 1 from public.tenants where id = p_tenant and nullif(trim(legal_name), '') is not null),
    'branch', exists (select 1 from public.branches where tenant_id = p_tenant and archived_at is null),
    'licenses', exists (select 1 from public.branches where tenant_id = p_tenant and archived_at is null)
                and not exists (select 1 from public.branches where tenant_id = p_tenant and archived_at is null and nullif(trim(business_license_number), '') is null),
    'service_types', exists (select 1 from public.service_types where tenant_id = p_tenant and active and archived_at is null),
    'price_book', exists (select 1 from public.price_book_items where tenant_id = p_tenant and active and archived_at is null),
    'products', exists (select 1 from public.tenant_products where tenant_id = p_tenant and enabled),
    'credentials', exists (select 1 from public.applicator_credentials where tenant_id = p_tenant and archived_at is null),
    'payments', exists (select 1 from public.billing_settings where tenant_id = p_tenant and gateway_onboarded_at is not null),
    'messaging', exists (select 1 from public.messaging_settings where tenant_id = p_tenant and nullif(trim(sender_name), '') is not null),
    'team', (select count(*) from public.memberships where tenant_id = p_tenant) > 1 or exists (select 1 from public.invitations where tenant_id = p_tenant),
    'customers', exists (select 1 from public.accounts where tenant_id = p_tenant) or exists (select 1 from public.import_batches where tenant_id = p_tenant and status = 'committed'),
    'scheduled', exists (select 1 from public.visits where tenant_id = p_tenant and not imported and status in ('scheduled', 'en_route', 'in_progress', 'completed')),
    'first_route', exists (select 1 from public.visits where tenant_id = p_tenant and not imported and status = 'completed')
  );
end $$;
revoke all on function app.onboarding_status(uuid) from public;
grant execute on function app.onboarding_status(uuid) to authenticated, service_role;

-- Counts and dates per company, for platform admins only; no names of customers, addresses or amounts.
create or replace function app.platform_overview()
returns table (tenant_id uuid, name text, status text, status_reason text, created_at timestamptz, archived_at timestamptz, members integer, accounts integer,
               active_agreements integer, visits_30 integer, last_activity timestamptz, onboarding jsonb, imported_on timestamptz, first_route_on timestamptz,
               open_support integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.is_platform_admin() then raise exception 'the overview is for platform staff' using errcode = '42501'; end if;
  return query
  select t.id, t.name, t.status, t.status_reason, t.created_at, t.archived_at,
         (select count(*)::int from public.memberships m where m.tenant_id = t.id),
         (select count(*)::int from public.accounts a where a.tenant_id = t.id),
         (select count(*)::int from public.agreements g where g.tenant_id = t.id and g.status = 'active'),
         (select count(*)::int from public.visits v where v.tenant_id = t.id and v.status = 'completed' and not v.imported and v.completed_at > now() - interval '30 days'),
         greatest((select max(l.created_at) from public.audit_log l where l.tenant_id = t.id),
                  (select max(v.updated_at) from public.visits v where v.tenant_id = t.id),
                  (select max(i.created_at) from public.invoices i where i.tenant_id = t.id)),
         app.onboarding_status(t.id),
         (select min(b.created_at) from public.import_batches b where b.tenant_id = t.id and b.status = 'committed'),
         (select min(v.completed_at) from public.visits v where v.tenant_id = t.id and v.status = 'completed' and not v.imported),
         (select count(*)::int from public.support_grants g where g.tenant_id = t.id and g.revoked_at is null
            and ((g.approved is null and g.requested_at > now() - interval '7 days') or (g.approved and now() < g.expires_at)))
  from public.tenants t
  order by t.name;
end $$;
revoke all on function app.platform_overview() from public;
grant execute on function app.platform_overview() to authenticated, service_role;

-- Rule 12: the states the companies serve, for the rule pack console.
create or replace function app.state_coverage() returns table (state_code text, companies integer, properties integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.is_platform_admin() then raise exception 'coverage is for platform staff' using errcode = '42501'; end if;
  return query
  select p.state_code, count(distinct p.tenant_id)::int, count(*)::int
  from public.properties p join public.tenants t on t.id = p.tenant_id
  where p.archived_at is null and t.status <> 'archived'
  group by p.state_code order by p.state_code;
end $$;
revoke all on function app.state_coverage() from public;
grant execute on function app.state_coverage() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Purge (rule 8)
-- ---------------------------------------------------------------------------

-- Deletes an archived company once it has been archived 90 days and every application record's retention has passed.
-- The immutability triggers (sent notices, locked records, the sealed journal) guard live data, not a purge, so the
-- tables are emptied one by one with triggers off, and the purge itself is recorded for the platform.
create or replace function app.purge_tenant(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t record;
  r record;
  v_n integer;
  v_counts jsonb := '{}'::jsonb;
begin
  if not app.is_platform_admin() then raise exception 'only platform staff purge a company' using errcode = '42501'; end if;
  select * into t from public.tenants where id = p_tenant for update;
  if t.id is null then raise exception 'no such company' using errcode = '23514'; end if;
  if t.status <> 'archived' then raise exception 'only an archived company can be purged' using errcode = '23514'; end if;
  if t.archived_at is null or t.archived_at > now() - interval '90 days' then
    raise exception 'archived less than 90 days ago; it can be purged from %', to_char(coalesce(t.archived_at, now()) + interval '90 days', 'YYYY-MM-DD') using errcode = '23514';
  end if;
  if exists (select 1 from public.application_records a where a.tenant_id = p_tenant and (a.retention_until is null or a.retention_until >= current_date)) then
    raise exception 'application records are still under retention' using errcode = '23514';
  end if;
  perform set_config('session_replication_role', 'replica', true);
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and exists (select 1 from information_schema.columns col where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'tenant_id')
  loop
    execute format('delete from public.%I where tenant_id = $1', r.relname) using p_tenant;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_counts := v_counts || jsonb_build_object(r.relname, v_n); end if;
  end loop;
  delete from public.tenants where id = p_tenant;
  perform set_config('session_replication_role', 'origin', true);
  insert into public.tenant_purges (former_tenant_id, name, archived_at, purged_by, row_counts) values (t.id, t.name, t.archived_at, auth.uid(), v_counts);
  return v_counts;
end $$;
revoke all on function app.purge_tenant(uuid) from public;
grant execute on function app.purge_tenant(uuid) to authenticated, service_role;
