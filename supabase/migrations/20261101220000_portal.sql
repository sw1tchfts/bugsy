-- Spec 16: the customer portal and online booking. Portal identities, the portal's settings, customer requests,
-- booking forms and their intake log; additive read policies that let a portal identity see its own account under
-- each table's row level security; the few writes a customer makes; the self-service reschedule; the public intake.

-- ---------------------------------------------------------------------------
-- Portal identities (rules 1, 2 and 9)
-- ---------------------------------------------------------------------------

alter table public.contacts add constraint contacts_tenant_id_id_key unique (tenant_id, id);

create table public.portal_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  account_id uuid not null,
  contact_id uuid,
  email text not null check (email = lower(email) and email like '%@%'),
  user_id uuid references auth.users(id),
  property_ids uuid[],
  status text not null default 'invited' check (status in ('invited', 'active', 'disabled')),
  token uuid not null unique default gen_random_uuid(),
  invited_by uuid default auth.uid(),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, account_id) references public.accounts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  constraint portal_users_active check (status <> 'active' or (user_id is not null and accepted_at is not null))
);
alter table public.portal_users enable row level security;
create unique index portal_users_one_per_account on public.portal_users (tenant_id, account_id, user_id) where user_id is not null and status <> 'disabled';
create unique index portal_users_email_account on public.portal_users (tenant_id, account_id, email) where status <> 'disabled';
create index portal_users_user on public.portal_users (user_id) where user_id is not null;

-- The portal identity the server named in the session claims, when it belongs to the signed-in user and is active in a
-- company that is not archived. A signed Supabase token never carries the claim, so the Data API never gets here.
create or replace function app.portal_user_id() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_raw text := nullif(current_setting('request.jwt.claims', true), '');
  v_claim text;
  v_id uuid;
begin
  if v_raw is null or auth.uid() is null then return null; end if;
  v_claim := v_raw::jsonb ->> 'portal_user';
  if v_claim is null or v_claim !~ '^[0-9a-fA-F-]{36}$' then return null; end if;
  select pu.id into v_id from public.portal_users pu join public.tenants t on t.id = pu.tenant_id
  where pu.id = v_claim::uuid and pu.user_id = auth.uid() and pu.status = 'active' and t.status <> 'archived';
  return v_id;
end $$;

