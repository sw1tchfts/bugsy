-- Spec 20: integrations and API. API keys (hashed, scoped) with a request log and a rate limit, outgoing webhooks
-- queued by triggers wherever their events happen, QuickBooks Online connection, mapping and daily syncs, phone calls,
-- and the definer functions the public API runs through (no user: the key names the company and its scopes).

-- ---------------------------------------------------------------------------
-- API keys and requests (rules 1 and 2)
-- ---------------------------------------------------------------------------

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  prefix text not null unique check (prefix ~ '^[a-z0-9]{8}$'),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null check (scopes <@ array['accounts.read', 'leads.write', 'requests.write', 'availability.read', 'visits.read', 'invoices.read', 'devices.write']::text[] and cardinality(scopes) > 0),
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, id)
);
alter table public.api_keys enable row level security;
-- Members never read a key's hash; the API reads it through app.api_key().
revoke select on public.api_keys from authenticated;
grant select (id, tenant_id, name, prefix, scopes, last_used_at, revoked_at, created_at, updated_at, created_by) on public.api_keys to authenticated;

-- Rule 1: a key never acts as a person; what it writes names the key. Only the API's own functions (no user) set it.
alter table public.leads add column api_key_id uuid;
alter table public.leads add constraint leads_api_key_fk foreign key (tenant_id, api_key_id) references public.api_keys (tenant_id, id) on delete set null (api_key_id);
alter table public.service_requests add column api_key_id uuid;
alter table public.service_requests add constraint service_requests_api_key_fk foreign key (tenant_id, api_key_id) references public.api_keys (tenant_id, id) on delete set null (api_key_id);
alter table public.device_checks add column api_key_id uuid;
alter table public.device_checks add constraint device_checks_api_key_fk foreign key (tenant_id, api_key_id) references public.api_keys (tenant_id, id) on delete set null (api_key_id);
create or replace function app.api_key_only() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null then
    new.api_key_id := case when tg_op = 'UPDATE' then old.api_key_id end;
  end if;
  return new;
end $$;
create trigger leads_api_key before insert or update of api_key_id on public.leads for each row execute function app.api_key_only();
create trigger service_requests_api_key before insert or update of api_key_id on public.service_requests for each row execute function app.api_key_only();
create trigger device_checks_api_key before insert or update of api_key_id on public.device_checks for each row execute function app.api_key_only();

create table public.api_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  api_key_id uuid not null,
  method text not null,
  path text not null,
  status integer not null,
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, api_key_id) references public.api_keys (tenant_id, id) on delete cascade
);
alter table public.api_requests enable row level security;
create index api_requests_recent on public.api_requests (api_key_id, at desc);

-- The key behind a request: its company and scopes when it is live and under its limit (60 a minute).
create or replace function app.api_key(p_prefix text, p_hash text) returns table (key_id uuid, tenant_id uuid, scopes text[], limited boolean)
language sql security definer set search_path = public, pg_temp as $$
  select k.id, k.tenant_id, k.scopes,
         (select count(*) from public.api_requests r where r.api_key_id = k.id and r.at > now() - interval '1 minute') >= 60
  from public.api_keys k join public.tenants t on t.id = k.tenant_id
  where k.prefix = p_prefix and k.key_hash = p_hash and k.revoked_at is null and t.status = 'active'
$$;

-- Every call is logged, without its body; the key's last use is kept.
create or replace function app.api_log(p_key uuid, p_method text, p_path text, p_status integer) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.api_requests (tenant_id, api_key_id, method, path, status)
  select k.tenant_id, k.id, left(p_method, 10), left(p_path, 200), p_status from public.api_keys k where k.id = p_key;
  update public.api_keys set last_used_at = now() where id = p_key;
  delete from public.api_requests where api_key_id = p_key and at < now() - interval '30 days';
$$;

