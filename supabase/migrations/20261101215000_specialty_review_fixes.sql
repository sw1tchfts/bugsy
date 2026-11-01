-- Spec 15 review fixes: recognition is fixed once signed; a WDI report's number, issuer, inspector and printed facts are
-- set by the database at issue, which also enforces rule 7's checks; captures, materials and prep checks belong to the
-- crew of an open visit only; authorizations follow rule 9's permissions.

-- Rule 2: switching recognition on a signed agreement would count its revenue twice (or never).
create or replace function app.agreement_recognition_fixed() returns trigger
language plpgsql as $$
begin
  if old.status <> 'draft' and new.recognition is distinct from old.recognition then
    raise exception 'recognition is fixed once the agreement is signed' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger agreements_recognition_fixed before update of recognition on public.agreements for each row execute function app.agreement_recognition_fixed();

-- Rule 7: the report's number, issue time, issuer and inspector are the database's to set, once, at issue, after the
-- areas, every finding, the recommendation and the inspector's current credential for the property's state are there.
-- What the printout shows is captured then too, so a reprint never changes.
alter table public.wdi_reports add column issued_snapshot jsonb;
create unique index wdi_reports_number on public.wdi_reports (tenant_id, number) where number is not null;

create or replace function app.wdi_report_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_visit record;
  v_inspector record;
  v_tz text;
  v_today date;
  v_key text;
  v_finding jsonb;
  v_license text;
begin
  if tg_op = 'DELETE' then
    if old.status = 'issued' then raise exception 'an issued WDI report is kept as issued' using errcode = '23514'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.status = 'issued' then
    raise exception 'an issued WDI report is kept as issued' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.visit_id is distinct from old.visit_id then
    raise exception 'a WDI report stays with its visit' using errcode = '23514';
  end if;
  select v.id, v.status, v.completed_at, v.scheduled_for, st.job_kind, p.normalized_address as address, p.state_code, v.tenant_id
  into v_visit
  from public.visits v join public.service_types st on st.id = v.service_type_id join public.properties p on p.id = v.property_id
  where v.id = new.visit_id;
  if v_visit.id is null or v_visit.job_kind not in ('inspection', 'wdi_report') then
    raise exception 'a WDI report belongs to an inspection or WDI visit' using errcode = '23514';
  end if;
  if new.status = 'draft' then
    new.number := null;
    new.issued_at := null;
    new.issued_by := null;
    new.issued_snapshot := null;
    return new;
  end if;
  -- Issuing.
  if auth.uid() is not null and not app.has_permission(new.tenant_id, 'compliance.write') then
    raise exception 'issuing a WDI report needs compliance.write' using errcode = '42501';
  end if;
  if v_visit.status not in ('in_progress', 'completed') then
    raise exception 'a WDI report is issued once the inspection has started' using errcode = '23514';
  end if;
  if length(trim(coalesce(new.inspected_areas, ''))) = 0 or length(trim(coalesce(new.inaccessible_areas, ''))) = 0 then
    raise exception 'say which areas were inspected and which could not be' using errcode = '23514';
  end if;
  foreach v_key in array array['live_insects', 'dead_insects', 'damage', 'evidence', 'previous_treatment'] loop
    v_finding := new.findings -> v_key;
    if v_finding is null or jsonb_typeof(v_finding -> 'seen') <> 'boolean' then
      raise exception 'answer every finding (%)', v_key using errcode = '23514';
    end if;
    if (v_finding ->> 'seen')::boolean and length(trim(coalesce(v_finding ->> 'where', ''))) = 0 then
      raise exception 'say where (%)', v_key using errcode = '23514';
    end if;
  end loop;
  if new.treatment_recommended is null then raise exception 'say whether treatment is recommended' using errcode = '23514'; end if;
  select timezone into v_tz from public.tenants where id = new.tenant_id;
  v_today := (now() at time zone v_tz)::date;
  select c.user_id, coalesce(m.display_name, 'Inspector') as name, cr.cert_number, cr.license_number, cr.cert_expires_on
  into v_inspector
  from public.visit_crew c
    left join public.memberships m on m.tenant_id = c.tenant_id and m.user_id = c.user_id
    left join public.applicator_credentials cr on cr.tenant_id = c.tenant_id and cr.user_id = c.user_id and cr.state_code = v_visit.state_code and cr.archived_at is null
  where c.visit_id = new.visit_id
  order by case c.role when 'lead' then 0 else 1 end limit 1;
  if v_inspector.user_id is null then raise exception 'the inspection needs an inspector on its crew' using errcode = '23514'; end if;
  if v_inspector.cert_number is null then raise exception 'the inspector has no credential on file for this state' using errcode = '23514'; end if;
  if v_inspector.cert_expires_on is not null and v_inspector.cert_expires_on < v_today then
    raise exception 'the inspector''s credential expired on %', v_inspector.cert_expires_on using errcode = '23514';
  end if;
  select business_license_number into v_license from public.branches where tenant_id = new.tenant_id and archived_at is null and state_code = v_visit.state_code
  order by business_license_number nulls last, name limit 1;
  new.number := app.next_number(new.tenant_id, 'wdi');
  new.issued_at := now();
  new.issued_by := auth.uid();
  new.inspector_id := v_inspector.user_id;
  new.issued_snapshot := jsonb_build_object(
    'company', (select jsonb_build_object('name', t.name, 'legal_name', t.legal_name, 'license', v_license) from public.tenants t where t.id = new.tenant_id),
    'property', jsonb_build_object('address', v_visit.address, 'state', v_visit.state_code),
    'inspected_on', coalesce((v_visit.completed_at at time zone v_tz)::date, v_today),
    'issued_on', v_today,
    'inspector', jsonb_build_object('name', v_inspector.name, 'cert_number', v_inspector.cert_number, 'license_number', v_inspector.license_number,
                                    'cert_expires_on', v_inspector.cert_expires_on));
  return new;
