-- Spec 06 review fixes: crewmates read each other's credentials (the completion gate needs the lead's certification
-- on every phone, not only the lead's), the crew may replace the visit's signature, a visit moves forward only at the
-- hands of its crew, and every product line names at least one target pest.

-- Two people share a crew when any visit lists both of them.
create or replace function app.shares_crew(tenant uuid, other_user uuid) returns boolean
language sql security definer stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.visit_crew a join public.visit_crew b on b.visit_id = a.visit_id
    where a.tenant_id = tenant and a.user_id = auth.uid() and b.user_id = other_user
  )
$$;
revoke all on function app.shares_crew(uuid, uuid) from public;
grant execute on function app.shares_crew(uuid, uuid) to authenticated;

drop policy applicator_credentials_select on public.applicator_credentials;
create policy applicator_credentials_select on public.applicator_credentials for select to authenticated
  using (app.has_permission(tenant_id, 'compliance.read') or app.has_permission(tenant_id, 'dispatch.write')
         or (user_id = auth.uid() and app.is_member(tenant_id))
         or app.shares_crew(tenant_id, user_id));

-- The crew may sign again; the capture-author rule applies to the replacement as it does to the first signature.
drop policy visit_signatures_update on public.visit_signatures;
create policy visit_signatures_update on public.visit_signatures for update to authenticated
  using (app.has_permission(tenant_id, 'visits.write') or app.has_permission(tenant_id, 'compliance.write'))
  with check (app.has_permission(tenant_id, 'visits.write') or app.has_permission(tenant_id, 'compliance.write'));
create trigger visit_signatures_author_update before update on public.visit_signatures for each row execute function app.check_capture_author();

-- Every product line names at least one target pest (spec 06 rule 2).
alter table public.visit_products add constraint visit_products_target_pests check (cardinality(target_pests) > 0);

-- Forward moves (en_route, in_progress, completed) come only from the visit's crew; the permission guard stays.
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
    if new.status not in ('planned', 'cancelled') and auth.uid() is not null
       and not (app.has_permission(new.tenant_id, 'dispatch.write') or app.has_permission(new.tenant_id, 'visits.write')) then
      raise exception 'only dispatch or a technician can move a visit to %', new.status using errcode = '42501';
    end if;
    if new.status in ('en_route', 'in_progress', 'completed') and auth.uid() is not null
       and not (new.technician_id = auth.uid() or exists (select 1 from public.visit_crew c where c.visit_id = new.id and c.user_id = auth.uid())) then
      raise exception 'only the visit''s crew moves it to %', new.status using errcode = '42501';
    end if;
    if new.status = 'in_progress' then
      new.arrived_at := coalesce(new.arrived_at, now());
      new.started_by := coalesce(new.started_by, auth.uid());
    end if;
    if new.status = 'completed' then
      new.departed_at := coalesce(new.departed_at, now());
      new.completed_at := coalesce(new.completed_at, now());
    end if;
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