-- The scope check every API function starts with; refuses a revoked key or a missing scope.
create or replace function app.api_scope(p_key uuid, p_scope text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid;
begin
  select k.tenant_id into v_tenant from public.api_keys k join public.tenants t on t.id = k.tenant_id
  where k.id = p_key and k.revoked_at is null and p_scope = any(k.scopes) and t.status = 'active';
  if v_tenant is null then raise exception 'this key does not have the % scope', p_scope using errcode = '42501'; end if;
  return v_tenant;
end $$;

-- ---------------------------------------------------------------------------
-- The API's reads and writes (rules 2 to 4 and 9)
-- ---------------------------------------------------------------------------

-- A caller by phone or email: contacts, accounts and leads of the key's company, newest first.
create or replace function app.api_lookup(p_key uuid, p_phone text, p_email text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.api_scope(p_key, 'accounts.read');
  v_digits text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if length(v_digits) < 10 and v_email = '' then raise exception 'send a phone number or an email' using errcode = '22023'; end if;
  return jsonb_build_object(
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object('account_id', a.id, 'name', a.name, 'status', a.status,
               'properties', (select coalesce(jsonb_agg(jsonb_build_object('property_id', p.id, 'address', p.normalized_address)), '[]'::jsonb) from public.properties p where p.account_id = a.id and p.archived_at is null)))
      from public.accounts a
      where a.tenant_id = v_tenant and a.archived_at is null
        and ((length(v_digits) = 10 and (right(a.phone_digits, 10) = v_digits or exists (select 1 from public.contacts c where c.account_id = a.id and right(c.phone_digits, 10) = v_digits)))
             or (v_email <> '' and (a.email = v_email or exists (select 1 from public.contacts c where c.account_id = a.id and lower(c.email) = v_email))))), '[]'::jsonb),
    'leads', coalesce((
      select jsonb_agg(jsonb_build_object('lead_id', l.id, 'name', l.name, 'stage', l.stage) order by l.created_at desc)
      from public.leads l where l.tenant_id = v_tenant and l.account_id is null
        and ((length(v_digits) = 10 and right(l.phone_digits, 10) = v_digits) or (v_email <> '' and l.email = v_email))), '[]'::jsonb));
end $$;

-- A lead from an integration, with its source (a marketplace's name becomes a lead source) and possible matches.
create or replace function app.api_create_lead(p_key uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.api_scope(p_key, 'leads.write');
  v_source_name text := coalesce(nullif(left(trim(p_payload ->> 'source'), 80), ''), 'API');
  v_source_key text := 'api_' || left(regexp_replace(lower(v_source_name), '[^a-z0-9]+', '_', 'g'), 40);
  v_source uuid;
  v_lead uuid;
  v_name text := left(trim(coalesce(p_payload ->> 'name', '')), 200);
  v_email text := nullif(lower(trim(coalesce(p_payload ->> 'email', ''))), '');
  v_phone text := nullif(left(trim(coalesce(p_payload ->> 'phone', '')), 40), '');
  v_digits text;
  v_matches jsonb;
begin
  if v_name = '' or (v_email is null and v_phone is null) then raise exception 'a lead needs a name and an email or phone' using errcode = '22023'; end if;
  select id into v_source from public.lead_sources where tenant_id = v_tenant and key = v_source_key;
  if v_source is null then
    insert into public.lead_sources (tenant_id, key, name) values (v_tenant, v_source_key, v_source_name) returning id into v_source;
  end if;
  insert into public.leads (tenant_id, source_id, name, email, phone, line1, city, state_code, postal_code, notes, api_key_id)
  values (v_tenant, v_source, v_name, v_email, v_phone, nullif(left(trim(coalesce(p_payload ->> 'line1', '')), 200), ''), nullif(left(trim(coalesce(p_payload ->> 'city', '')), 100), ''),
          nullif(upper(left(trim(coalesce(p_payload ->> 'state_code', '')), 2)), ''), nullif(left(trim(coalesce(p_payload ->> 'postal_code', '')), 10), ''),
          nullif(left(trim(coalesce(p_payload ->> 'notes', '')), 2000), ''), p_key)
  returning id into v_lead;
  -- Rule 3: the office's duplicate rule (spec 02: an account, a contact or another open lead with the same email or
  -- phone), answered rather than refused.
  v_digits := right(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), 10);
  select coalesce(jsonb_agg(m), '[]'::jsonb) into v_matches from (
    select jsonb_build_object('kind', 'account', 'id', a.id, 'name', a.name) as m
    from public.accounts a where a.tenant_id = v_tenant and a.archived_at is null
      and ((v_email is not null and (lower(a.email) = v_email or exists (select 1 from public.contacts c where c.account_id = a.id and c.archived_at is null and lower(c.email) = v_email)))
           or (length(v_digits) = 10 and (right(a.phone_digits, 10) = v_digits or exists (select 1 from public.contacts c where c.account_id = a.id and c.archived_at is null and right(c.phone_digits, 10) = v_digits))))
    union all
    select jsonb_build_object('kind', 'lead', 'id', l.id, 'name', l.name)
    from public.leads l where l.tenant_id = v_tenant and l.id <> v_lead and l.account_id is null
      and ((v_email is not null and lower(l.email) = v_email) or (length(v_digits) = 10 and right(l.phone_digits, 10) = v_digits))
  ) x;
  return jsonb_build_object('lead_id', v_lead, 'source', v_source_name, 'possible_matches', v_matches);