-- The account the portal identity opens in this company, or null.
create or replace function app.portal_account(p_tenant uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select pu.account_id from public.portal_users pu where pu.id = app.portal_user_id() and pu.tenant_id = p_tenant
$$;

-- Whether the portal identity sees this property: one of its account's, and in its list when it has one.
create or replace function app.portal_property(p_tenant uuid, p_property uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.portal_users pu join public.properties p on p.id = p_property and p.tenant_id = p_tenant and p.account_id = pu.account_id
    where pu.id = app.portal_user_id() and pu.tenant_id = p_tenant and (pu.property_ids is null or p_property = any(pu.property_ids)))
$$;

create or replace function app.portal_visit(p_visit uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.visits v where v.id = p_visit and app.portal_property(v.tenant_id, v.property_id))
$$;

revoke all on function app.portal_user_id() from public;
revoke all on function app.portal_account(uuid) from public;
revoke all on function app.portal_property(uuid, uuid) from public;
revoke all on function app.portal_visit(uuid) from public;
grant execute on function app.portal_user_id() to authenticated, service_role;
grant execute on function app.portal_account(uuid) to authenticated, service_role;
grant execute on function app.portal_property(uuid, uuid) to authenticated, service_role;
grant execute on function app.portal_visit(uuid) to authenticated, service_role;

-- The signed-in person's portal identities, for the chooser.
create or replace function app.portal_identities() returns table (id uuid, tenant_id uuid, tenant_name text, tenant_timezone text, account_id uuid, account_name text, property_ids uuid[])
language sql stable security definer set search_path = public, pg_temp as $$
  select pu.id, pu.tenant_id, t.name, t.timezone, pu.account_id, a.name, pu.property_ids
  from public.portal_users pu join public.tenants t on t.id = pu.tenant_id join public.accounts a on a.id = pu.account_id
  where pu.user_id = auth.uid() and pu.status = 'active' and t.status <> 'archived'
  order by t.name, a.name
$$;
revoke all on function app.portal_identities() from public;
grant execute on function app.portal_identities() to authenticated;

-- The invitation page before sign-in: the company, the account and the address it was sent to.
create or replace function app.portal_invitation(p_token uuid) returns table (tenant_name text, account_name text, email text, status text, has_login boolean)
language sql stable security definer set search_path = public, pg_temp, auth as $$
  select t.name, a.name, pu.email, pu.status, exists (select 1 from auth.users u where lower(u.email) = pu.email)
  from public.portal_users pu join public.tenants t on t.id = pu.tenant_id join public.accounts a on a.id = pu.account_id
  where pu.token = p_token and t.status = 'active'
$$;
revoke all on function app.portal_invitation(uuid) from public;
grant execute on function app.portal_invitation(uuid) to anon, authenticated;

-- Rule 1: the invited address accepts, signed in as that address. Returns the portal identity.
create or replace function app.accept_portal_invitation(p_token uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp, auth as $$
declare
  v_row public.portal_users;
  v_email text;
begin
  if auth.uid() is null then raise exception 'sign in to accept' using errcode = '42501'; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  select * into v_row from public.portal_users where token = p_token for update;
  if v_row.id is null or v_row.status = 'disabled' then raise exception 'this invitation is no longer valid' using errcode = '23514'; end if;
  if v_row.email <> v_email then raise exception 'this invitation was sent to another address' using errcode = '42501'; end if;
  if v_row.status = 'active' then
    if v_row.user_id <> auth.uid() then raise exception 'this invitation was already used' using errcode = '23514'; end if;
    return v_row.id;
  end if;
  update public.portal_users set user_id = auth.uid(), status = 'active', accepted_at = now() where id = v_row.id;
  return v_row.id;
end $$;
revoke all on function app.accept_portal_invitation(uuid) from public;
grant execute on function app.accept_portal_invitation(uuid) to authenticated;

-- The names of the people who served the identity's visits, for the visit history and the binder.
create or replace function app.portal_staff_names(p_tenant uuid) returns table (user_id uuid, name text)
language sql stable security definer set search_path = public, pg_temp, auth as $$
  select distinct m.user_id, coalesce(m.display_name, 'Technician')
  from public.memberships m
  where m.tenant_id = p_tenant and app.portal_account(p_tenant) is not null
    and exists (select 1 from public.visits v left join public.visit_crew c on c.visit_id = v.id
                where v.tenant_id = p_tenant and app.portal_property(v.tenant_id, v.property_id) and (v.technician_id = m.user_id or c.user_id = m.user_id))
$$;
revoke all on function app.portal_staff_names(uuid) from public;
grant execute on function app.portal_staff_names(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Settings, requests, booking forms, the intake log
-- ---------------------------------------------------------------------------

create table public.portal_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  allow_reschedule boolean not null default true,
  reschedule_notice_hours integer not null default 24 check (reschedule_notice_hours between 0 and 336),
  max_stops_per_day integer not null default 18 check (max_stops_per_day between 1 and 60),
  allow_requests boolean not null default true,
  requestable_service_type_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.portal_settings enable row level security;

create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  account_id uuid not null,
  property_id uuid not null,
  portal_user_id uuid references public.portal_users(id),
  kind text not null check (kind in ('reservice', 'booking', 'reschedule')),
  visit_id uuid,
  agreement_id uuid,
  service_type_id uuid references public.service_types(id),
  preferred_date date,
  arrival_window text check (arrival_window is null or arrival_window in ('any', 'morning', 'afternoon', 'evening')),
  details text check (details is null or length(details) <= 2000),
  status text not null default 'open' check (status in ('open', 'done', 'declined')),
  response text,
  result_visit_id uuid,
  handled_by uuid references auth.users(id),
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (tenant_id, account_id) references public.accounts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, property_id) references public.properties (tenant_id, id) on delete cascade,
  foreign key (tenant_id, visit_id) references public.visits (tenant_id, id),
  foreign key (tenant_id, agreement_id) references public.agreements (tenant_id, id),
  foreign key (tenant_id, result_visit_id) references public.visits (tenant_id, id),
  constraint service_requests_reservice check (kind <> 'reservice' or (agreement_id is not null and length(trim(coalesce(details, ''))) > 0)),
  constraint service_requests_booking check (kind <> 'booking' or service_type_id is not null),
  constraint service_requests_reschedule check (kind <> 'reschedule' or (visit_id is not null and preferred_date is not null)),
  constraint service_requests_declined check (status <> 'declined' or length(trim(coalesce(response, ''))) > 0)
);
alter table public.service_requests enable row level security;
create index service_requests_open on public.service_requests (tenant_id, status, created_at);

-- The property a request names is the account's, and its agreement and visit are at that property.
create or replace function app.check_service_request() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.properties p where p.id = new.property_id and p.tenant_id = new.tenant_id and p.account_id = new.account_id) then
    raise exception 'the property is not on this account' using errcode = '23514';
  end if;
  if new.agreement_id is not null and not exists (select 1 from public.agreements g where g.id = new.agreement_id and g.property_id = new.property_id) then
    raise exception 'the agreement is not at this property' using errcode = '23514';
  end if;
  if new.visit_id is not null and not exists (select 1 from public.visits v where v.id = new.visit_id and v.property_id = new.property_id) then
    raise exception 'the visit is not at this property' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger service_requests_check before insert or update on public.service_requests for each row execute function app.check_service_request();

