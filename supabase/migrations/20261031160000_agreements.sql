-- Spec 04: agreements and visits. The agreement is the central object; it generates every visit of its term as a
-- planned row with a due window and a price. Re-services are $0 visits on the agreement. Cancellation settles what
-- was delivered. Prices change in bulk with a dated change row per agreement. Terms renew by extension.

-- The default terms copied onto each new agreement.
alter table public.tenants add column agreement_terms text;

-- ---------------------------------------------------------------------------
-- Cancel reasons: tenant data with defaults, like lead sources
-- ---------------------------------------------------------------------------

create table public.cancel_reasons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, id),
  unique (tenant_id, key)
);
alter table public.cancel_reasons enable row level security;

create or replace function app.seed_cancel_reasons() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.cancel_reasons (tenant_id, key, name) values
    (new.id, 'price', 'Price'),
    (new.id, 'moved', 'Moved away'),
    (new.id, 'service_quality', 'Service quality'),
    (new.id, 'competitor', 'Went with a competitor'),
    (new.id, 'no_longer_needed', 'No longer needed'),
    (new.id, 'seasonal', 'Seasonal pause'),
    (new.id, 'financial', 'Financial hardship'),
    (new.id, 'other', 'Other')
  on conflict (tenant_id, key) do nothing;
  return new;
end $$;
create trigger tenants_seed_cancel_reasons after insert on public.tenants for each row execute function app.seed_cancel_reasons();

insert into public.cancel_reasons (tenant_id, key, name)
select t.id, d.key, d.name
from public.tenants t
cross join (values
  ('price', 'Price'), ('moved', 'Moved away'), ('service_quality', 'Service quality'), ('competitor', 'Went with a competitor'),
  ('no_longer_needed', 'No longer needed'), ('seasonal', 'Seasonal pause'), ('financial', 'Financial hardship'), ('other', 'Other')) as d(key, name)
on conflict (tenant_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- Agreements
-- ---------------------------------------------------------------------------

create table public.agreements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number integer not null,
  account_id uuid not null,
  property_id uuid not null,
  service_type_id uuid not null,
  branch_id uuid references public.branches(id),
  quote_id uuid references public.quotes(id),
  quote_option_id uuid references public.quote_options(id),
  status text not null default 'draft' check (status in ('draft', 'active', 'on_hold', 'cancelled', 'ended')),
  cadence text not null check (cadence in ('monthly', 'bimonthly', 'quarterly', 'custom', 'seasonal_rounds')),
  cadence_rule jsonb not null default '{}'::jsonb check (jsonb_typeof(cadence_rule) = 'object'),
  season_start date,
  season_end date,
  skip_months smallint[] not null default '{}' check (skip_months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]),
  interior_only_months smallint[] not null default '{}' check (interior_only_months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]),
  initial_price_cents bigint not null default 0 check (initial_price_cents >= 0),
  recurring_price_cents bigint not null default 0 check (recurring_price_cents >= 0),
  billing_mode text not null check (billing_mode in ('per_visit', 'flat_monthly', 'annual_prepay')),
  term_months integer not null check (term_months between 1 and 60),
  renewals integer not null default 0 check (renewals >= 0),
  auto_renew boolean not null default true,
  cancel_fee_cents bigint not null default 0 check (cancel_fee_cents >= 0),
  starts_on date not null,
  -- Last day of the term including renewals; maintained by trigger.
  ends_on date not null,
  first_visit_on date not null,
  window_days integer not null default 30 check (window_days between 1 and 90),
  terms_text text,
  signed_at timestamptz,
  signed_name text,
  signed_by_contact_id uuid references public.contacts(id),
  signed_ip text,
  cancelled_on date,
  cancel_reason_id uuid,
  cancel_note text,
  save_offer_made boolean not null default false,
  save_outcome text check (save_outcome is null or save_outcome in ('saved', 'lost')),
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, id),
  unique (tenant_id, number),
  foreign key (tenant_id, account_id) references public.accounts (tenant_id, id),
  foreign key (tenant_id, property_id) references public.properties (tenant_id, id),
  foreign key (tenant_id, service_type_id) references public.service_types (tenant_id, id),
  foreign key (tenant_id, cancel_reason_id) references public.cancel_reasons (tenant_id, id),
  constraint agreements_first_visit_in_term check (first_visit_on >= starts_on),
  constraint agreements_seasonal_rule check (
    cadence <> 'seasonal_rounds'
    or (season_start is not null and season_end is not null and season_end >= season_start and coalesce((cadence_rule->>'rounds')::int, 0) >= 1)
  ),
  constraint agreements_custom_rule check (
    cadence <> 'custom' or (coalesce((cadence_rule->>'every')::int, 0) >= 1 and cadence_rule->>'unit' in ('weeks', 'months'))
  ),
  constraint agreements_signed_when_active check (status not in ('active', 'on_hold', 'ended') or signed_at is not null),
  constraint agreements_cancel_fields check (status <> 'cancelled' or cancelled_on is not null)
);
alter table public.agreements enable row level security;
create index agreements_tenant_account on public.agreements (tenant_id, account_id);
create index agreements_tenant_status_ends on public.agreements (tenant_id, status, ends_on);

