-- Spec 02: customers. Accounts, properties, units, contacts, lead sources, leads, quotes and per-tenant counters.
-- An account pays; a property is where work happens; contacts hang off either, residents off a property or unit.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Digits only, with the leading 1 dropped from 11-digit US numbers and anything after an extension marker ignored.
create or replace function app.phone_digits(phone text) returns text
language sql immutable as $$
  select case
    when phone is null then null
    else (
      select case when length(d) = 11 and left(d, 1) = '1' then substr(d, 2) else d end
      from (select regexp_replace(split_part(lower(phone), 'x', 1), '\D', '', 'g') as d) s
    )
  end
$$;

create table public.counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  value integer not null default 0,
  primary key (tenant_id, key)
);
alter table public.counters enable row level security;

-- Atomic per-tenant sequence, for quote and later invoice numbers.
create or replace function app.next_number(tenant uuid, counter_key text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n integer;
begin
  insert into public.counters (tenant_id, key, value) values (tenant, counter_key, 1)
  on conflict (tenant_id, key) do update set value = public.counters.value + 1
  returning value into n;
  return n;
end $$;
revoke all on function app.next_number(uuid, text) from public;
grant execute on function app.next_number(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  type text not null check (type in ('residential', 'commercial', 'property_manager')),
  name text not null,
  billing_line1 text,
  billing_line2 text,
  billing_city text,
  billing_state_code text check (billing_state_code is null or billing_state_code ~ '^[A-Z]{2}$'),
  billing_postal_code text,
  email text check (email is null or email = lower(email)),
  phone text,
  phone_digits text generated always as (app.phone_digits(phone)) stored,
  terms_days integer not null default 0 check (terms_days between 0 and 120),
  po_required boolean not null default false,
  notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  lead_id uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, id)
);
alter table public.accounts enable row level security;
create index accounts_tenant_name on public.accounts (tenant_id, lower(name));
create index accounts_tenant_phone on public.accounts (tenant_id, phone_digits);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  account_id uuid not null,
  name text,
  line1 text not null,
  line2 text,
  city text not null,
  state_code text not null check (state_code ~ '^[A-Z]{2}$'),
  postal_code text not null,
  normalized_address text not null,
  county text,
  lat double precision,
  lng double precision,
  geocode_status text not null default 'pending' check (geocode_status in ('pending', 'ok', 'failed', 'manual')),
  property_type text not null check (property_type in (
    'house', 'townhouse', 'condo', 'apartment_building', 'office', 'retail', 'restaurant', 'warehouse',
    'food_plant', 'school', 'healthcare', 'other')),
  size_sqft integer check (size_sqft is null or size_sqft > 0),
  lot_sqft integer check (lot_sqft is null or lot_sqft > 0),
  measured_by text check (measured_by is null or measured_by in ('manual', 'imagery')),
  unit_count integer check (unit_count is null or unit_count >= 0),
  access_notes text,
  registry_matches jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, id),
  foreign key (tenant_id, account_id) references public.accounts (tenant_id, id) on delete cascade
);
alter table public.properties enable row level security;
create index properties_tenant_account on public.properties (tenant_id, account_id);
create index properties_tenant_normalized on public.properties (tenant_id, normalized_address);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null,
  label text not null,
  floor text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (property_id, label),
  unique (property_id, id),
  foreign key (tenant_id, property_id) references public.properties (tenant_id, id) on delete cascade
);
alter table public.units enable row level security;

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  account_id uuid,
  property_id uuid,
  unit_id uuid,
  name text not null,
  email text check (email is null or email = lower(email)),
  phone text,
  phone_digits text generated always as (app.phone_digits(phone)) stored,
  role text not null check (role in ('billing', 'primary', 'resident', 'site_contact', 'property_manager')),
  sms_opt_in boolean not null default false,
  e_notice_consent_at timestamptz,
  e_notice_consent_note text,
  preferred_channel text check (preferred_channel is null or preferred_channel in ('email', 'sms', 'phone', 'mail')),
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (account_id is not null or property_id is not null),
  check (unit_id is null or property_id is not null),
  check (role <> 'resident' or property_id is not null),
  foreign key (tenant_id, account_id) references public.accounts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, property_id) references public.properties (tenant_id, id) on delete cascade,
  foreign key (property_id, unit_id) references public.units (property_id, id) on delete set null
);
alter table public.contacts enable row level security;
create index contacts_tenant_account on public.contacts (tenant_id, account_id);
create index contacts_tenant_property on public.contacts (tenant_id, property_id);
create index contacts_tenant_phone on public.contacts (tenant_id, phone_digits);
create index contacts_tenant_email on public.contacts (tenant_id, email);

