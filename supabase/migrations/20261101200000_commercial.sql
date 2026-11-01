-- Spec 14: commercial programs. Site maps, devices with their history, device checks at visits, sightings,
-- recommendations and site documents. Every table is tenant-owned, under row level security and the write guard.

alter table public.files add constraint files_tenant_id_key unique (tenant_id, id);

alter table public.service_types add column device_kinds text[] not null default '{}'
  check (device_kinds <@ array['bait_station', 'rodent_trap', 'multi_catch', 'glue_board', 'insect_light_trap', 'pheromone_trap', 'termite_station']::text[]);

-- A technician may write a site's devices while on the crew of a visit there that is not finished (rule 11).
create or replace function app.crew_at_property(p_property uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.visits v join public.visit_crew c on c.visit_id = v.id
    where v.property_id = p_property and c.user_id = auth.uid() and v.status in ('scheduled', 'en_route', 'in_progress'));
$$;
revoke all on function app.crew_at_property(uuid) from public;
grant execute on function app.crew_at_property(uuid) to authenticated, service_role;

-- ... and checks only for a visit they are on that is not finished.
create or replace function app.crew_on_open_visit(p_visit uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.visits v join public.visit_crew c on c.visit_id = v.id
    where v.id = p_visit and c.user_id = auth.uid() and v.status in ('scheduled', 'en_route', 'in_progress'));
$$;
revoke all on function app.crew_on_open_visit(uuid) from public;
grant execute on function app.crew_on_open_visit(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Maps and devices (rules 1 to 3)
-- ---------------------------------------------------------------------------

create table public.site_maps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  file_id uuid not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  position integer not null default 1,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, id),
  foreign key (tenant_id, property_id) references public.properties (tenant_id, id) on delete cascade,
  foreign key (tenant_id, file_id) references public.files (tenant_id, id)
);
alter table public.site_maps enable row level security;
create index site_maps_property on public.site_maps (tenant_id, property_id, position);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null,
  number text not null check (length(trim(number)) between 1 and 20),
  barcode text check (barcode is null or length(trim(barcode)) between 1 and 64),
  kind text not null check (kind in ('bait_station', 'rodent_trap', 'multi_catch', 'glue_board', 'insect_light_trap', 'pheromone_trap', 'termite_station')),
  zone text not null default 'interior' check (zone in ('interior', 'exterior', 'perimeter')),
  location text not null check (length(trim(location)) > 0),
  map_id uuid,
  x numeric(5, 4) check (x is null or (x >= 0 and x <= 1)),
  y numeric(5, 4) check (y is null or (y >= 0 and y <= 1)),
  product_id uuid references public.products(id),
  installed_on date not null default current_date,
  removed_on date,
  removed_reason text,
  status text not null default 'active' check (status in ('active', 'removed')),
  client_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, id),
  foreign key (tenant_id, property_id) references public.properties (tenant_id, id) on delete cascade,
  foreign key (tenant_id, map_id) references public.site_maps (tenant_id, id),
  constraint devices_position check ((x is null) = (y is null) and (map_id is not null or x is null)),
  constraint devices_removed check ((status = 'removed') = (removed_on is not null) and (status = 'active' or length(trim(coalesce(removed_reason, ''))) > 0))
);
alter table public.devices enable row level security;
create unique index devices_number_active on public.devices (tenant_id, property_id, lower(number)) where status = 'active';
create unique index devices_barcode on public.devices (tenant_id, barcode) where barcode is not null;
create index devices_property on public.devices (tenant_id, property_id, status);

create table public.device_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  device_id uuid not null,
  kind text not null check (kind in ('installed', 'moved', 'removed', 'relabeled')),
  before jsonb,
  after jsonb,
  visit_id uuid,
  at timestamptz not null default now(),
  by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, device_id) references public.devices (tenant_id, id) on delete cascade
);
alter table public.device_events enable row level security;
create index device_events_device on public.device_events (tenant_id, device_id, at);