create table public.lead_forms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key uuid not null unique default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  service_type_ids uuid[] not null default '{}',
  ask_preferred_date boolean not null default true,
  thank_you text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.lead_forms enable row level security;

create table public.intake_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  form_id uuid not null references public.lead_forms(id) on delete cascade,
  ip_hash text not null,
  result text not null check (result in ('accepted', 'limited', 'refused')),
  lead_id uuid,
  created_at timestamptz not null default now()
);
alter table public.intake_log enable row level security;
create index intake_log_recent on public.intake_log (form_id, created_at);

alter table public.leads add column service_type_id uuid references public.service_types(id);
alter table public.leads add column preferred_date date;
alter table public.leads add column arrival_window text check (arrival_window is null or arrival_window in ('any', 'morning', 'afternoon', 'evening'));
alter table public.leads add column form_id uuid references public.lead_forms(id) on delete set null;
alter table public.leads add column sms_consent boolean not null default false;

-- ---------------------------------------------------------------------------
-- Office policies for the new tables
-- ---------------------------------------------------------------------------

create policy portal_users_select on public.portal_users for select to authenticated
  using ((app.is_member(tenant_id) and app.has_permission(tenant_id, 'customers.read')) or user_id = auth.uid());
create policy portal_users_insert on public.portal_users for insert to authenticated with check (app.has_permission(tenant_id, 'customers.write'));
create policy portal_users_update on public.portal_users for update to authenticated
  using (app.has_permission(tenant_id, 'customers.write')) with check (app.has_permission(tenant_id, 'customers.write'));

create policy portal_settings_select on public.portal_settings for select to authenticated using (app.is_member(tenant_id) or app.portal_account(tenant_id) is not null);
create policy portal_settings_write on public.portal_settings for all to authenticated
  using (app.has_permission(tenant_id, 'settings.write')) with check (app.has_permission(tenant_id, 'settings.write'));

create policy service_requests_select on public.service_requests for select to authenticated
  using (app.has_permission(tenant_id, 'customers.read') or app.has_permission(tenant_id, 'dispatch.read')
         or ((select app.portal_user_id()) is not null and account_id = app.portal_account(tenant_id) and app.portal_property(tenant_id, property_id)));
create policy service_requests_insert on public.service_requests for insert to authenticated
  with check (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write')
              or ((select app.portal_user_id()) is not null and portal_user_id = app.portal_user_id() and account_id = app.portal_account(tenant_id)
                  and app.portal_property(tenant_id, property_id) and status = 'open' and handled_by is null and result_visit_id is null));