end $$;

-- A service request for an existing property, for the office's inbox (spec 16) to confirm.
create or replace function app.api_create_request(p_key uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.api_scope(p_key, 'requests.write');
  v_property public.properties;
  v_kind text := coalesce(p_payload ->> 'kind', 'booking');
  v_service uuid;
  v_id uuid;
  v_date date;
begin
  select * into v_property from public.properties where id = nullif(p_payload ->> 'property_id', '')::uuid and tenant_id = v_tenant and archived_at is null;
  if v_property.id is null then raise exception 'no such property' using errcode = 'P0002'; end if;
  if v_kind not in ('booking', 'reservice') then raise exception 'kind is booking or reservice' using errcode = '22023'; end if;
  begin
    select st.id into v_service from public.service_types st where st.id = nullif(p_payload ->> 'service_type_id', '')::uuid and st.tenant_id = v_tenant;
  exception when others then
    raise exception 'service_type_id is an id' using errcode = '22023';
  end;
  if v_kind = 'booking' and v_service is null then raise exception 'a booking names one of the company''s service types (service_type_id)' using errcode = '22023'; end if;
  begin
    v_date := nullif(p_payload ->> 'preferred_date', '')::date;
  exception when others then
    raise exception 'preferred_date is a day, YYYY-MM-DD' using errcode = '22023';
  end;
  insert into public.service_requests (tenant_id, account_id, property_id, kind, service_type_id, preferred_date, details, agreement_id, api_key_id)
  values (v_tenant, v_property.account_id, v_property.id, v_kind, v_service, v_date,
          nullif(left(trim(coalesce(p_payload ->> 'details', '')), 2000), ''),
          case when v_kind = 'reservice' then (select g.id from public.agreements g where g.property_id = v_property.id and g.status = 'active' order by g.starts_on desc limit 1) end,
          p_key)
  returning id into v_id;
  return jsonb_build_object('request_id', v_id, 'status', 'open');
end $$;

-- Rule 4: days in the next 14 where a technician of the property's branch has room; a promise of nothing.
create or replace function app.api_availability(p_key uuid, p_property uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.api_scope(p_key, 'availability.read');
  v_branch uuid;
  v_tz text;
  v_limit integer;
begin
  select (select g.branch_id from public.agreements g where g.property_id = p.id order by g.starts_on desc limit 1) into v_branch
  from public.properties p where p.id = p_property and p.tenant_id = v_tenant;
  if not found then raise exception 'no such property' using errcode = 'P0002'; end if;
  select timezone into v_tz from public.tenants where id = v_tenant;
  select coalesce((select max_stops_per_day from public.portal_settings where tenant_id = v_tenant), 18) into v_limit;
  return coalesce((
    select jsonb_agg(jsonb_build_object('date', d::date, 'windows', jsonb_build_array('morning', 'afternoon')) order by d)
    from generate_series((now() at time zone v_tz)::date + 1, (now() at time zone v_tz)::date + 14, interval '1 day') d
    where extract(isodow from d) < 6 and exists (
      select 1 from public.memberships m join public.roles r on r.id = m.role_id
      where m.tenant_id = v_tenant and ('visits.write' = any(r.permissions) or '*' = any(r.permissions))
        and ((not ('dispatch.write' = any(r.permissions)) and not ('*' = any(r.permissions)))
             or exists (select 1 from public.applicator_credentials c where c.tenant_id = m.tenant_id and c.user_id = m.user_id and c.archived_at is null))
        and (v_branch is null or m.branch_ids is null or v_branch = any(m.branch_ids))
        and (select count(*) from public.visits v where v.tenant_id = v_tenant and v.technician_id = m.user_id and v.scheduled_for = d::date
               and v.status in ('scheduled', 'en_route', 'in_progress')) < v_limit)), '[]'::jsonb);
end $$;

create or replace function app.api_visits(p_key uuid, p_account uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.api_scope(p_key, 'visits.read');
begin
  if p_to < p_from or p_to - p_from > 366 then raise exception 'from and to span at most a year' using errcode = '22023'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('visit_id', v.id, 'property_id', v.property_id, 'service_type', st.name, 'status', v.status, 'kind', v.kind,
                                        'due_start', v.due_start, 'due_end', v.due_end, 'scheduled_for', v.scheduled_for, 'arrival_window', v.arrival_window,
                                        'completed_at', v.completed_at) order by coalesce(v.scheduled_for, v.due_start))
    from public.visits v join public.service_types st on st.id = v.service_type_id
    where v.tenant_id = v_tenant and v.account_id = p_account and coalesce(v.scheduled_for, v.due_start) between p_from and p_to), '[]'::jsonb);