-- Rule 2: history by trigger, so every path (office, technician, sensor) records it. A visit in progress names itself
-- through the transaction setting app.visit_id.
create or replace function app.device_history() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_visit uuid := nullif(current_setting('app.visit_id', true), '')::uuid;
  v_before jsonb;
  v_after jsonb := jsonb_build_object('number', new.number, 'location', new.location, 'zone', new.zone, 'map_id', new.map_id, 'x', new.x, 'y', new.y, 'status', new.status,
                                     'removed_reason', new.removed_reason);
begin
  if tg_op = 'INSERT' then
    insert into public.device_events (tenant_id, device_id, kind, before, after, visit_id) values (new.tenant_id, new.id, 'installed', null, v_after, v_visit);
    return new;
  end if;
  v_before := jsonb_build_object('number', old.number, 'location', old.location, 'zone', old.zone, 'map_id', old.map_id, 'x', old.x, 'y', old.y, 'status', old.status);
  if new.status = 'removed' and old.status = 'active' then
    insert into public.device_events (tenant_id, device_id, kind, before, after, visit_id) values (new.tenant_id, new.id, 'removed', v_before, v_after, v_visit);
  elsif new.location is distinct from old.location or new.zone is distinct from old.zone or new.map_id is distinct from old.map_id or new.x is distinct from old.x or new.y is distinct from old.y then
    insert into public.device_events (tenant_id, device_id, kind, before, after, visit_id) values (new.tenant_id, new.id, 'moved', v_before, v_after, v_visit);
  elsif new.number is distinct from old.number or new.barcode is distinct from old.barcode then
    insert into public.device_events (tenant_id, device_id, kind, before, after, visit_id) values (new.tenant_id, new.id, 'relabeled', v_before, v_after, v_visit);
  end if;
  return new;
end $$;
create trigger devices_history after insert or update on public.devices for each row execute function app.device_history();

-- A removed device stays removed; its record is kept for the binder.
create or replace function app.device_check_row() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'a device is removed, never deleted' using errcode = '23514'; end if;
  if old.status = 'removed' then raise exception 'a removed device is kept as it was' using errcode = '23514'; end if;
  if new.property_id is distinct from old.property_id then raise exception 'a device stays at its property' using errcode = '23514'; end if;
  return new;
end $$;
create trigger devices_check before update or delete on public.devices for each row execute function app.device_check_row();

-- ---------------------------------------------------------------------------
-- Checks (rules 4 and 5)
-- ---------------------------------------------------------------------------

create table public.device_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  device_id uuid not null,
  visit_id uuid,
  checked_at timestamptz not null default now(),
  checked_by uuid default auth.uid(),
  source text not null default 'technician' check (source in ('technician', 'office', 'sensor')),
  status text not null check (status in ('checked', 'inaccessible', 'missing', 'damaged')),
  activity text check (activity in ('none', 'low', 'medium', 'high')),
  count integer check (count is null or count between 0 and 10000),
  bait_consumed_pct integer check (bait_consumed_pct is null or bait_consumed_pct between 0 and 100),
  pest text,
  actions text[] not null default '{}' check (actions <@ array['cleaned', 'rebaited', 'replaced', 'repaired', 'relocated', 'glue_board_replaced', 'bulb_replaced']::text[]),
  notes text,
  client_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (tenant_id, device_id) references public.devices (tenant_id, id),
  foreign key (tenant_id, visit_id) references public.visits (tenant_id, id),
  constraint device_checks_answer check (status = 'checked' or length(trim(coalesce(notes, ''))) > 0),
  constraint device_checks_source check ((source = 'technician') = (visit_id is not null) or source = 'sensor')
);
alter table public.device_checks enable row level security;
create unique index device_checks_visit_device on public.device_checks (visit_id, device_id) where visit_id is not null;
create index device_checks_device on public.device_checks (tenant_id, device_id, checked_at desc);