create table public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, key),
  unique (tenant_id, id)
);
alter table public.lead_sources enable row level security;

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_id uuid not null,
  stage text not null default 'new' check (stage in ('new', 'inspection_booked', 'quoted', 'won', 'lost')),
  name text not null,
  email text check (email is null or email = lower(email)),
  phone text,
  phone_digits text generated always as (app.phone_digits(phone)) stored,
  line1 text,
  line2 text,
  city text,
  state_code text check (state_code is null or state_code ~ '^[A-Z]{2}$'),
  postal_code text,
  normalized_address text,
  county text,
  lat double precision,
  lng double precision,
  geocode_status text not null default 'pending' check (geocode_status in ('pending', 'ok', 'failed', 'manual')),
  property_type text check (property_type is null or property_type in (
    'house', 'townhouse', 'condo', 'apartment_building', 'office', 'retail', 'restaurant', 'warehouse',
    'food_plant', 'school', 'healthcare', 'other')),
  notes text,
  owner_id uuid,
  inspection_at timestamptz,
  lost_reason text,
  account_id uuid,
  property_id uuid,
  won_at timestamptz,
  lost_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, id),
  foreign key (tenant_id, source_id) references public.lead_sources (tenant_id, id),
  foreign key (tenant_id, account_id) references public.accounts (tenant_id, id) on delete set null,
  foreign key (tenant_id, property_id) references public.properties (tenant_id, id) on delete set null
);
alter table public.leads enable row level security;
create index leads_tenant_stage on public.leads (tenant_id, stage);
create index leads_tenant_phone on public.leads (tenant_id, phone_digits);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number integer not null,
  lead_id uuid,
  account_id uuid,
  property_id uuid,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined', 'expired')),
  valid_until date,
  notes text,
  sent_at timestamptz,
  accepted_option_id uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, number),
  unique (tenant_id, id),
  check (lead_id is not null or account_id is not null),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete set null,
  foreign key (tenant_id, account_id) references public.accounts (tenant_id, id) on delete set null,
  foreign key (tenant_id, property_id) references public.properties (tenant_id, id) on delete set null
);
alter table public.quotes enable row level security;

create table public.quote_options (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  quote_id uuid not null,
  position integer not null default 1,
  name text not null,
  description text,
  recommended boolean not null default false,
  total_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, id),
  unique (quote_id, id),
  foreign key (tenant_id, quote_id) references public.quotes (tenant_id, id) on delete cascade
);
alter table public.quote_options enable row level security;

create table public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  option_id uuid not null,
  position integer not null default 1,
  description text not null,
  kind text not null check (kind in ('initial', 'recurring', 'one_time', 'add_on')),
  quantity numeric not null default 1 check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  amount_cents bigint generated always as (round(quantity * unit_price_cents)::bigint) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (tenant_id, option_id) references public.quote_options (tenant_id, id) on delete cascade
);
alter table public.quote_lines enable row level security;

alter table public.quotes
  add constraint quotes_accepted_option_fk foreign key (id, accepted_option_id)
  references public.quote_options (quote_id, id) deferrable initially deferred;

