-- Spec 05: dispatch. Applicator credentials per technician per state (what dispatch checks against), the dispatch
-- columns on visits, a licensed manager's confirmation on state rules where no pack is researched, and display names.

alter table public.memberships add column display_name text;

alter table public.service_type_state_rules
  add column confirmed_at timestamptz,
  add column confirmed_by uuid;

alter table public.visits
  add column arrival_window text not null default 'any' check (arrival_window in ('any', 'morning', 'afternoon', 'evening')),
  add column route_position integer check (route_position is null or route_position >= 1),
  add column dispatch_notes text,
  add column skip_reason text;

-- ---------------------------------------------------------------------------
-- Credentials
-- ---------------------------------------------------------------------------

create table public.applicator_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state_code text not null check (state_code ~ '^[A-Z]{2}$'),
  cert_number text,
  categories text[] not null default '{}',
  cert_expires_on date,
  license_number text,
  license_expires_on date,
  license_year integer check (license_year is null or license_year between 2000 and 2100),
  recert_credits jsonb not null default '{}'::jsonb check (jsonb_typeof(recert_credits) = 'object'),
  -- Set for a registered trainee or technician-in-training; such a person works under a supervising applicator.
  trainee_registered_on date,
  supervisor_id uuid references auth.users(id),
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint credentials_cert_or_trainee check (trainee_registered_on is not null or cert_number is not null)
);
alter table public.applicator_credentials enable row level security;
create unique index applicator_credentials_one_per_state on public.applicator_credentials (tenant_id, user_id, state_code) where archived_at is null;
create index applicator_credentials_user on public.applicator_credentials (tenant_id, user_id);

-- The technician and the supervisor are members of the tenant.
create or replace function app.check_credential_members() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.memberships m where m.tenant_id = new.tenant_id and m.user_id = new.user_id) then
    raise exception 'credentials belong to a member of the company' using errcode = '23503';
  end if;
  if new.supervisor_id is not null and not exists (select 1 from public.memberships m where m.tenant_id = new.tenant_id and m.user_id = new.supervisor_id) then
    raise exception 'the supervisor must be a member of the company' using errcode = '23503';
  end if;
  return new;
end $$;
create trigger applicator_credentials_members before insert or update of user_id, supervisor_id, tenant_id on public.applicator_credentials
  for each row execute function app.check_credential_members();

-- ---------------------------------------------------------------------------
-- Visit status machine: a scheduled visit has a date and a lead technician; going back to planned clears the route slot.
-- ---------------------------------------------------------------------------

create or replace function app.check_visit_status() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('planned', 'scheduled', 'completed') then
      raise exception 'a visit starts planned or scheduled (or completed when imported)' using errcode = '23514';
    end if;
    if new.status = 'completed' then new.completed_at := coalesce(new.completed_at, now()); end if;
  elsif new.status <> old.status then
    if not (
      (old.status = 'planned' and new.status in ('scheduled', 'cancelled', 'skipped'))
      or (old.status = 'scheduled' and new.status in ('planned', 'en_route', 'in_progress', 'completed', 'skipped', 'cancelled'))
      or (old.status = 'en_route' and new.status in ('in_progress', 'scheduled'))
      or (old.status = 'in_progress' and new.status = 'completed')
    ) then
      raise exception 'a visit cannot move from % to %', old.status, new.status using errcode = '23514';
    end if;
    -- Spec 04 rule 11: beyond planned and cancelled, only dispatch and technicians move a visit. The superuser seed
    -- and imports (no signed-in user) are exempt.
    if new.status not in ('planned', 'cancelled') and auth.uid() is not null
       and not (app.has_permission(new.tenant_id, 'dispatch.write') or app.has_permission(new.tenant_id, 'visits.write')) then
      raise exception 'only dispatch or a technician can move a visit to %', new.status using errcode = '42501';
    end if;
    if new.status = 'completed' then new.completed_at := coalesce(new.completed_at, now()); end if;
    if new.status = 'cancelled' then new.cancelled_at := coalesce(new.cancelled_at, now()); end if;
    if new.status = 'planned' then
      new.scheduled_for := null;
      new.technician_id := null;
      new.route_position := null;
    end if;
  end if;
  if new.status = 'scheduled' and (new.scheduled_for is null or new.technician_id is null) then
    raise exception 'a scheduled visit needs a date and a lead technician' using errcode = '23514';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Housekeeping and policies
-- ---------------------------------------------------------------------------

create trigger applicator_credentials_updated_at before update on public.applicator_credentials for each row execute function app.set_updated_at();
create trigger applicator_credentials_audit after insert or update or delete on public.applicator_credentials for each row execute function app.write_audit();

-- Compliance staff and dispatchers (who assign work) read every credential; everyone else reads their own.
create policy applicator_credentials_select on public.applicator_credentials for select to authenticated
  using (app.has_permission(tenant_id, 'compliance.read') or app.has_permission(tenant_id, 'dispatch.write') or (user_id = auth.uid() and app.is_member(tenant_id)));
create policy applicator_credentials_insert on public.applicator_credentials for insert to authenticated with check (app.has_permission(tenant_id, 'compliance.write'));
create policy applicator_credentials_update on public.applicator_credentials for update to authenticated
  using (app.has_permission(tenant_id, 'compliance.write')) with check (app.has_permission(tenant_id, 'compliance.write'));
create policy applicator_credentials_delete on public.applicator_credentials for delete to authenticated using (app.has_permission(tenant_id, 'compliance.write'));