-- A completed visit's checks are its record of the service: read only from then on.
create or replace function app.device_check_lock() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_visit uuid := case when tg_op = 'DELETE' then old.visit_id else coalesce(new.visit_id, old.visit_id) end;
begin
  if tg_op <> 'INSERT' and v_visit is not null and exists (select 1 from public.visits v where v.id = v_visit and v.status = 'completed') then
    raise exception 'a completed visit''s device checks are read only' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and new.visit_id is not null and exists (select 1 from public.visits v where v.id = new.visit_id and v.status = 'completed') then
    raise exception 'a completed visit''s device checks are read only' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger device_checks_lock before insert or update or delete on public.device_checks for each row execute function app.device_check_lock();

-- ---------------------------------------------------------------------------
-- Sightings, recommendations, documents (rules 8 and 9)
-- ---------------------------------------------------------------------------

create table public.sightings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null,
  seen_at timestamptz not null,
  location text not null check (length(trim(location)) > 0),
  pest text not null check (length(trim(pest)) > 0),
  count integer check (count is null or count >= 0),
  reported_by text,
  source text not null default 'office' check (source in ('customer', 'office', 'technician')),
  notes text,
  visit_id uuid,
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, id),
  foreign key (tenant_id, property_id) references public.properties (tenant_id, id) on delete cascade,
  foreign key (tenant_id, visit_id) references public.visits (tenant_id, id),
  constraint sightings_resolution check ((resolved_at is null) or length(trim(coalesce(resolution, ''))) > 0)
);
alter table public.sightings enable row level security;
create index sightings_property on public.sightings (tenant_id, property_id, seen_at desc);

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null,
  visit_id uuid,
  sighting_id uuid,
  category text not null check (category in ('sanitation', 'exclusion', 'structural', 'storage', 'moisture', 'landscaping', 'other')),
  description text not null check (length(trim(description)) > 0),
  responsibility text not null default 'customer' check (responsibility in ('customer', 'company')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  owner_name text,
  due_on date,
  status text not null default 'open' check (status in ('open', 'in_progress', 'closed')),
  closed_on date,
  closed_note text,
  client_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (tenant_id, property_id) references public.properties (tenant_id, id) on delete cascade,
  foreign key (tenant_id, visit_id) references public.visits (tenant_id, id),
  foreign key (tenant_id, sighting_id) references public.sightings (tenant_id, id),
  constraint recommendations_closed check ((status = 'closed') = (closed_on is not null) and (status <> 'closed' or length(trim(coalesce(closed_note, ''))) > 0))
);
alter table public.recommendations enable row level security;
create index recommendations_property on public.recommendations (tenant_id, property_id, status);

create table public.site_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null,
  file_id uuid not null,
  title text not null check (length(trim(title)) > 0),
  kind text not null default 'other' check (kind in ('program', 'insurance', 'license', 'map', 'label', 'sds', 'report', 'other')),
  valid_until date,
  shared boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (tenant_id, property_id) references public.properties (tenant_id, id) on delete cascade,
  foreign key (tenant_id, file_id) references public.files (tenant_id, id)
);
alter table public.site_documents enable row level security;
create index site_documents_property on public.site_documents (tenant_id, property_id);

-- ---------------------------------------------------------------------------
-- Policies (rule 11), timestamps, the write guard
-- ---------------------------------------------------------------------------

create policy site_maps_select on public.site_maps for select to authenticated
  using (app.is_member(tenant_id) and (app.has_permission(tenant_id, 'customers.read') or app.has_permission(tenant_id, 'visits.read')));