end $$;

create or replace function app.api_invoices(p_key uuid, p_account uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.api_scope(p_key, 'invoices.read');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('invoice_id', i.id, 'number', i.number, 'status', i.status, 'issued_on', i.issued_on, 'due_on', i.due_on,
                                        'total_cents', i.total_cents, 'paid_cents', i.paid_cents) order by i.issued_on desc)
    from public.invoices i where i.tenant_id = v_tenant and i.account_id = p_account and i.kind = 'invoice' and i.status <> 'draft'), '[]'::jsonb);
end $$;

-- Rule 9: a smart trap's event becomes a sensor check on its device.
create or replace function app.api_device_event(p_key uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app.api_scope(p_key, 'devices.write');
  v_device uuid;
  v_id uuid;
  v_count integer;
  v_at timestamptz;
begin
  select d.id into v_device from public.devices d where d.tenant_id = v_tenant and d.barcode = p_payload ->> 'barcode' and d.status = 'active';
  if v_device is null then raise exception 'no active device with that barcode' using errcode = 'P0002'; end if;
  begin
    v_count := nullif(p_payload ->> 'count', '')::integer;
    v_at := least(coalesce(nullif(p_payload ->> 'at', '')::timestamptz, now()), now());
  exception when others then
    raise exception 'count is a whole number and at is a time' using errcode = '22023';
  end;
  insert into public.device_checks (tenant_id, device_id, checked_at, checked_by, source, status, activity, count, pest, notes, api_key_id)
  values (v_tenant, v_device, v_at, null, 'sensor', 'checked',
          case when coalesce(v_count, 0) = 0 then 'none' when v_count < 3 then 'low' when v_count < 10 then 'medium' else 'high' end,
          v_count, nullif(left(p_payload ->> 'pest', 100), ''), nullif(left(p_payload ->> 'note', 500), ''), p_key)
  returning id into v_id;
  return jsonb_build_object('check_id', v_id);
end $$;

-- ---------------------------------------------------------------------------
-- Outgoing webhooks (rules 5 and 6): queued by triggers where events happen, sent by the messaging job
-- ---------------------------------------------------------------------------

create table public.webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  url text not null check (url ~ '^https?://' and length(url) <= 500),
  events text[] not null check (events <@ array['lead.created', 'service_request.created', 'visit.scheduled', 'visit.completed', 'invoice.paid']::text[] and cardinality(events) > 0),
  secret text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, id)
);
alter table public.webhook_subscriptions enable row level security;
revoke select on public.webhook_subscriptions from authenticated;
grant select (id, tenant_id, url, events, active, created_at, updated_at, created_by) on public.webhook_subscriptions to authenticated;

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subscription_id uuid not null,
  event text not null,
  payload jsonb not null,
  attempt integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  response_status integer,
  response_body text,
  next_at timestamptz not null default now(),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, subscription_id) references public.webhook_subscriptions (tenant_id, id) on delete cascade
);
alter table public.webhook_deliveries enable row level security;
create index webhook_deliveries_due on public.webhook_deliveries (status, next_at);

create or replace function app.enqueue_webhook(p_tenant uuid, p_event text, p_data jsonb) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.webhook_deliveries (tenant_id, subscription_id, event, payload)
  select s.tenant_id, s.id, p_event, jsonb_build_object('event', p_event, 'id', gen_random_uuid(), 'created_at', now(), 'data', p_data)
  from public.webhook_subscriptions s where s.tenant_id = p_tenant and s.active and p_event = any(s.events)
