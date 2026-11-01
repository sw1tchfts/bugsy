-- Spec 19: routing and fleet. Branch coordinates as the route's start, the company's routing settings, technician
-- positions from the phone, and a record of each suggestion and whether it was applied.

alter table public.branches add column lat double precision check (lat is null or lat between -90 and 90);
alter table public.branches add column lng double precision check (lng is null or lng between -180 and 180);

create table public.route_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  average_speed_mph numeric(5, 1) not null default 25 check (average_speed_mph > 0 and average_speed_mph <= 80),
  day_starts_at time not null default '08:00',
  morning_ends_at time not null default '12:00',
  afternoon_ends_at time not null default '17:00',
  fill_in_miles numeric(5, 1) not null default 5 check (fill_in_miles > 0 and fill_in_miles <= 100),
  position_days integer not null default 30 check (position_days between 1 and 365),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint route_settings_day check (day_starts_at < morning_ends_at and morning_ends_at < afternoon_ends_at)
);
alter table public.route_settings enable row level security;

create table public.technician_positions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m numeric check (accuracy_m is null or accuracy_m >= 0),
  recorded_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.technician_positions enable row level security;
create index technician_positions_latest on public.technician_positions (tenant_id, user_id, recorded_at desc);

-- Rule 7: a position is the person's own, sent while they are clocked in or on the way to a stop, never ahead of the
-- server's clock.
create or replace function app.technician_positions_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not app.is_member(new.tenant_id) then return new; end if;
  if new.user_id <> auth.uid() then raise exception 'a phone shares only its own person''s position' using errcode = '42501'; end if;
  if new.recorded_at > now() + interval '1 minute' then new.recorded_at := now(); end if;
  if not exists (select 1 from public.time_entries e where e.tenant_id = new.tenant_id and e.user_id = new.user_id and e.ended_at is null)
     and not exists (select 1 from public.visits v where v.tenant_id = new.tenant_id and v.technician_id = new.user_id and v.status = 'en_route') then
    raise exception 'the position is shared only while clocked in or on the way' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger technician_positions_guard before insert on public.technician_positions for each row execute function app.technician_positions_guard();

create table public.route_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('optimize', 'assign', 'fill_in')),
  technician_id uuid references auth.users(id),
  branch_id uuid references public.branches(id),
  date date not null,
  before jsonb not null default '[]'::jsonb,
  after jsonb not null default '[]'::jsonb,
  miles_before numeric(8, 1),
  miles_after numeric(8, 1),
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.route_runs enable row level security;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

create policy route_settings_select on public.route_settings for select to authenticated using (app.is_member(tenant_id));
create policy route_settings_write on public.route_settings for all to authenticated
  using (app.has_permission(tenant_id, 'settings.write')) with check (app.has_permission(tenant_id, 'settings.write'));

-- Where people are is for those who dispatch them (technicians read their own route with dispatch.read, not others' trucks).
create policy technician_positions_select on public.technician_positions for select to authenticated
  using (app.has_permission(tenant_id, 'dispatch.write') or (app.is_member(tenant_id) and user_id = auth.uid()));
create policy technician_positions_insert on public.technician_positions for insert to authenticated
  with check (app.is_member(tenant_id) and user_id = auth.uid());

create policy route_runs_select on public.route_runs for select to authenticated using (app.has_permission(tenant_id, 'dispatch.read'));
create policy route_runs_insert on public.route_runs for insert to authenticated with check (app.has_permission(tenant_id, 'dispatch.write'));
create policy route_runs_update on public.route_runs for update to authenticated
  using (app.has_permission(tenant_id, 'dispatch.write')) with check (app.has_permission(tenant_id, 'dispatch.write'));

create trigger route_settings_updated_at before update on public.route_settings for each row execute function app.set_updated_at();
create trigger route_runs_updated_at before update on public.route_runs for each row execute function app.set_updated_at();

create trigger tenant_write_guard before insert or update or delete on public.route_settings for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.technician_positions for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.route_runs for each row execute function app.guard_tenant_write();