create policy site_maps_write on public.site_maps for all to authenticated
  using (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write'))
  with check (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write'));

create policy devices_select on public.devices for select to authenticated
  using (app.is_member(tenant_id) and (app.has_permission(tenant_id, 'customers.read') or app.has_permission(tenant_id, 'visits.read')));
create policy devices_insert on public.devices for insert to authenticated
  with check (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write')
              or (app.has_permission(tenant_id, 'visits.write') and app.crew_at_property(property_id)));
create policy devices_update on public.devices for update to authenticated
  using (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write')
         or (app.has_permission(tenant_id, 'visits.write') and app.crew_at_property(property_id)))
  with check (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write')
              or (app.has_permission(tenant_id, 'visits.write') and app.crew_at_property(property_id)));

create policy device_events_select on public.device_events for select to authenticated
  using (app.is_member(tenant_id) and (app.has_permission(tenant_id, 'customers.read') or app.has_permission(tenant_id, 'visits.read')));

create policy device_checks_select on public.device_checks for select to authenticated
  using (app.is_member(tenant_id) and (app.has_permission(tenant_id, 'customers.read') or app.has_permission(tenant_id, 'visits.read')));
create policy device_checks_insert on public.device_checks for insert to authenticated
  with check (case when visit_id is null then app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write')
                   else app.has_permission(tenant_id, 'dispatch.write') or (app.has_permission(tenant_id, 'visits.write') and app.crew_on_open_visit(visit_id)) end);
create policy device_checks_update on public.device_checks for update to authenticated
  using (case when visit_id is null then app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write')
              else app.has_permission(tenant_id, 'dispatch.write') or (app.has_permission(tenant_id, 'visits.write') and app.crew_on_open_visit(visit_id)) end)
  with check (case when visit_id is null then app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write')
                   else app.has_permission(tenant_id, 'dispatch.write') or (app.has_permission(tenant_id, 'visits.write') and app.crew_on_open_visit(visit_id)) end);
create policy device_checks_delete on public.device_checks for delete to authenticated
  using (app.has_permission(tenant_id, 'dispatch.write') or (visit_id is null and app.has_permission(tenant_id, 'customers.write')));

create policy sightings_select on public.sightings for select to authenticated
  using (app.is_member(tenant_id) and (app.has_permission(tenant_id, 'customers.read') or app.has_permission(tenant_id, 'visits.read')));
create policy sightings_write on public.sightings for all to authenticated
  using (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write')
         or (app.has_permission(tenant_id, 'visits.write') and app.crew_at_property(property_id)))
  with check (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write')
              or (app.has_permission(tenant_id, 'visits.write') and app.crew_at_property(property_id)));

create policy recommendations_select on public.recommendations for select to authenticated
  using (app.is_member(tenant_id) and (app.has_permission(tenant_id, 'customers.read') or app.has_permission(tenant_id, 'visits.read')));
create policy recommendations_write on public.recommendations for all to authenticated
  using (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write')
         or (app.has_permission(tenant_id, 'visits.write') and app.crew_at_property(property_id)))
  with check (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write')
              or (app.has_permission(tenant_id, 'visits.write') and app.crew_at_property(property_id)));

create policy site_documents_select on public.site_documents for select to authenticated
  using (app.is_member(tenant_id) and (app.has_permission(tenant_id, 'customers.read') or app.has_permission(tenant_id, 'visits.read')));
create policy site_documents_write on public.site_documents for all to authenticated
  using (app.has_permission(tenant_id, 'customers.write'))
  with check (app.has_permission(tenant_id, 'customers.write'));

create trigger site_maps_updated_at before update on public.site_maps for each row execute function app.set_updated_at();
create trigger devices_updated_at before update on public.devices for each row execute function app.set_updated_at();
create trigger device_checks_updated_at before update on public.device_checks for each row execute function app.set_updated_at();
create trigger sightings_updated_at before update on public.sightings for each row execute function app.set_updated_at();
create trigger recommendations_updated_at before update on public.recommendations for each row execute function app.set_updated_at();
create trigger site_documents_updated_at before update on public.site_documents for each row execute function app.set_updated_at();

create trigger tenant_write_guard before insert or update or delete on public.site_maps for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.devices for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.device_events for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.device_checks for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.sightings for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.recommendations for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.site_documents for each row execute function app.guard_tenant_write();