$$;

create or replace function app.webhook_events() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.webhook_subscriptions s where s.tenant_id = new.tenant_id and s.active) then return new; end if;
  if tg_table_name = 'leads' and tg_op = 'INSERT' then
    perform app.enqueue_webhook(new.tenant_id, 'lead.created', jsonb_build_object('lead_id', new.id, 'name', new.name, 'email', new.email, 'phone', new.phone,
      'source', (select s.name from public.lead_sources s where s.id = new.source_id), 'created_at', new.created_at));
  elsif tg_table_name = 'service_requests' and tg_op = 'INSERT' then
    perform app.enqueue_webhook(new.tenant_id, 'service_request.created', jsonb_build_object('request_id', new.id, 'account_id', new.account_id, 'property_id', new.property_id,
      'kind', new.kind, 'preferred_date', new.preferred_date, 'created_at', new.created_at));
  elsif tg_table_name = 'visits' and tg_op = 'UPDATE' then
    if new.status = 'scheduled' and (old.status is distinct from 'scheduled' or new.scheduled_for is distinct from old.scheduled_for) then
      perform app.enqueue_webhook(new.tenant_id, 'visit.scheduled', jsonb_build_object('visit_id', new.id, 'account_id', new.account_id, 'property_id', new.property_id,
        'scheduled_for', new.scheduled_for, 'arrival_window', new.arrival_window,
        'technician', (select m.display_name from public.memberships m where m.tenant_id = new.tenant_id and m.user_id = new.technician_id)));
    elsif new.status = 'completed' and old.status is distinct from 'completed' then
      perform app.enqueue_webhook(new.tenant_id, 'visit.completed', jsonb_build_object('visit_id', new.id, 'account_id', new.account_id, 'property_id', new.property_id,
        'completed_at', new.completed_at, 'service_type', (select st.name from public.service_types st where st.id = new.service_type_id)));
    end if;
  elsif tg_table_name = 'invoices' and tg_op = 'UPDATE' and new.status = 'paid' and old.status is distinct from 'paid' and new.kind = 'invoice' then
    perform app.enqueue_webhook(new.tenant_id, 'invoice.paid', jsonb_build_object('invoice_id', new.id, 'account_id', new.account_id, 'number', new.number,
      'total_cents', new.total_cents, 'paid_at', now()));
  end if;
  return new;
end $$;
create trigger leads_webhooks after insert on public.leads for each row execute function app.webhook_events();
create trigger service_requests_webhooks after insert on public.service_requests for each row execute function app.webhook_events();
create trigger visits_webhooks after update of status, scheduled_for on public.visits for each row execute function app.webhook_events();
create trigger invoices_webhooks after update of status on public.invoices for each row execute function app.webhook_events();

-- The messaging job's share: what is due, with its secret, and the outcome written back (rule 5).
create or replace function app.webhooks_due(p_tenant uuid) returns table (id uuid, url text, secret text, event text, payload jsonb, attempt integer)
language sql security definer set search_path = public, pg_temp as $$
  select d.id, s.url, s.secret, d.event, d.payload, d.attempt
  from public.webhook_deliveries d join public.webhook_subscriptions s on s.id = d.subscription_id
  where d.tenant_id = p_tenant and d.status = 'pending' and d.next_at <= now() and s.active
    and (auth.uid() is null or app.has_permission(p_tenant, 'integrations.manage') or app.has_permission(p_tenant, 'messages.manage'))
  order by d.created_at limit 100
$$;

create or replace function app.webhook_result(p_delivery uuid, p_status integer, p_body text, p_next timestamptz) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d public.webhook_deliveries;
begin
  select * into d from public.webhook_deliveries where id = p_delivery for update;
  if d.id is null then return; end if;
  if auth.uid() is not null and not (app.has_permission(d.tenant_id, 'integrations.manage') or app.has_permission(d.tenant_id, 'messages.manage')) then
    raise exception 'sending webhooks needs integrations.manage' using errcode = '42501';
  end if;
  update public.webhook_deliveries set attempt = d.attempt + 1, response_status = p_status, response_body = left(p_body, 1024),
    status = case when p_status between 200 and 299 then 'delivered' when p_next is null then 'failed' else 'pending' end,
    delivered_at = case when p_status between 200 and 299 then now() end, next_at = coalesce(p_next, d.next_at)
  where id = p_delivery;
  -- A receiver that is gone for good says so (410): its subscription stops.
  if p_status = 410 then update public.webhook_subscriptions set active = false where id = d.subscription_id; end if;
  delete from public.webhook_deliveries where tenant_id = d.tenant_id and created_at < now() - interval '30 days';
