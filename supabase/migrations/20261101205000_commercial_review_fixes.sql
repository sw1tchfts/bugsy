-- Spec 14 review fixes: references stay inside the property, completed checks stay put, history records every change,
-- recommendations and sightings are never deleted, and dispatch writes site documents.

-- A device's map is one of its own property's maps (rules 1 and 3); a mapped device sits on a map still in use.
alter table public.site_maps add constraint site_maps_property_key unique (tenant_id, property_id, id);
alter table public.devices drop constraint devices_tenant_id_map_id_fkey;
alter table public.devices add constraint devices_map_fkey foreign key (tenant_id, property_id, map_id) references public.site_maps (tenant_id, property_id, id);

-- The bait a device holds is a master product or one this company added, never another company's private row.
create trigger devices_product_owner before insert or update of product_id on public.devices
  for each row when (new.product_id is not null) execute function app.check_tenant_product();

create or replace function app.device_check_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then raise exception 'a device is removed, never deleted' using errcode = '23514'; end if;
  if tg_op = 'UPDATE' then
    if old.status = 'removed' then raise exception 'a removed device is kept as it was' using errcode = '23514'; end if;
    if new.property_id is distinct from old.property_id then raise exception 'a device stays at its property' using errcode = '23514'; end if;
  end if;
  if new.map_id is not null and (tg_op = 'INSERT' or new.map_id is distinct from old.map_id)
     and exists (select 1 from public.site_maps m where m.id = new.map_id and m.archived_at is not null) then
    raise exception 'that map is archived; place the device on a map in use' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger devices_check on public.devices;
create trigger devices_check before insert or update or delete on public.devices for each row execute function app.device_check_row();

-- Rule 2: one event per kind of change (a move and a relabel in one update are two events), barcodes included, and the
-- visit named only when it is at the device's property.
create or replace function app.device_history() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_visit uuid := nullif(current_setting('app.visit_id', true), '')::uuid;
  v_before jsonb;
  v_after jsonb := jsonb_build_object('number', new.number, 'barcode', new.barcode, 'location', new.location, 'zone', new.zone, 'map_id', new.map_id, 'x', new.x, 'y', new.y,
                                     'status', new.status, 'removed_reason', new.removed_reason);
begin
  if v_visit is not null and not exists (select 1 from public.visits v where v.id = v_visit and v.tenant_id = new.tenant_id and v.property_id = new.property_id) then
    v_visit := null;
  end if;
  if tg_op = 'INSERT' then
    insert into public.device_events (tenant_id, device_id, kind, before, after, visit_id) values (new.tenant_id, new.id, 'installed', null, v_after, v_visit);
    return new;
  end if;
  v_before := jsonb_build_object('number', old.number, 'barcode', old.barcode, 'location', old.location, 'zone', old.zone, 'map_id', old.map_id, 'x', old.x, 'y', old.y, 'status', old.status);
  if new.number is distinct from old.number or new.barcode is distinct from old.barcode then
    insert into public.device_events (tenant_id, device_id, kind, before, after, visit_id) values (new.tenant_id, new.id, 'relabeled', v_before, v_after, v_visit);
  end if;
  if new.location is distinct from old.location or new.zone is distinct from old.zone or new.map_id is distinct from old.map_id or new.x is distinct from old.x or new.y is distinct from old.y then
    insert into public.device_events (tenant_id, device_id, kind, before, after, visit_id) values (new.tenant_id, new.id, 'moved', v_before, v_after, v_visit);
  end if;
  if new.status = 'removed' and old.status = 'active' then
    insert into public.device_events (tenant_id, device_id, kind, before, after, visit_id) values (new.tenant_id, new.id, 'removed', v_before, v_after, v_visit);
  end if;
  return new;
end $$;
alter table public.device_events add constraint device_events_visit_fkey foreign key (tenant_id, visit_id) references public.visits (tenant_id, id);

-- Checks: a check at a visit is for a device at that visit's property, keeps its device and visit, and a completed
-- visit's checks are read only (rule 11, data rule on device_checks).
create or replace function app.device_check_lock() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.visit_id is not null and exists (select 1 from public.visits v where v.id = old.visit_id and v.status = 'completed') then
    raise exception 'a completed visit''s device checks are read only' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and (new.visit_id is distinct from old.visit_id or new.device_id is distinct from old.device_id) then
    raise exception 'a check stays with its device and visit' using errcode = '23514';
  end if;
  if new.visit_id is not null then
    if exists (select 1 from public.visits v where v.id = new.visit_id and v.status = 'completed') then
      raise exception 'a completed visit''s device checks are read only' using errcode = '23514';
    end if;
    if not exists (select 1 from public.devices d join public.visits v on v.property_id = d.property_id and v.tenant_id = d.tenant_id
                   where d.id = new.device_id and v.id = new.visit_id) then
      raise exception 'a check at a visit is for a device at that visit''s property' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- Sightings and recommendations: the visit and the sighting they name are at the same property.
alter table public.sightings add constraint sightings_property_key unique (tenant_id, property_id, id);
alter table public.recommendations drop constraint recommendations_tenant_id_sighting_id_fkey;
alter table public.recommendations add constraint recommendations_sighting_fkey foreign key (tenant_id, property_id, sighting_id) references public.sightings (tenant_id, property_id, id);

create or replace function app.site_item_refs() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.visit_id is not null and not exists (select 1 from public.visits v where v.id = new.visit_id and v.tenant_id = new.tenant_id and v.property_id = new.property_id) then
    raise exception 'the visit named is not at this property' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger sightings_refs before insert or update of visit_id, property_id on public.sightings for each row execute function app.site_item_refs();
create trigger recommendations_refs before insert or update of visit_id, property_id on public.recommendations for each row execute function app.site_item_refs();

-- Rules 8 to 10: sightings and recommendations are closed with a note, never deleted.
drop policy sightings_write on public.sightings;
create policy sightings_insert on public.sightings for insert to authenticated
  with check (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write')
              or (app.has_permission(tenant_id, 'visits.write') and app.crew_at_property(property_id)));
create policy sightings_update on public.sightings for update to authenticated
  using (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write')
         or (app.has_permission(tenant_id, 'visits.write') and app.crew_at_property(property_id)))
  with check (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write')
              or (app.has_permission(tenant_id, 'visits.write') and app.crew_at_property(property_id)));

drop policy recommendations_write on public.recommendations;
create policy recommendations_insert on public.recommendations for insert to authenticated
  with check (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write')
              or (app.has_permission(tenant_id, 'visits.write') and app.crew_at_property(property_id)));
create policy recommendations_update on public.recommendations for update to authenticated
  using (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write')
         or (app.has_permission(tenant_id, 'visits.write') and app.crew_at_property(property_id)))
  with check (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write')
              or (app.has_permission(tenant_id, 'visits.write') and app.crew_at_property(property_id)));

-- Rule 11: customers.write or dispatch.write writes a site, its documents included.
drop policy site_documents_write on public.site_documents;
create policy site_documents_write on public.site_documents for all to authenticated
  using (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write'))
  with check (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write'));
