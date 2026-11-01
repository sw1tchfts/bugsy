-- Spec 13 review fixes.
-- 1. An invitation made by platform staff is good only while the company has no members, and expires within 14 days;
--    nobody joins a company that is not active. Before, an admin could invite themselves while a new company was empty
--    and accept after its owner joined, becoming an owner without any grant.
-- 2. Nobody signed in moves archived_at or status_changed_at except through a status change, so a purge cannot be
--    brought forward by backdating the archive.
-- 3. Platform staff change a company's status and reason, never its settings (name, time zone), unless they are its
--    settings.write members.
-- 4. A signed-in user never moves a row from one company to another, which slipped past the write guard's check of
--    the new company only. Platform staff may move a row to no company: approving a product into the master list.
-- 5. The setup checklist's "a second person" counts an open invitation, not the accepted first-owner one.

create or replace function app.accept_invitation(invite_token uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inv public.invitations;
  uid uuid := auth.uid();
  mail text := lower(coalesce(auth.email(), ''));
  membership_id uuid;
  v_status text;
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
  select status into v_status from public.tenants where id = inv.tenant_id;
  if v_status is distinct from 'active' then
    raise exception 'this company is % and takes no new members', coalesce(v_status, 'gone') using errcode = '42501';
  end if;
  -- An invitation from platform staff (not a users.write member of the company) seats only its first people.
  if exists (select 1 from public.platform_admins p where p.user_id = inv.created_by)
     and not exists (select 1 from public.memberships m join public.roles r on r.id = m.role_id
                     where m.tenant_id = inv.tenant_id and m.user_id = inv.created_by and (r.permissions @> array['users.write'] or r.permissions @> array['*']))
     and app.tenant_has_members(inv.tenant_id) then
    raise exception 'this invitation was for the company''s first people and is no longer valid' using errcode = '42501';
  end if;
  insert into public.memberships (tenant_id, user_id, role_id, branch_ids, created_by)
  values (inv.tenant_id, uid, inv.role_id, inv.branch_ids, inv.created_by)
  on conflict (tenant_id, user_id) do update
    set role_id = excluded.role_id, branch_ids = excluded.branch_ids
  returning id into membership_id;
  update public.invitations set accepted_at = now(), accepted_by = uid where id = inv.id;
  return membership_id;
end $$;

drop policy invitations_insert on public.invitations;
create policy invitations_insert on public.invitations for insert to authenticated
  with check (app.has_permission(tenant_id, 'users.write')
              or (app.is_platform_admin() and not app.tenant_has_members(tenant_id) and expires_at <= now() + interval '14 days'));

drop trigger tenants_status on public.tenants;
create or replace function app.tenant_status_change() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    new.archived_at := case when new.status = 'archived' then now() when new.status = 'active' then null else old.archived_at end;
  elsif auth.uid() is not null then
    new.status_changed_at := old.status_changed_at;
    new.archived_at := old.archived_at;
  end if;
  return new;
end $$;
create trigger tenants_status before update on public.tenants for each row execute function app.tenant_status_change();

create or replace function app.guard_tenant_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  lifecycle text[] := array['status', 'status_reason', 'status_changed_at', 'archived_at', 'updated_at'];
  v_other boolean;
  v_status boolean;
begin
  if auth.uid() is null then return new; end if;
  v_other := (to_jsonb(new) - lifecycle) <> (to_jsonb(old) - lifecycle);
  v_status := new.status is distinct from old.status or new.status_reason is distinct from old.status_reason;
  if v_status and not app.is_platform_admin() then
    raise exception 'only platform staff change a company''s status' using errcode = '42501';
  end if;
  if v_other then
    if not app.has_permission(old.id, 'settings.write') then
      raise exception 'platform staff change a company''s status, not its settings' using errcode = '42501';
    end if;
    if old.status <> 'active' then
      raise exception 'this company is % and read only', old.status using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

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
  -- Approving a company's product moves it into the shared master list (spec 03 rule 10): platform staff only.
  if tg_op = 'UPDATE' and new.tenant_id is distinct from old.tenant_id and not (new.tenant_id is null and app.is_platform_admin()) then
    raise exception 'a row stays with its company' using errcode = '42501';
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
    'team', (select count(*) from public.memberships where tenant_id = p_tenant) > 1
            or exists (select 1 from public.invitations where tenant_id = p_tenant and accepted_at is null and expires_at > now()),
    'customers', exists (select 1 from public.accounts where tenant_id = p_tenant) or exists (select 1 from public.import_batches where tenant_id = p_tenant and status = 'committed'),
    'scheduled', exists (select 1 from public.visits where tenant_id = p_tenant and not imported and status in ('scheduled', 'en_route', 'in_progress', 'completed')),
    'first_route', exists (select 1 from public.visits where tenant_id = p_tenant and not imported and status = 'completed')
  );
end $$;