-- ---------------------------------------------------------------------------
-- Default lead sources for every tenant
-- ---------------------------------------------------------------------------

create or replace function app.seed_lead_sources() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.lead_sources (tenant_id, key, name) values
    (new.id, 'phone', 'Phone call'),
    (new.id, 'referral', 'Referral'),
    (new.id, 'door_to_door', 'Door to door'),
    (new.id, 'online_directory', 'Online directory'),
    (new.id, 'ads', 'Advertising'),
    (new.id, 'website', 'Website'),
    (new.id, 'other', 'Other')
  on conflict (tenant_id, key) do nothing;
  return new;
end $$;
create trigger tenants_seed_lead_sources after insert on public.tenants for each row execute function app.seed_lead_sources();

insert into public.lead_sources (tenant_id, key, name)
select t.id, d.key, d.name
from public.tenants t
cross join (values
  ('phone', 'Phone call'), ('referral', 'Referral'), ('door_to_door', 'Door to door'), ('online_directory', 'Online directory'),
  ('ads', 'Advertising'), ('website', 'Website'), ('other', 'Other')) as d(key, name)
on conflict (tenant_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- Rules enforced in the database
-- ---------------------------------------------------------------------------

-- Lead stage transitions mirror lib/customers/pipeline.ts. Won needs the converted account and property; lost needs a reason.
create or replace function app.check_lead_stage() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.stage in ('won', 'lost') then
      raise exception 'a lead starts in an open stage' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.stage = old.stage then
    return new;
  end if;
  if not (
    (old.stage = 'new' and new.stage in ('inspection_booked', 'quoted', 'won', 'lost'))
    or (old.stage = 'inspection_booked' and new.stage in ('quoted', 'won', 'lost'))
    or (old.stage = 'quoted' and new.stage in ('won', 'lost'))
    or (old.stage = 'lost' and new.stage = 'new')
  ) then
    raise exception 'a lead cannot move from % to %', old.stage, new.stage using errcode = '23514';
  end if;
  if new.stage = 'won' then
    if new.account_id is null or new.property_id is null then
      raise exception 'a won lead must be converted to an account and property' using errcode = '23514';
    end if;
    new.won_at := coalesce(new.won_at, now());
  end if;
  if new.stage = 'lost' then
    if coalesce(new.lost_reason, '') = '' then
      raise exception 'a lost lead needs a reason' using errcode = '23514';
    end if;
    new.lost_at := coalesce(new.lost_at, now());
  end if;
  if new.stage = 'new' and old.stage = 'lost' then
    new.lost_at := null;
    new.lost_reason := null;
  end if;
  return new;
end $$;
create trigger leads_stage before insert or update on public.leads for each row execute function app.check_lead_stage();

-- Quote numbers come from the tenant's counter.
create or replace function app.assign_quote_number() returns trigger
language plpgsql as $$
begin
  if new.number is null then
    new.number := app.next_number(new.tenant_id, 'quote');
  end if;
  return new;
end $$;
alter table public.quotes alter column number drop not null;
create trigger quotes_number before insert on public.quotes for each row execute function app.assign_quote_number();

-- Quote status transitions; sending needs at least one option with a line.
create or replace function app.check_quote_status() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if not (
    (old.status = 'draft' and new.status = 'sent')
    or (old.status = 'sent' and new.status in ('accepted', 'declined', 'expired'))
  ) then
    raise exception 'a quote cannot move from % to %', old.status, new.status using errcode = '23514';
  end if;
  if new.status = 'sent' then
    if not exists (
      select 1 from public.quote_options o join public.quote_lines l on l.option_id = o.id where o.quote_id = new.id
    ) then
      raise exception 'a quote needs at least one option with a line before it is sent' using errcode = '23514';
    end if;
    new.sent_at := coalesce(new.sent_at, now());
  end if;
  if new.status = 'accepted' and new.accepted_option_id is null then
    raise exception 'accepting a quote needs the accepted option' using errcode = '23514';
  end if;
  if new.status in ('accepted', 'declined', 'expired') then
    new.decided_at := coalesce(new.decided_at, now());
  end if;
  return new;
end $$;
create trigger quotes_status before update on public.quotes for each row execute function app.check_quote_status();

-- Option totals follow their lines.
create or replace function app.refresh_quote_option_total() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  target uuid := coalesce(new.option_id, old.option_id);
begin
  update public.quote_options o
  set total_cents = coalesce((select sum(l.amount_cents) from public.quote_lines l where l.option_id = target), 0)
  where o.id = target;
  return coalesce(new, old);
end $$;
create trigger quote_lines_total after insert or update or delete on public.quote_lines
  for each row execute function app.refresh_quote_option_total();

-- A lead source in use cannot be deleted; deactivate it instead.
create or replace function app.protect_used_lead_source() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.leads l where l.source_id = old.id) then
    raise exception 'this lead source is in use; deactivate it instead' using errcode = '23503';
  end if;
  return old;