-- Agreement numbers come from the tenant's counter; the trigger ignores any supplied number.
create or replace function app.assign_agreement_number() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.number := app.next_number(new.tenant_id, 'agreement');
  return new;
end $$;
create trigger agreements_number before insert on public.agreements for each row execute function app.assign_agreement_number();

-- ends_on follows starts_on, the term and renewals; first_visit_on defaults to the start.
create or replace function app.set_agreement_dates() returns trigger
language plpgsql as $$
begin
  new.first_visit_on := coalesce(new.first_visit_on, new.starts_on);
  new.ends_on := (new.starts_on + make_interval(months => new.term_months * (1 + new.renewals)) - interval '1 day')::date;
  return new;
end $$;
create trigger agreements_dates before insert or update of starts_on, term_months, renewals, first_visit_on on public.agreements
  for each row execute function app.set_agreement_dates();

-- The property belongs to the account.
create or replace function app.check_agreement_property() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.properties p where p.id = new.property_id and p.account_id = new.account_id and p.tenant_id = new.tenant_id) then
    raise exception 'the property does not belong to the agreement''s account' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger agreements_property before insert or update of account_id, property_id on public.agreements
  for each row execute function app.check_agreement_property();

-- Status machine (rule 2) and the lock on what an active agreement is for (rule 12).
create or replace function app.check_agreement_status() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'active') then
      raise exception 'an agreement starts as a draft or, when imported signed, active' using errcode = '23514';
    end if;
    return new;
  end if;
  if old.status <> 'draft' and (new.account_id <> old.account_id or new.property_id <> old.property_id or new.service_type_id <> old.service_type_id) then
    raise exception 'a signed agreement keeps its account, property and service type' using errcode = '23514';
  end if;
  if new.status = old.status then
    return new;
  end if;
  if not (
    (old.status = 'draft' and new.status in ('active', 'cancelled'))
    or (old.status = 'active' and new.status in ('on_hold', 'cancelled', 'ended'))
    or (old.status = 'on_hold' and new.status in ('active', 'cancelled'))
  ) then
    raise exception 'an agreement cannot move from % to %', old.status, new.status using errcode = '23514';
  end if;
  if new.status = 'active' and old.status = 'draft' and new.signed_at is null then
    raise exception 'an agreement is activated by signing it' using errcode = '23514';
  end if;
  if new.status = 'cancelled' then
    new.cancelled_on := coalesce(new.cancelled_on, current_date);
    if old.status <> 'draft' and new.cancel_reason_id is null then
      raise exception 'cancelling an agreement needs a reason' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger agreements_status before insert or update on public.agreements for each row execute function app.check_agreement_status();

-- ---------------------------------------------------------------------------
-- Visits and crews
-- ---------------------------------------------------------------------------

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agreement_id uuid,
  account_id uuid not null,
  property_id uuid not null,
  service_type_id uuid not null,
  branch_id uuid references public.branches(id),
  kind text not null check (kind in ('initial', 'recurring', 'reservice', 'one_time', 'inspection')),
  sequence integer not null default 1,
  due_start date not null,
  due_end date not null,
  scheduled_for date,
  technician_id uuid references auth.users(id),
  status text not null default 'planned' check (status in ('planned', 'scheduled', 'en_route', 'in_progress', 'completed', 'skipped', 'cancelled')),
  price_cents bigint not null default 0 check (price_cents >= 0),
  interior_only boolean not null default false,
  reservice_reason text,
  arrived_at timestamptz,
  departed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, id),
  foreign key (tenant_id, agreement_id) references public.agreements (tenant_id, id) on delete cascade,
  foreign key (tenant_id, account_id) references public.accounts (tenant_id, id),
  foreign key (tenant_id, property_id) references public.properties (tenant_id, id),
  foreign key (tenant_id, service_type_id) references public.service_types (tenant_id, id),
  constraint visits_window check (due_end >= due_start),
  constraint visits_reservice_is_free check (kind <> 'reservice' or price_cents = 0),
  constraint visits_reservice_on_agreement check (kind <> 'reservice' or agreement_id is not null)
);
alter table public.visits enable row level security;
create index visits_tenant_agreement on public.visits (tenant_id, agreement_id, sequence);
create index visits_tenant_due on public.visits (tenant_id, status, due_start);
create index visits_tenant_scheduled on public.visits (tenant_id, scheduled_for) where scheduled_for is not null;