end $$;

-- Rule 9: captures, materials and prep checks are the crew's, at an open visit; nothing is recorded at a closed one.
drop policy wildlife_captures_write on public.wildlife_captures;
create policy wildlife_captures_write on public.wildlife_captures for all to authenticated
  using (app.has_permission(tenant_id, 'visits.write') and app.crew_on_open_visit(visit_id))
  with check (app.has_permission(tenant_id, 'visits.write') and app.crew_on_open_visit(visit_id));
drop policy visit_materials_write on public.visit_materials;
create policy visit_materials_write on public.visit_materials for all to authenticated
  using (app.has_permission(tenant_id, 'visits.write') and app.crew_on_open_visit(visit_id))
  with check (app.has_permission(tenant_id, 'visits.write') and app.crew_on_open_visit(visit_id));
drop policy prep_checks_write on public.prep_checks;
create policy prep_checks_write on public.prep_checks for all to authenticated
  using (app.has_permission(tenant_id, 'visits.write') and app.crew_on_open_visit(visit_id))
  with check (app.has_permission(tenant_id, 'visits.write') and app.crew_on_open_visit(visit_id));

create or replace function app.visit_capture_lock() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_visit uuid := case when tg_op = 'DELETE' then old.visit_id else new.visit_id end;
  v_status text;
begin
  select status into v_status from public.visits where id = v_visit;
  if v_status in ('completed', 'cancelled', 'skipped') then
    raise exception 'the visit is %; what was recorded at it is closed', v_status using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.visit_id is distinct from old.visit_id then
    raise exception 'a record stays with its visit' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- Rule 9: customers.write or dispatch.write records authorizations.
drop policy job_authorizations_write on public.job_authorizations;
create policy job_authorizations_write on public.job_authorizations for all to authenticated
  using (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write'))
  with check (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write'));