end $$;
create trigger lead_sources_in_use before delete on public.lead_sources for each row execute function app.protect_used_lead_source();

create trigger accounts_updated_at before update on public.accounts for each row execute function app.set_updated_at();
create trigger properties_updated_at before update on public.properties for each row execute function app.set_updated_at();
create trigger units_updated_at before update on public.units for each row execute function app.set_updated_at();
create trigger contacts_updated_at before update on public.contacts for each row execute function app.set_updated_at();
create trigger lead_sources_updated_at before update on public.lead_sources for each row execute function app.set_updated_at();
create trigger leads_updated_at before update on public.leads for each row execute function app.set_updated_at();
create trigger quotes_updated_at before update on public.quotes for each row execute function app.set_updated_at();
create trigger quote_options_updated_at before update on public.quote_options for each row execute function app.set_updated_at();
create trigger quote_lines_updated_at before update on public.quote_lines for each row execute function app.set_updated_at();

create trigger accounts_audit after insert or update or delete on public.accounts for each row execute function app.write_audit();
create trigger properties_audit after insert or update or delete on public.properties for each row execute function app.write_audit();
create trigger contacts_audit after insert or update or delete on public.contacts for each row execute function app.write_audit();
create trigger leads_audit after insert or update or delete on public.leads for each row execute function app.write_audit();
create trigger quotes_audit after insert or update or delete on public.quotes for each row execute function app.write_audit();

-- ---------------------------------------------------------------------------
-- Row level security: customers.read and customers.write; quotes also open to agreements.* roles.
-- ---------------------------------------------------------------------------

create policy counters_select on public.counters for select to authenticated using (app.is_member(tenant_id));

create policy accounts_select on public.accounts for select to authenticated using (app.has_permission(tenant_id, 'customers.read'));
create policy accounts_insert on public.accounts for insert to authenticated with check (app.has_permission(tenant_id, 'customers.write'));
create policy accounts_update on public.accounts for update to authenticated using (app.has_permission(tenant_id, 'customers.write')) with check (app.has_permission(tenant_id, 'customers.write'));
create policy accounts_delete on public.accounts for delete to authenticated using (app.has_permission(tenant_id, 'customers.write'));

create policy properties_select on public.properties for select to authenticated using (app.has_permission(tenant_id, 'customers.read'));
create policy properties_insert on public.properties for insert to authenticated with check (app.has_permission(tenant_id, 'customers.write'));
create policy properties_update on public.properties for update to authenticated using (app.has_permission(tenant_id, 'customers.write')) with check (app.has_permission(tenant_id, 'customers.write'));
create policy properties_delete on public.properties for delete to authenticated using (app.has_permission(tenant_id, 'customers.write'));