create policy service_requests_update on public.service_requests for update to authenticated
  using (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write'))
  with check (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write'));

create policy lead_forms_select on public.lead_forms for select to authenticated using (app.has_permission(tenant_id, 'customers.read'));
create policy lead_forms_write on public.lead_forms for all to authenticated
  using (app.has_permission(tenant_id, 'settings.write')) with check (app.has_permission(tenant_id, 'settings.write'));

create policy intake_log_select on public.intake_log for select to authenticated using (app.has_permission(tenant_id, 'customers.read'));

-- ---------------------------------------------------------------------------
-- Portal reads (rule 2): additive policies, so a member's access is unchanged and a portal identity sees its own rows.
-- ---------------------------------------------------------------------------

create policy tenants_portal on public.tenants for select to authenticated using ((select app.portal_user_id()) is not null and app.portal_account(id) is not null);
create policy accounts_portal on public.accounts for select to authenticated using ((select app.portal_user_id()) is not null and id = app.portal_account(tenant_id));
create policy properties_portal on public.properties for select to authenticated using ((select app.portal_user_id()) is not null and app.portal_property(tenant_id, id));
create policy service_types_portal on public.service_types for select to authenticated using ((select app.portal_user_id()) is not null and app.portal_account(tenant_id) is not null);
create policy branches_portal on public.branches for select to authenticated using ((select app.portal_user_id()) is not null and app.portal_account(tenant_id) is not null);
create policy agreements_portal on public.agreements for select to authenticated using ((select app.portal_user_id()) is not null and app.portal_property(tenant_id, property_id));
create policy visits_portal on public.visits for select to authenticated using ((select app.portal_user_id()) is not null and app.portal_property(tenant_id, property_id));
create policy application_records_portal on public.application_records for select to authenticated using ((select app.portal_user_id()) is not null and app.portal_visit(visit_id));
create policy amendments_portal on public.application_record_amendments for select to authenticated
  using ((select app.portal_user_id()) is not null and exists (select 1 from public.application_records r where r.id = record_id and app.portal_visit(r.visit_id)));
create policy notices_portal on public.notices for select to authenticated using ((select app.portal_user_id()) is not null and app.portal_property(tenant_id, property_id));
create policy invoices_portal on public.invoices for select to authenticated
  using ((select app.portal_user_id()) is not null and account_id = app.portal_account(tenant_id) and (property_id is null or app.portal_property(tenant_id, property_id)) and status <> 'draft');
create policy invoice_lines_portal on public.invoice_lines for select to authenticated
  using ((select app.portal_user_id()) is not null and exists (select 1 from public.invoices i where i.id = invoice_id and i.account_id = app.portal_account(i.tenant_id)));
create policy payments_portal on public.payments for select to authenticated using ((select app.portal_user_id()) is not null and account_id = app.portal_account(tenant_id));
create policy payment_allocations_portal on public.payment_allocations for select to authenticated
  using ((select app.portal_user_id()) is not null and exists (select 1 from public.payments p where p.id = payment_id and p.account_id = app.portal_account(p.tenant_id)));
create policy payment_methods_portal on public.payment_methods for select to authenticated using ((select app.portal_user_id()) is not null and account_id = app.portal_account(tenant_id));
create policy billing_settings_portal on public.billing_settings for select to authenticated using ((select app.portal_user_id()) is not null and app.portal_account(tenant_id) is not null);
create policy site_maps_portal on public.site_maps for select to authenticated using ((select app.portal_user_id()) is not null and app.portal_property(tenant_id, property_id));
create policy devices_portal on public.devices for select to authenticated using ((select app.portal_user_id()) is not null and app.portal_property(tenant_id, property_id));
create policy device_events_portal on public.device_events for select to authenticated
  using ((select app.portal_user_id()) is not null and exists (select 1 from public.devices d where d.id = device_id and app.portal_property(d.tenant_id, d.property_id)));
create policy device_checks_portal on public.device_checks for select to authenticated
  using ((select app.portal_user_id()) is not null and exists (select 1 from public.devices d where d.id = device_id and app.portal_property(d.tenant_id, d.property_id)));
create policy sightings_portal on public.sightings for select to authenticated using ((select app.portal_user_id()) is not null and app.portal_property(tenant_id, property_id));
create policy recommendations_portal on public.recommendations for select to authenticated using ((select app.portal_user_id()) is not null and app.portal_property(tenant_id, property_id));
create policy diagram_marks_portal on public.diagram_marks for select to authenticated using ((select app.portal_user_id()) is not null and app.portal_property(tenant_id, property_id));
create policy site_documents_portal on public.site_documents for select to authenticated using ((select app.portal_user_id()) is not null and shared and app.portal_property(tenant_id, property_id));
-- Rule 7: a site's map images and its shared documents are the only files a portal identity opens.
create policy files_portal on public.files for select to authenticated
  using ((select app.portal_user_id()) is not null and (
    exists (select 1 from public.site_maps m where m.file_id = files.id and m.tenant_id = files.tenant_id and app.portal_property(m.tenant_id, m.property_id))
    or exists (select 1 from public.site_documents d where d.file_id = files.id and d.tenant_id = files.tenant_id and d.shared and app.portal_property(d.tenant_id, d.property_id))));

-- ---------------------------------------------------------------------------
-- Portal writes (rules 3 and 6): paying, cards, sightings. Requests are above.
-- ---------------------------------------------------------------------------

create policy payments_portal_insert on public.payments for insert to authenticated
  with check ((select app.portal_user_id()) is not null and kind = 'payment' and method in ('card', 'us_bank_account') and account_id = app.portal_account(tenant_id) and recorded_by is null);
create policy payments_portal_update on public.payments for update to authenticated
  using ((select app.portal_user_id()) is not null and kind = 'payment' and account_id = app.portal_account(tenant_id) and recorded_by is null)
  with check ((select app.portal_user_id()) is not null and kind = 'payment' and account_id = app.portal_account(tenant_id) and recorded_by is null);
create policy payment_allocations_portal_insert on public.payment_allocations for insert to authenticated
  with check ((select app.portal_user_id()) is not null
              and exists (select 1 from public.payments p where p.id = payment_id and p.account_id = app.portal_account(p.tenant_id) and p.recorded_by is null)
              and exists (select 1 from public.invoices i where i.id = invoice_id and i.account_id = app.portal_account(i.tenant_id)));
create policy payment_methods_portal_insert on public.payment_methods for insert to authenticated
  with check ((select app.portal_user_id()) is not null and account_id = app.portal_account(tenant_id));
create policy payment_methods_portal_update on public.payment_methods for update to authenticated
  using ((select app.portal_user_id()) is not null and account_id = app.portal_account(tenant_id))
  with check ((select app.portal_user_id()) is not null and account_id = app.portal_account(tenant_id));
create policy sightings_portal_insert on public.sightings for insert to authenticated
  with check ((select app.portal_user_id()) is not null and source = 'customer' and visit_id is null and resolved_at is null and app.portal_property(tenant_id, property_id));

-- The gateway customer for the identity's own account (spec 08 keeps the id on the account).
create or replace function app.set_account_gateway_customer(p_tenant uuid, p_account uuid, p_customer text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  changed integer;
begin
  if auth.uid() is not null and not app.has_permission(p_tenant, 'billing.write') and app.portal_account(p_tenant) is distinct from p_account then
    raise exception 'gateway customers need billing.write' using errcode = '42501';
  end if;
  update public.accounts set gateway_customer_id = p_customer where id = p_account and tenant_id = p_tenant;
  get diagnostics changed = row_count;
  return changed > 0;
end $$;

-- ---------------------------------------------------------------------------
-- Rule 5: the self-service reschedule. The server reads the dispatch check's inputs through the context function, runs
-- the check, and only then moves the visit; the move re-checks every rule the database can.
-- ---------------------------------------------------------------------------

create or replace function app.portal_reschedule_context(p_visit uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v public.visits;
  v_out jsonb;
begin
  select * into v from public.visits where id = p_visit;
  if v.id is null or not app.portal_property(v.tenant_id, v.property_id) then raise exception 'not your visit' using errcode = '42501'; end if;
  select jsonb_build_object(
    'visit', jsonb_build_object(
      'id', v.id, 'agreement_id', v.agreement_id, 'account_id', v.account_id, 'property_id', v.property_id, 'service_type_id', v.service_type_id,
      'branch_id', v.branch_id, 'kind', v.kind, 'status', v.status, 'due_start', v.due_start, 'due_end', v.due_end, 'scheduled_for', v.scheduled_for,
      'technician_id', v.technician_id, 'route_position', v.route_position, 'arrival_window', v.arrival_window,
      'job_kind', st.job_kind, 'treatment_areas', st.treatment_areas, 'property_state', p.state_code, 'registry_matches', p.registry_matches,
      'registry_notice_dates', coalesce((select jsonb_agg(distinct n.for_scheduled_for) from public.notices n
                                         where n.visit_id = v.id and n.kind = 'registry_advance' and n.status = 'sent' and n.for_scheduled_for is not null), '[]'::jsonb),
      'branch_license', case when b.id is null then null else jsonb_build_object('expires_on', b.license_expires_on) end,
      'account_past_due_since', ac.past_due_since,
      'authorization_on_file', exists (select 1 from public.job_authorizations ja where ja.agreement_id = v.agreement_id)),
    'state_rule', (select jsonb_build_object('required_cert_categories', r.required_cert_categories, 'pack_version', r.pack_version, 'confirmed_at', r.confirmed_at)
                   from public.service_type_state_rules r where r.service_type_id = v.service_type_id and r.state_code = p.state_code),
    'crew', coalesce((select jsonb_agg(jsonb_build_object(
              'user_id', c.user_id, 'role', c.role, 'name', coalesce(m.display_name, 'Technician'), 'branch_ids', m.branch_ids,
              'credential', (select jsonb_build_object('cert_number', cr.cert_number, 'categories', cr.categories, 'cert_expires_on', cr.cert_expires_on,
                                                       'license_expires_on', cr.license_expires_on, 'trainee_registered_on', cr.trainee_registered_on, 'supervisor_id', cr.supervisor_id)
                             from public.applicator_credentials cr where cr.tenant_id = v.tenant_id and cr.user_id = c.user_id and cr.state_code = p.state_code and cr.archived_at is null limit 1))
              order by case c.role when 'lead' then 0 else 1 end)
            from public.visit_crew c left join public.memberships m on m.tenant_id = c.tenant_id and m.user_id = c.user_id where c.visit_id = v.id), '[]'::jsonb),
    'pause_when_past_due', coalesce((select bs.pause_when_past_due from public.billing_settings bs where bs.tenant_id = v.tenant_id), false),
    'settings', (select jsonb_build_object('allow_reschedule', s.allow_reschedule, 'reschedule_notice_hours', s.reschedule_notice_hours, 'max_stops_per_day', s.max_stops_per_day)
                 from public.portal_settings s where s.tenant_id = v.tenant_id),
    'stops', coalesce((select jsonb_object_agg(d::text, n) from (
               select o.scheduled_for as d, count(*) as n from public.visits o
               where o.tenant_id = v.tenant_id and o.technician_id = v.technician_id and o.id <> v.id and o.scheduled_for between v.due_start and v.due_end
                 and o.status in ('scheduled', 'en_route', 'in_progress', 'completed') group by o.scheduled_for) x), '{}'::jsonb),
    'timezone', t.timezone)
  into v_out
  from public.service_types st, public.properties p, public.accounts ac, public.tenants t
  left join public.branches b on b.id = v.branch_id
  where st.id = v.service_type_id and p.id = v.property_id and ac.id = v.account_id and t.id = v.tenant_id;
  return v_out;
end $$;
revoke all on function app.portal_reschedule_context(uuid) from public;
grant execute on function app.portal_reschedule_context(uuid) to authenticated;

create or replace function app.portal_move_visit(p_visit uuid, p_date date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.visits;
  s public.portal_settings;
  v_tz text;
  v_now timestamptz := now();
  v_stops integer;
  v_request uuid;
begin
  select * into v from public.visits where id = p_visit for update;
  if v.id is null or not app.portal_property(v.tenant_id, v.property_id) then raise exception 'not your visit' using errcode = '42501'; end if;
  select * into s from public.portal_settings where tenant_id = v.tenant_id;
  if s.id is null or not s.allow_reschedule then raise exception 'the company takes reschedules by request' using errcode = '23514'; end if;
  if v.status <> 'scheduled' or v.technician_id is null or v.scheduled_for is null then raise exception 'only a scheduled visit can be moved' using errcode = '23514'; end if;
  if p_date = v.scheduled_for then return null; end if;
  if p_date < v.due_start or p_date > v.due_end then raise exception 'pick a day from % to %', v.due_start, v.due_end using errcode = '23514'; end if;
  select timezone into v_tz from public.tenants where id = v.tenant_id;
  if (v.scheduled_for::timestamp at time zone v_tz) < v_now + make_interval(hours => s.reschedule_notice_hours)
     or (p_date::timestamp at time zone v_tz) < v_now + make_interval(hours => s.reschedule_notice_hours) then
    raise exception 'moves need % hours notice', s.reschedule_notice_hours using errcode = '23514';
  end if;
  select count(*) into v_stops from public.visits o
  where o.tenant_id = v.tenant_id and o.technician_id = v.technician_id and o.scheduled_for = p_date and o.id <> v.id and o.status in ('scheduled', 'en_route', 'in_progress', 'completed');
  if v_stops >= s.max_stops_per_day then raise exception 'that day is full' using errcode = '23514'; end if;
  update public.visits set scheduled_for = p_date, route_position = v_stops + 1 where id = v.id;
  insert into public.service_requests (tenant_id, account_id, property_id, portal_user_id, kind, visit_id, agreement_id, preferred_date, details, status, response, handled_at)
  values (v.tenant_id, v.account_id, v.property_id, app.portal_user_id(), 'reschedule', v.id, v.agreement_id, p_date,
          'Moved in the portal from ' || v.scheduled_for::text, 'done', 'Moved by the customer within the company''s rules.', now())
  returning id into v_request;
  return v_request;
end $$;
revoke all on function app.portal_move_visit(uuid, date) from public;
grant execute on function app.portal_move_visit(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Rule 8: the public booking form's intake. Anyone may post; the form decides the company, the limits keep it sane.
-- ---------------------------------------------------------------------------

create or replace function app.lead_form(p_key uuid) returns table (tenant_name text, timezone text, name text, ask_preferred_date boolean, thank_you text, services jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.name, t.timezone, f.name, f.ask_preferred_date, f.thank_you,
         coalesce((select jsonb_agg(jsonb_build_object('id', st.id, 'name', st.name) order by st.name) from public.service_types st
                   where st.id = any(f.service_type_ids) and st.tenant_id = f.tenant_id and st.archived_at is null), '[]'::jsonb)
  from public.lead_forms f join public.tenants t on t.id = f.tenant_id
  where f.key = p_key and f.active and t.status = 'active'
$$;
revoke all on function app.lead_form(uuid) from public;
grant execute on function app.lead_form(uuid) to anon, authenticated;

create or replace function app.intake_lead(p_key uuid, p_payload jsonb, p_ip_hash text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f public.lead_forms;
  v_status text;
  v_source uuid;
  v_lead uuid;
  v_service uuid := nullif(p_payload ->> 'service_type_id', '')::uuid;
  v_state text := upper(nullif(trim(p_payload ->> 'state_code'), ''));
  v_window text := coalesce(nullif(p_payload ->> 'arrival_window', ''), 'any');
begin
  select * into f from public.lead_forms where key = p_key and active;
  if f.id is null then raise exception 'this form is not taking requests' using errcode = '23514'; end if;
  select status into v_status from public.tenants where id = f.tenant_id;
  if v_status <> 'active' then raise exception 'this form is not taking requests' using errcode = '23514'; end if;
  if coalesce(length(p_ip_hash), 0) < 8 then raise exception 'missing client fingerprint' using errcode = '23514'; end if;
  if (select count(*) from public.intake_log l where l.form_id = f.id and l.ip_hash = p_ip_hash and l.created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.intake_log l where l.form_id = f.id and l.created_at > now() - interval '1 day') >= 200 then
    insert into public.intake_log (tenant_id, form_id, ip_hash, result) values (f.tenant_id, f.id, p_ip_hash, 'limited');
    raise exception 'too many requests; try again later' using errcode = '54000';
  end if;
  if length(trim(coalesce(p_payload ->> 'name', ''))) = 0
     or (length(trim(coalesce(p_payload ->> 'email', ''))) = 0 and length(trim(coalesce(p_payload ->> 'phone', ''))) = 0)
     or length(trim(coalesce(p_payload ->> 'line1', ''))) = 0 then
    raise exception 'a name, an email or phone, and an address are needed' using errcode = '23514';
  end if;
  if v_service is not null and not (v_service = any(f.service_type_ids)) then raise exception 'pick a service from the list' using errcode = '23514'; end if;
  if v_service is null and cardinality(f.service_type_ids) > 0 then raise exception 'pick a service from the list' using errcode = '23514'; end if;
  if v_state is not null and v_state !~ '^[A-Z]{2}$' then raise exception 'the state is its two-letter code' using errcode = '23514'; end if;
  if v_window not in ('any', 'morning', 'afternoon', 'evening') then v_window := 'any'; end if;
  select id into v_source from public.lead_sources where tenant_id = f.tenant_id and key = 'website';
  if v_source is null then
    insert into public.lead_sources (tenant_id, key, name) values (f.tenant_id, 'website', 'Website') returning id into v_source;
  end if;
  insert into public.leads (tenant_id, source_id, name, email, phone, line1, city, state_code, postal_code, notes, service_type_id, preferred_date, arrival_window, form_id, sms_consent)
  values (f.tenant_id, v_source, left(trim(p_payload ->> 'name'), 200), nullif(lower(trim(p_payload ->> 'email')), ''), nullif(trim(p_payload ->> 'phone'), ''),
          left(trim(p_payload ->> 'line1'), 200), nullif(left(trim(p_payload ->> 'city'), 100), ''), v_state, nullif(left(trim(p_payload ->> 'postal_code'), 10), ''),
          nullif(left(trim(p_payload ->> 'message'), 2000), ''), v_service,
          case when f.ask_preferred_date and coalesce(p_payload ->> 'preferred_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_payload ->> 'preferred_date')::date end,
          v_window, f.id, coalesce((p_payload ->> 'sms_consent')::boolean, false))
  returning id into v_lead;
  insert into public.intake_log (tenant_id, form_id, ip_hash, result, lead_id) values (f.tenant_id, f.id, p_ip_hash, 'accepted', v_lead);
  return v_lead;
end $$;
revoke all on function app.intake_lead(uuid, jsonb, text) from public;
grant execute on function app.intake_lead(uuid, jsonb, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Timestamps, audit, the write guard
-- ---------------------------------------------------------------------------

create trigger portal_users_updated_at before update on public.portal_users for each row execute function app.set_updated_at();
create trigger portal_settings_updated_at before update on public.portal_settings for each row execute function app.set_updated_at();
create trigger service_requests_updated_at before update on public.service_requests for each row execute function app.set_updated_at();
create trigger lead_forms_updated_at before update on public.lead_forms for each row execute function app.set_updated_at();
create trigger portal_users_audit after insert or update or delete on public.portal_users for each row execute function app.write_audit();
create trigger lead_forms_audit after insert or update or delete on public.lead_forms for each row execute function app.write_audit();

create trigger tenant_write_guard before insert or update or delete on public.portal_users for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.portal_settings for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.service_requests for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.lead_forms for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.intake_log for each row execute function app.guard_tenant_write();