-- Visit status machine (rule 14). Dispatch and the technician app drive the middle; this spec plans and cancels.
create or replace function app.check_visit_status() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('planned', 'scheduled', 'completed') then
      raise exception 'a visit starts planned or scheduled (or completed when imported)' using errcode = '23514';
    end if;
    if new.status = 'completed' then new.completed_at := coalesce(new.completed_at, now()); end if;
    return new;
  end if;
  if new.status = old.status then
    return new;
  end if;
  if not (
    (old.status = 'planned' and new.status in ('scheduled', 'cancelled', 'skipped'))
    or (old.status = 'scheduled' and new.status in ('planned', 'en_route', 'in_progress', 'completed', 'skipped', 'cancelled'))
    or (old.status = 'en_route' and new.status in ('in_progress', 'scheduled'))
    or (old.status = 'in_progress' and new.status = 'completed')
  ) then
    raise exception 'a visit cannot move from % to %', old.status, new.status using errcode = '23514';
  end if;
  if new.status = 'completed' then new.completed_at := coalesce(new.completed_at, now()); end if;
  if new.status = 'cancelled' then new.cancelled_at := coalesce(new.cancelled_at, now()); end if;
  if new.status = 'planned' then new.scheduled_for := null; new.technician_id := null; end if;
  return new;
end $$;
create trigger visits_status before insert or update on public.visits for each row execute function app.check_visit_status();

create table public.visit_crew (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  visit_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('lead', 'applicator', 'supervisor', 'helper')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (visit_id, user_id),
  foreign key (tenant_id, visit_id) references public.visits (tenant_id, id) on delete cascade
);
alter table public.visit_crew enable row level security;
create unique index visit_crew_one_lead on public.visit_crew (visit_id) where role = 'lead';

-- ---------------------------------------------------------------------------
-- Price increases
-- ---------------------------------------------------------------------------

create table public.price_increases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('percent', 'amount')),
  percent numeric check (percent is null or percent > 0),
  amount_cents bigint check (amount_cents is null or amount_cents > 0),
  effective_on date not null,
  service_type_id uuid,
  branch_id uuid references public.branches(id),
  billing_mode text check (billing_mode is null or billing_mode in ('per_visit', 'flat_monthly', 'annual_prepay')),
  rounding text not null default 'cent' check (rounding in ('cent', 'dollar')),
  applied_at timestamptz,
  agreements_changed integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, id),
  foreign key (tenant_id, service_type_id) references public.service_types (tenant_id, id),
  constraint price_increases_value check ((kind = 'percent' and percent is not null) or (kind = 'amount' and amount_cents is not null))
);
alter table public.price_increases enable row level security;

create table public.agreement_price_changes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agreement_id uuid not null,
  price_increase_id uuid,
  old_recurring_price_cents bigint not null check (old_recurring_price_cents >= 0),
  new_recurring_price_cents bigint not null check (new_recurring_price_cents >= 0),
  effective_on date not null,
  reason text not null check (reason in ('bulk_increase', 'manual', 'renewal')),
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (tenant_id, agreement_id) references public.agreements (tenant_id, id) on delete cascade,
  foreign key (tenant_id, price_increase_id) references public.price_increases (tenant_id, id)
);
alter table public.agreement_price_changes enable row level security;
create index agreement_price_changes_agreement on public.agreement_price_changes (tenant_id, agreement_id, effective_on);

-- A cancel reason in use cannot be deleted; deactivate it instead.
create or replace function app.protect_used_cancel_reason() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
    return old;
  end if;
  if exists (select 1 from public.agreements a where a.cancel_reason_id = old.id) then
    raise exception 'this cancel reason is in use; deactivate it instead' using errcode = '23503';
  end if;
  return old;
end $$;
create trigger cancel_reasons_in_use before delete on public.cancel_reasons for each row execute function app.protect_used_cancel_reason();

-- ---------------------------------------------------------------------------
-- Housekeeping triggers
-- ---------------------------------------------------------------------------

create trigger cancel_reasons_updated_at before update on public.cancel_reasons for each row execute function app.set_updated_at();
create trigger agreements_updated_at before update on public.agreements for each row execute function app.set_updated_at();
create trigger visits_updated_at before update on public.visits for each row execute function app.set_updated_at();
create trigger visit_crew_updated_at before update on public.visit_crew for each row execute function app.set_updated_at();
create trigger price_increases_updated_at before update on public.price_increases for each row execute function app.set_updated_at();
create trigger agreement_price_changes_updated_at before update on public.agreement_price_changes for each row execute function app.set_updated_at();