end $$;

-- ---------------------------------------------------------------------------
-- Connections, QuickBooks (rule 7) and calls (rule 8)
-- ---------------------------------------------------------------------------

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null check (provider in ('quickbooks', 'phone')),
  status text not null default 'connected' check (status in ('connected', 'needs_reconnect', 'disconnected')),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  -- Encrypted by the app with its integration secret; never readable by members.
  tokens text,
  inbound_key uuid not null unique default gen_random_uuid(),
  inbound_secret text not null default encode(sha256(gen_random_uuid()::text::bytea || gen_random_uuid()::text::bytea), 'hex'),
  connected_by uuid default auth.uid(),
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider)
);
alter table public.integration_connections enable row level security;
revoke select on public.integration_connections from authenticated;
grant select (id, tenant_id, provider, status, settings, inbound_key, connected_by, connected_at, created_at, updated_at) on public.integration_connections to authenticated;
-- Nobody without a user reads the tables that hold secrets; the API and the phone hook use definer functions.
revoke all on public.api_keys, public.webhook_subscriptions, public.integration_connections from anon;

-- The app's own reads of what members may not see: tokens for the QuickBooks client, the phone hook's secret.
create or replace function app.connection_secrets(p_tenant uuid, p_provider text) returns table (tokens text, inbound_secret text)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.tokens, c.inbound_secret from public.integration_connections c
  where c.tenant_id = p_tenant and c.provider = p_provider and (auth.uid() is null or app.has_permission(p_tenant, 'integrations.manage') or app.has_permission(p_tenant, 'gl.write'))
$$;
create or replace function app.set_connection_tokens(p_tenant uuid, p_provider text, p_tokens text, p_status text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not (app.has_permission(p_tenant, 'integrations.manage') or app.has_permission(p_tenant, 'gl.write')) then
    raise exception 'connections need integrations.manage' using errcode = '42501';
  end if;
  update public.integration_connections set tokens = p_tokens, status = p_status where tenant_id = p_tenant and provider = p_provider;
end $$;

create table public.quickbooks_account_map (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  gl_account_id uuid not null references public.gl_accounts(id) on delete cascade,
  qbo_account_id text not null,
  qbo_account_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, gl_account_id)
);
alter table public.quickbooks_account_map enable row level security;

create table public.quickbooks_syncs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  day date not null,
  status text not null check (status in ('sent', 'failed')),
  qbo_entry_id text,
  lines jsonb not null default '[]'::jsonb,
  error text,
  attempts integer not null default 1,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, day)
);
alter table public.quickbooks_syncs enable row level security;

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  from_number text not null,
  to_number text not null,
  account_id uuid,
  contact_id uuid,
  lead_id uuid,
  user_id uuid references auth.users(id),
  started_at timestamptz not null,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  recording_url text check (recording_url is null or recording_url ~ '^https://'),
  provider_call_id text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider_call_id),
  foreign key (tenant_id, account_id) references public.accounts (tenant_id, id)
);
alter table public.calls enable row level security;
create index calls_recent on public.calls (tenant_id, started_at desc);