create policy units_select on public.units for select to authenticated using (app.has_permission(tenant_id, 'customers.read'));
create policy units_insert on public.units for insert to authenticated with check (app.has_permission(tenant_id, 'customers.write'));
create policy units_update on public.units for update to authenticated using (app.has_permission(tenant_id, 'customers.write')) with check (app.has_permission(tenant_id, 'customers.write'));
create policy units_delete on public.units for delete to authenticated using (app.has_permission(tenant_id, 'customers.write'));

create policy contacts_select on public.contacts for select to authenticated using (app.has_permission(tenant_id, 'customers.read'));
create policy contacts_insert on public.contacts for insert to authenticated with check (app.has_permission(tenant_id, 'customers.write'));
create policy contacts_update on public.contacts for update to authenticated using (app.has_permission(tenant_id, 'customers.write')) with check (app.has_permission(tenant_id, 'customers.write'));
create policy contacts_delete on public.contacts for delete to authenticated using (app.has_permission(tenant_id, 'customers.write'));

create policy lead_sources_select on public.lead_sources for select to authenticated using (app.has_permission(tenant_id, 'customers.read'));
create policy lead_sources_insert on public.lead_sources for insert to authenticated with check (app.has_permission(tenant_id, 'customers.write'));
create policy lead_sources_update on public.lead_sources for update to authenticated using (app.has_permission(tenant_id, 'customers.write')) with check (app.has_permission(tenant_id, 'customers.write'));
create policy lead_sources_delete on public.lead_sources for delete to authenticated using (app.has_permission(tenant_id, 'customers.write'));

create policy leads_select on public.leads for select to authenticated using (app.has_permission(tenant_id, 'customers.read'));
create policy leads_insert on public.leads for insert to authenticated with check (app.has_permission(tenant_id, 'customers.write'));
create policy leads_update on public.leads for update to authenticated using (app.has_permission(tenant_id, 'customers.write')) with check (app.has_permission(tenant_id, 'customers.write'));
create policy leads_delete on public.leads for delete to authenticated using (app.has_permission(tenant_id, 'customers.write'));

create policy quotes_select on public.quotes for select to authenticated
  using (app.has_permission(tenant_id, 'customers.read') or app.has_permission(tenant_id, 'agreements.read'));
create policy quotes_insert on public.quotes for insert to authenticated with check (app.has_permission(tenant_id, 'agreements.write'));
create policy quotes_update on public.quotes for update to authenticated using (app.has_permission(tenant_id, 'agreements.write')) with check (app.has_permission(tenant_id, 'agreements.write'));
create policy quotes_delete on public.quotes for delete to authenticated using (app.has_permission(tenant_id, 'agreements.write'));

create policy quote_options_select on public.quote_options for select to authenticated
  using (app.has_permission(tenant_id, 'customers.read') or app.has_permission(tenant_id, 'agreements.read'));
create policy quote_options_insert on public.quote_options for insert to authenticated with check (app.has_permission(tenant_id, 'agreements.write'));
create policy quote_options_update on public.quote_options for update to authenticated using (app.has_permission(tenant_id, 'agreements.write')) with check (app.has_permission(tenant_id, 'agreements.write'));
create policy quote_options_delete on public.quote_options for delete to authenticated using (app.has_permission(tenant_id, 'agreements.write'));

create policy quote_lines_select on public.quote_lines for select to authenticated
  using (app.has_permission(tenant_id, 'customers.read') or app.has_permission(tenant_id, 'agreements.read'));
create policy quote_lines_insert on public.quote_lines for insert to authenticated with check (app.has_permission(tenant_id, 'agreements.write'));
create policy quote_lines_update on public.quote_lines for update to authenticated using (app.has_permission(tenant_id, 'agreements.write')) with check (app.has_permission(tenant_id, 'agreements.write'));
create policy quote_lines_delete on public.quote_lines for delete to authenticated using (app.has_permission(tenant_id, 'agreements.write'));

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage on all sequences in schema public to authenticated, service_role;