create trigger agreements_audit after insert or update or delete on public.agreements for each row execute function app.write_audit();
create trigger visits_audit after insert or update or delete on public.visits for each row execute function app.write_audit();
create trigger price_increases_audit after insert or update or delete on public.price_increases for each row execute function app.write_audit();
create trigger agreement_price_changes_audit after insert or update or delete on public.agreement_price_changes for each row execute function app.write_audit();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

create policy cancel_reasons_select on public.cancel_reasons for select to authenticated using (app.has_permission(tenant_id, 'agreements.read'));
create policy cancel_reasons_insert on public.cancel_reasons for insert to authenticated with check (app.has_permission(tenant_id, 'agreements.write'));
create policy cancel_reasons_update on public.cancel_reasons for update to authenticated using (app.has_permission(tenant_id, 'agreements.write')) with check (app.has_permission(tenant_id, 'agreements.write'));
create policy cancel_reasons_delete on public.cancel_reasons for delete to authenticated using (app.has_permission(tenant_id, 'agreements.write'));

create policy agreements_select on public.agreements for select to authenticated using (app.has_permission(tenant_id, 'agreements.read'));
create policy agreements_insert on public.agreements for insert to authenticated with check (app.has_permission(tenant_id, 'agreements.write'));
create policy agreements_update on public.agreements for update to authenticated using (app.has_permission(tenant_id, 'agreements.write')) with check (app.has_permission(tenant_id, 'agreements.write'));
create policy agreements_delete on public.agreements for delete to authenticated using (app.has_permission(tenant_id, 'agreements.write'));

create policy visits_select on public.visits for select to authenticated
  using (app.has_permission(tenant_id, 'agreements.read') or app.has_permission(tenant_id, 'dispatch.read') or app.has_permission(tenant_id, 'visits.read'));
create policy visits_insert on public.visits for insert to authenticated
  with check (app.has_permission(tenant_id, 'agreements.write') or app.has_permission(tenant_id, 'dispatch.write'));
create policy visits_update on public.visits for update to authenticated
  using (app.has_permission(tenant_id, 'agreements.write') or app.has_permission(tenant_id, 'dispatch.write') or app.has_permission(tenant_id, 'visits.write'))
  with check (app.has_permission(tenant_id, 'agreements.write') or app.has_permission(tenant_id, 'dispatch.write') or app.has_permission(tenant_id, 'visits.write'));
create policy visits_delete on public.visits for delete to authenticated using (app.has_permission(tenant_id, 'agreements.write'));

create policy visit_crew_select on public.visit_crew for select to authenticated
  using (app.has_permission(tenant_id, 'agreements.read') or app.has_permission(tenant_id, 'dispatch.read') or app.has_permission(tenant_id, 'visits.read'));
create policy visit_crew_insert on public.visit_crew for insert to authenticated
  with check (app.has_permission(tenant_id, 'dispatch.write') or app.has_permission(tenant_id, 'agreements.write'));
create policy visit_crew_update on public.visit_crew for update to authenticated
  using (app.has_permission(tenant_id, 'dispatch.write') or app.has_permission(tenant_id, 'agreements.write'))
  with check (app.has_permission(tenant_id, 'dispatch.write') or app.has_permission(tenant_id, 'agreements.write'));
create policy visit_crew_delete on public.visit_crew for delete to authenticated
  using (app.has_permission(tenant_id, 'dispatch.write') or app.has_permission(tenant_id, 'agreements.write'));

create policy price_increases_select on public.price_increases for select to authenticated using (app.has_permission(tenant_id, 'agreements.read'));
create policy price_increases_insert on public.price_increases for insert to authenticated with check (app.has_permission(tenant_id, 'agreements.write'));
create policy price_increases_update on public.price_increases for update to authenticated using (app.has_permission(tenant_id, 'agreements.write')) with check (app.has_permission(tenant_id, 'agreements.write'));
create policy price_increases_delete on public.price_increases for delete to authenticated using (app.has_permission(tenant_id, 'agreements.write'));

create policy agreement_price_changes_select on public.agreement_price_changes for select to authenticated using (app.has_permission(tenant_id, 'agreements.read'));
create policy agreement_price_changes_insert on public.agreement_price_changes for insert to authenticated with check (app.has_permission(tenant_id, 'agreements.write'));
create policy agreement_price_changes_update on public.agreement_price_changes for update to authenticated using (app.has_permission(tenant_id, 'agreements.write')) with check (app.has_permission(tenant_id, 'agreements.write'));
create policy agreement_price_changes_delete on public.agreement_price_changes for delete to authenticated using (app.has_permission(tenant_id, 'agreements.write'));