-- Rule 8: the phone system's call event, matched to the caller and logged once by its provider id.
create or replace function app.phone_call_event(p_inbound_key uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.integration_connections;
  v_from text := left(coalesce(p_payload ->> 'from', ''), 40);
  v_to text := left(coalesce(p_payload ->> 'to', ''), 40);
  v_direction text := coalesce(p_payload ->> 'direction', 'inbound');
  v_other text;
  v_digits text;
  v_contact public.contacts;
  v_account uuid;
  v_lead uuid;
  v_id uuid;
begin
  select * into c from public.integration_connections where inbound_key = p_inbound_key and provider = 'phone' and status = 'connected';
  if c.id is null then raise exception 'no such phone connection' using errcode = 'P0002'; end if;
  if v_direction not in ('inbound', 'outbound') or coalesce(p_payload ->> 'call_id', '') = '' then raise exception 'a call has an id and a direction' using errcode = '22023'; end if;
  v_other := case when v_direction = 'inbound' then v_from else v_to end;
  v_digits := right(regexp_replace(v_other, '\D', '', 'g'), 10);
  select * into v_contact from public.contacts ct where ct.tenant_id = c.tenant_id and ct.archived_at is null and right(ct.phone_digits, 10) = v_digits order by ct.created_at desc limit 1;
  v_account := coalesce(v_contact.account_id, (select a.id from public.accounts a where a.tenant_id = c.tenant_id and right(a.phone_digits, 10) = v_digits order by a.created_at desc limit 1));
  if v_account is null then
    select l.id into v_lead from public.leads l where l.tenant_id = c.tenant_id and right(l.phone_digits, 10) = v_digits order by l.created_at desc limit 1;
  end if;
  insert into public.calls (tenant_id, direction, from_number, to_number, account_id, contact_id, lead_id, started_at, duration_seconds, recording_url, provider_call_id)
  values (c.tenant_id, v_direction, v_from, v_to, v_account, v_contact.id, v_lead, coalesce(nullif(p_payload ->> 'started_at', '')::timestamptz, now()),
          nullif(p_payload ->> 'duration_seconds', '')::integer, nullif(p_payload ->> 'recording_url', ''), p_payload ->> 'call_id')
  on conflict (tenant_id, provider_call_id) do update set duration_seconds = coalesce(excluded.duration_seconds, calls.duration_seconds),
    recording_url = coalesce(excluded.recording_url, calls.recording_url)
  returning id into v_id;
  return jsonb_build_object('call_id', v_id, 'account_id', v_account, 'lead_id', v_lead);
end $$;
create or replace function app.phone_secret(p_inbound_key uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select inbound_secret from public.integration_connections where inbound_key = p_inbound_key and provider = 'phone' and status = 'connected'
$$;

-- ---------------------------------------------------------------------------
-- Grants: the API runs as anon through these functions only
-- ---------------------------------------------------------------------------

revoke all on function app.api_key(text, text) from public;
revoke all on function app.api_log(uuid, text, text, integer) from public;
revoke all on function app.api_scope(uuid, text) from public;
revoke all on function app.api_lookup(uuid, text, text) from public;
revoke all on function app.api_create_lead(uuid, jsonb) from public;
revoke all on function app.api_create_request(uuid, jsonb) from public;
revoke all on function app.api_availability(uuid, uuid) from public;
revoke all on function app.api_visits(uuid, uuid, date, date) from public;
revoke all on function app.api_invoices(uuid, uuid) from public;
revoke all on function app.api_device_event(uuid, jsonb) from public;
revoke all on function app.phone_call_event(uuid, jsonb) from public;
revoke all on function app.phone_secret(uuid) from public;
revoke all on function app.enqueue_webhook(uuid, text, jsonb) from public;
revoke all on function app.webhooks_due(uuid) from public;
revoke all on function app.webhook_result(uuid, integer, text, timestamptz) from public;
revoke all on function app.connection_secrets(uuid, text) from public;
revoke all on function app.set_connection_tokens(uuid, text, text, text) from public;
grant execute on function app.api_key(text, text), app.api_log(uuid, text, text, integer), app.api_lookup(uuid, text, text), app.api_create_lead(uuid, jsonb),
  app.api_create_request(uuid, jsonb), app.api_availability(uuid, uuid), app.api_visits(uuid, uuid, date, date), app.api_invoices(uuid, uuid),
  app.api_device_event(uuid, jsonb), app.phone_call_event(uuid, jsonb), app.phone_secret(uuid) to anon;
grant execute on function app.webhooks_due(uuid), app.webhook_result(uuid, integer, text, timestamptz), app.connection_secrets(uuid, text),
  app.set_connection_tokens(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

create policy api_keys_select on public.api_keys for select to authenticated using (app.has_permission(tenant_id, 'integrations.manage'));
create policy api_keys_insert on public.api_keys for insert to authenticated with check (app.has_permission(tenant_id, 'integrations.manage') and revoked_at is null);
create policy api_keys_update on public.api_keys for update to authenticated
  using (app.has_permission(tenant_id, 'integrations.manage')) with check (app.has_permission(tenant_id, 'integrations.manage'));
create policy api_requests_select on public.api_requests for select to authenticated using (app.has_permission(tenant_id, 'integrations.manage'));

create policy webhook_subscriptions_select on public.webhook_subscriptions for select to authenticated using (app.has_permission(tenant_id, 'integrations.manage'));
create policy webhook_subscriptions_write on public.webhook_subscriptions for all to authenticated
  using (app.has_permission(tenant_id, 'integrations.manage')) with check (app.has_permission(tenant_id, 'integrations.manage'));
create policy webhook_deliveries_select on public.webhook_deliveries for select to authenticated using (app.has_permission(tenant_id, 'integrations.manage'));

create policy integration_connections_select on public.integration_connections for select to authenticated
  using (app.has_permission(tenant_id, 'integrations.manage') or (provider = 'quickbooks' and app.has_permission(tenant_id, 'gl.read')) or (provider = 'phone' and app.is_member(tenant_id)));
create policy integration_connections_write on public.integration_connections for all to authenticated
  using (app.has_permission(tenant_id, 'integrations.manage') or (provider = 'quickbooks' and app.has_permission(tenant_id, 'gl.write')))
  with check (app.has_permission(tenant_id, 'integrations.manage') or (provider = 'quickbooks' and app.has_permission(tenant_id, 'gl.write')));

create policy quickbooks_account_map_select on public.quickbooks_account_map for select to authenticated using (app.has_permission(tenant_id, 'gl.read'));
create policy quickbooks_account_map_write on public.quickbooks_account_map for all to authenticated
  using (app.has_permission(tenant_id, 'gl.write')) with check (app.has_permission(tenant_id, 'gl.write'));
create policy quickbooks_syncs_select on public.quickbooks_syncs for select to authenticated using (app.has_permission(tenant_id, 'gl.read'));
create policy quickbooks_syncs_write on public.quickbooks_syncs for all to authenticated
  using (app.has_permission(tenant_id, 'gl.write')) with check (app.has_permission(tenant_id, 'gl.write'));

create policy calls_select on public.calls for select to authenticated using (app.has_permission(tenant_id, 'customers.read'));
create policy calls_insert on public.calls for insert to authenticated
  with check (app.has_permission(tenant_id, 'customers.read') and direction = 'outbound' and user_id = auth.uid());
create policy calls_update on public.calls for update to authenticated
  using (app.has_permission(tenant_id, 'customers.write')) with check (app.has_permission(tenant_id, 'customers.write'));

-- ---------------------------------------------------------------------------
-- Timestamps, audit, the write guard
-- ---------------------------------------------------------------------------

create trigger api_keys_updated_at before update on public.api_keys for each row execute function app.set_updated_at();
create trigger webhook_subscriptions_updated_at before update on public.webhook_subscriptions for each row execute function app.set_updated_at();
create trigger webhook_deliveries_updated_at before update on public.webhook_deliveries for each row execute function app.set_updated_at();
create trigger integration_connections_updated_at before update on public.integration_connections for each row execute function app.set_updated_at();
create trigger quickbooks_account_map_updated_at before update on public.quickbooks_account_map for each row execute function app.set_updated_at();
create trigger quickbooks_syncs_updated_at before update on public.quickbooks_syncs for each row execute function app.set_updated_at();
create trigger calls_updated_at before update on public.calls for each row execute function app.set_updated_at();

create trigger tenant_write_guard before insert or update or delete on public.api_keys for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.api_requests for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.webhook_subscriptions for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.webhook_deliveries for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.integration_connections for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.quickbooks_account_map for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.quickbooks_syncs for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.calls for each row execute function app.guard_tenant_write();

-- A subscription's URL and secret for the office's test send and for showing the secret to whoever manages integrations.
create or replace function app.webhook_subscription_secret(p_tenant uuid, p_subscription uuid) returns table (url text, secret text)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.url, s.secret from public.webhook_subscriptions s
  where s.id = p_subscription and s.tenant_id = p_tenant and (auth.uid() is null or app.has_permission(p_tenant, 'integrations.manage'))
$$;
revoke all on function app.webhook_subscription_secret(uuid, uuid) from public;
grant execute on function app.webhook_subscription_secret(uuid, uuid) to authenticated;
