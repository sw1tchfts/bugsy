-- Spec 18: inventory (locations, movements, moving average cost), the time clock, pay settings and rates, pay periods
-- with their export lines, and the payroll journal. Bugsy exports hours and pay; the payroll provider runs payroll.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

update public.roles set permissions = array(select distinct unnest(permissions || array['inventory.read']))
where tenant_id is null and key in ('office', 'dispatcher', 'technician', 'compliance_manager', 'bookkeeper') and not ('inventory.read' = any(permissions));
update public.roles set permissions = array(select distinct unnest(permissions || array['inventory.write']))
where tenant_id is null and key in ('dispatcher', 'compliance_manager') and not ('inventory.write' = any(permissions));
update public.roles set permissions = array(select distinct unnest(permissions || array['payroll.read', 'payroll.write']))
where tenant_id is null and key = 'bookkeeper' and not ('payroll.write' = any(permissions));

-- ---------------------------------------------------------------------------
-- Inventory (rules 1 to 5)
-- ---------------------------------------------------------------------------

create table public.inventory_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  -- Usage is taken off the shelves for visits completed from this day; earlier visits predate the count.
  tracking_since date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.inventory_settings enable row level security;

-- A location belongs to one of the company's own branches.
alter table public.branches add constraint branches_tenant_id_id_key unique (tenant_id, id);

create table public.stock_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  kind text not null check (kind in ('warehouse', 'truck')),
  name text not null check (length(trim(name)) > 0),
  user_id uuid references auth.users(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references public.branches (tenant_id, id),
  constraint stock_locations_truck check ((kind = 'truck') = (user_id is not null))
);
alter table public.stock_locations enable row level security;
create unique index stock_locations_one_truck on public.stock_locations (tenant_id, user_id) where kind = 'truck' and active;
create unique index stock_locations_one_warehouse on public.stock_locations (tenant_id, branch_id) where kind = 'warehouse' and active;

-- The first location starts tracking: usage from that day on comes off the shelves.
create or replace function app.start_inventory() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.inventory_settings (tenant_id, tracking_since)
  select new.tenant_id, (now() at time zone t.timezone)::date from public.tenants t where t.id = new.tenant_id
  on conflict (tenant_id) do nothing;
  return new;
end $$;
create trigger stock_locations_start after insert on public.stock_locations for each row execute function app.start_inventory();

alter table public.tenant_products add column truck_minimum numeric(14, 4) check (truck_minimum is null or truck_minimum >= 0);
alter table public.tenant_products add column warehouse_minimum numeric(14, 4) check (warehouse_minimum is null or warehouse_minimum >= 0);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id),
  kind text not null check (kind in ('receipt', 'transfer', 'usage', 'adjustment')),
  from_location_id uuid,
  to_location_id uuid,
  quantity numeric(14, 4) not null check (quantity > 0),
  unit text not null,
  unit_cost_cents bigint not null default 0 check (unit_cost_cents >= 0),
  value_cents bigint not null default 0 check (value_cents >= 0),
  visit_id uuid,
  visit_product_id uuid unique,
  vendor text,
  reference text,
  paid text check (paid in ('now', 'on_account')),
  note text check (note is null or length(note) <= 1000),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, id),
  foreign key (tenant_id, from_location_id) references public.stock_locations (tenant_id, id),
  foreign key (tenant_id, to_location_id) references public.stock_locations (tenant_id, id),
  foreign key (tenant_id, visit_id) references public.visits (tenant_id, id),
  constraint stock_movements_ends check (
    case kind
      when 'receipt' then to_location_id is not null and from_location_id is null and paid is not null
      when 'transfer' then to_location_id is not null and from_location_id is not null and to_location_id <> from_location_id and paid is null
      when 'usage' then from_location_id is not null and to_location_id is null and visit_product_id is not null and visit_id is not null and paid is null
      when 'adjustment' then (from_location_id is null) <> (to_location_id is null) and paid is null
      else false
    end)
);
alter table public.stock_movements enable row level security;
create index stock_movements_product on public.stock_movements (tenant_id, product_id);
create index stock_movements_from on public.stock_movements (from_location_id);
create index stock_movements_to on public.stock_movements (to_location_id);

-- Rule 5: a movement is a fact; a mistake is corrected by a new one. Jobs and a company purge (no user) are not refused.
create or replace function app.stock_movements_immutable() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null then raise exception 'stock movements are never changed; record a count or a transfer instead' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;
create trigger stock_movements_immutable before update or delete on public.stock_movements for each row execute function app.stock_movements_immutable();

-- On hand for a product, everywhere or at one location.
create or replace function app.stock_on_hand(p_tenant uuid, p_product uuid, p_location uuid default null) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(case when m.to_location_id is not null and (p_location is null or m.to_location_id = p_location) then m.quantity else 0 end), 0)
       - coalesce(sum(case when m.from_location_id is not null and (p_location is null or m.from_location_id = p_location) then m.quantity else 0 end), 0)
  from public.stock_movements m where m.tenant_id = p_tenant and m.product_id = p_product
$$;
revoke all on function app.stock_on_hand(uuid, uuid, uuid) from public;
grant execute on function app.stock_on_hand(uuid, uuid, uuid) to authenticated;

-- Rule 2: a receipt at its cost moves the product's cost to the moving average, under a lock so two receipts at once
-- average in turn.
create or replace function app.stock_receive(p_tenant uuid, p_product uuid, p_location uuid, p_quantity numeric, p_unit_cost bigint,
                                             p_vendor text, p_reference text, p_paid text, p_note text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  tp public.tenant_products;
  v_on_hand numeric;
  v_cost bigint;
  v_id uuid;
  v_value bigint;
begin
  if auth.uid() is not null and not app.has_permission(p_tenant, 'inventory.write') then raise exception 'receiving stock needs inventory.write' using errcode = '42501'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'enter a quantity above zero' using errcode = '23514'; end if;
  if p_unit_cost is null or p_unit_cost < 0 then raise exception 'the cost is zero or more cents' using errcode = '23514'; end if;
  if not exists (select 1 from public.stock_locations l where l.id = p_location and l.tenant_id = p_tenant and l.active) then
    raise exception 'that location is not one of the company''s' using errcode = '23514';
  end if;
  select * into tp from public.tenant_products where tenant_id = p_tenant and product_id = p_product for update;
  if tp.id is null then raise exception 'enable the product in the catalog first' using errcode = '23514'; end if;
  v_on_hand := app.stock_on_hand(p_tenant, p_product);
  v_cost := case when v_on_hand <= 0 then p_unit_cost else round((v_on_hand * tp.unit_cost_cents + p_quantity * p_unit_cost) / (v_on_hand + p_quantity))::bigint end;
  v_value := round(p_quantity * p_unit_cost)::bigint;
  insert into public.stock_movements (tenant_id, product_id, kind, to_location_id, quantity, unit, unit_cost_cents, value_cents, vendor, reference, paid, note)
  values (p_tenant, p_product, 'receipt', p_location, p_quantity, tp.unit, p_unit_cost, v_value, nullif(trim(p_vendor), ''), nullif(trim(p_reference), ''),
          coalesce(p_paid, 'on_account'), nullif(trim(p_note), ''))
  returning id into v_id;
  update public.tenant_products set unit_cost_cents = v_cost where id = tp.id;
  return jsonb_build_object('movement_id', v_id, 'unit_cost_cents', v_cost, 'value_cents', v_value);
end $$;
revoke all on function app.stock_receive(uuid, uuid, uuid, numeric, bigint, text, text, text, text) from public;
grant execute on function app.stock_receive(uuid, uuid, uuid, numeric, bigint, text, text, text, text) to authenticated;

-- Rule 4: a count records what is there; the difference is one adjustment at the current cost.
create or replace function app.stock_count(p_tenant uuid, p_location uuid, p_product uuid, p_counted numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  tp public.tenant_products;
  v_on_hand numeric;
  v_diff numeric;
  v_id uuid;
  v_value bigint;
begin
  if auth.uid() is not null and not app.has_permission(p_tenant, 'inventory.write') then raise exception 'counting stock needs inventory.write' using errcode = '42501'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'a count is zero or more' using errcode = '23514'; end if;
  if not exists (select 1 from public.stock_locations l where l.id = p_location and l.tenant_id = p_tenant) then
    raise exception 'that location is not one of the company''s' using errcode = '23514';
  end if;
  select * into tp from public.tenant_products where tenant_id = p_tenant and product_id = p_product for update;
  if tp.id is null then raise exception 'enable the product in the catalog first' using errcode = '23514'; end if;
  v_on_hand := app.stock_on_hand(p_tenant, p_product, p_location);
  v_diff := round(p_counted - v_on_hand, 4);
  if v_diff = 0 then return jsonb_build_object('movement_id', null, 'difference', 0, 'value_cents', 0); end if;
  v_value := round(abs(v_diff) * tp.unit_cost_cents)::bigint;
  insert into public.stock_movements (tenant_id, product_id, kind, from_location_id, to_location_id, quantity, unit, unit_cost_cents, value_cents, note)
  values (p_tenant, p_product, 'adjustment', case when v_diff < 0 then p_location end, case when v_diff > 0 then p_location end, abs(v_diff), tp.unit,
          tp.unit_cost_cents, v_value, coalesce(nullif(trim(p_note), ''), 'count'))
  returning id into v_id;
  return jsonb_build_object('movement_id', v_id, 'difference', v_diff, 'value_cents', case when v_diff < 0 then -v_value else v_value end);
end $$;
revoke all on function app.stock_count(uuid, uuid, uuid, numeric, text) from public;
grant execute on function app.stock_count(uuid, uuid, uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Time clock (rules 6 and 7)
-- ---------------------------------------------------------------------------

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  started_at timestamptz not null,
  ended_at timestamptz,
  source text not null default 'office' check (source in ('app', 'office')),
  note text check (note is null or length(note) <= 500),
  edited_by uuid references auth.users(id),
  edited_at timestamptz,
  edit_reason text check (edit_reason is null or length(trim(edit_reason)) > 0),
  pay_period_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, id),
  constraint time_entries_order check (ended_at is null or ended_at > started_at),
  constraint time_entries_no_overlap exclude using gist (tenant_id with =, user_id with =, tstzrange(started_at, coalesce(ended_at, 'infinity'::timestamptz)) with &&)
);
alter table public.time_entries enable row level security;
create unique index time_entries_one_open on public.time_entries (tenant_id, user_id) where ended_at is null;

-- A person clocks themselves in and out; the office's changes carry a reason; an exported period's entries are fixed.
create or replace function app.time_entries_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_payroll boolean;
begin
  if auth.uid() is null or not app.is_member(coalesce(new.tenant_id, old.tenant_id)) then return coalesce(new, old); end if;
  v_payroll := app.has_permission(coalesce(new.tenant_id, old.tenant_id), 'payroll.write');
  if tg_op = 'DELETE' then
    if old.pay_period_id is not null then raise exception 'this entry was exported with its pay period' using errcode = '42501'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.pay_period_id is not null then raise exception 'an entry joins a pay period when the period is exported' using errcode = '42501'; end if;
    if new.user_id <> auth.uid() or new.source = 'office' and new.ended_at is not null then
      if not v_payroll then raise exception 'only payroll adds time for someone else' using errcode = '42501'; end if;
      if new.edit_reason is null then raise exception 'say why the time is added' using errcode = '23514'; end if;
      new.edited_by := auth.uid();
      new.edited_at := now();
    end if;
    return new;
  end if;
  if old.pay_period_id is not null then raise exception 'this entry was exported with its pay period' using errcode = '42501'; end if;
  if new.tenant_id is distinct from old.tenant_id or new.user_id is distinct from old.user_id then
    raise exception 'an entry keeps its person' using errcode = '42501';
  end if;
  if new.pay_period_id is not null and not v_payroll then raise exception 'only payroll exports time' using errcode = '42501'; end if;
  -- Clocking out: the person's own open entry gets its end, nothing else.
  if old.user_id = auth.uid() and old.ended_at is null and new.ended_at is not null and new.started_at = old.started_at
     and new.edit_reason is not distinct from old.edit_reason and new.pay_period_id is null then
    return new;
  end if;
  if new.pay_period_id is not null and old.pay_period_id is null and (new.started_at, new.ended_at) is not distinct from (old.started_at, old.ended_at) then
    return new;
  end if;
  if not v_payroll then raise exception 'only payroll corrects time' using errcode = '42501'; end if;
  if new.edit_reason is null or new.edit_reason is not distinct from old.edit_reason and (new.started_at, new.ended_at) is distinct from (old.started_at, old.ended_at) then
    raise exception 'say why the time changes' using errcode = '23514';
  end if;
  new.edited_by := auth.uid();
  new.edited_at := now();
  return new;
end $$;
create trigger time_entries_guard before insert or update or delete on public.time_entries for each row execute function app.time_entries_guard();

-- ---------------------------------------------------------------------------
-- Pay (rules 9 to 13)
-- ---------------------------------------------------------------------------

alter table public.memberships add column payroll_id text check (payroll_id is null or length(payroll_id) <= 64);

create or replace function app.set_payroll_id(p_tenant uuid, p_user uuid, p_payroll_id text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not app.has_permission(p_tenant, 'payroll.write') then raise exception 'payroll ids need payroll.write' using errcode = '42501'; end if;
  update public.memberships set payroll_id = nullif(trim(p_payroll_id), '') where tenant_id = p_tenant and user_id = p_user;
  return found;
end $$;
revoke all on function app.set_payroll_id(uuid, uuid, text) from public;
grant execute on function app.set_payroll_id(uuid, uuid, text) to authenticated;

create table public.pay_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  period text not null default 'biweekly' check (period in ('weekly', 'biweekly', 'semimonthly')),
  anchor_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.pay_settings enable row level security;

create table public.pay_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  kind text not null check (kind in ('hourly', 'production', 'salary')),
  hourly_rate_cents bigint check (hourly_rate_cents is null or hourly_rate_cents >= 0),
  production_percent numeric(6, 3) check (production_percent is null or (production_percent > 0 and production_percent <= 100)),
  draw_cents bigint check (draw_cents is null or draw_cents >= 0),
  salary_cents bigint check (salary_cents is null or salary_cents >= 0),
  labor_cost_cents_per_hour bigint check (labor_cost_cents_per_hour is null or labor_cost_cents_per_hour >= 0),
  effective_from date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, user_id, effective_from),
  constraint pay_rates_kind check (case kind
    when 'hourly' then hourly_rate_cents is not null
    when 'production' then production_percent is not null
    when 'salary' then salary_cents is not null
    else false end)
);
alter table public.pay_rates enable row level security;

create table public.pay_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'exported' check (status in ('exported', 'posted')),
  exported_at timestamptz not null default now(),
  exported_by uuid default auth.uid(),
  gross_wages_cents bigint check (gross_wages_cents is null or gross_wages_cents >= 0),
  employer_taxes_cents bigint check (employer_taxes_cents is null or employer_taxes_cents >= 0),
  withholdings_cents bigint check (withholdings_cents is null or withholdings_cents >= 0),
  net_pay_cents bigint check (net_pay_cents is null or net_pay_cents >= 0),
  commissions_cents bigint not null default 0 check (commissions_cents >= 0),
  posted_on date,
  posted_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, starts_on),
  constraint pay_periods_order check (ends_on >= starts_on),
  constraint pay_periods_posted check ((status = 'posted') = (posted_on is not null and gross_wages_cents is not null and employer_taxes_cents is not null
                                                            and withholdings_cents is not null and net_pay_cents is not null)),
  constraint pay_periods_register check (gross_wages_cents is null or gross_wages_cents = net_pay_cents + withholdings_cents)
);
alter table public.pay_periods enable row level security;
alter table public.time_entries add constraint time_entries_period_fkey foreign key (tenant_id, pay_period_id) references public.pay_periods (tenant_id, id);

-- A period exports once and posts once; its figures do not change after.
create or replace function app.pay_periods_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  if (new.tenant_id, new.starts_on, new.ends_on, new.exported_at, new.exported_by, new.commissions_cents) is distinct from (old.tenant_id, old.starts_on, old.ends_on, old.exported_at, old.exported_by, old.commissions_cents) then
    raise exception 'an exported period keeps its days and its export' using errcode = '42501';
  end if;
  if old.status = 'posted' then raise exception 'this period''s payroll is already posted' using errcode = '42501'; end if;
  return new;
end $$;
create trigger pay_periods_guard before update on public.pay_periods for each row execute function app.pay_periods_guard();

create table public.pay_period_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  pay_period_id uuid not null,
  user_id uuid not null references auth.users(id),
  payroll_id text,
  name text not null,
  email text not null,
  kind text check (kind in ('hourly', 'production', 'salary')),
  hours numeric(8, 2) not null default 0,
  hours_by_week jsonb not null default '{}'::jsonb check (jsonb_typeof(hours_by_week) = 'object'),
  hourly_rate_cents bigint,
  production_revenue_cents bigint not null default 0,
  production_percent numeric(6, 3),
  production_pay_cents bigint not null default 0,
  draw_cents bigint,
  salary_cents bigint,
  pay_due_cents bigint,
  commissions_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pay_period_id, user_id),
  foreign key (tenant_id, pay_period_id) references public.pay_periods (tenant_id, id) on delete cascade
);
alter table public.pay_period_lines enable row level security;

alter table public.commission_payouts add column pay_period_id uuid;
alter table public.commission_payouts add constraint commission_payouts_period_fkey foreign key (tenant_id, pay_period_id) references public.pay_periods (tenant_id, id);

-- Payroll pays commissions too: the commission guard as spec 17's review left it, with payroll.write beside billing.write
-- for paying a payable commission and for netting a charged-back one.
drop policy commissions_update on public.commissions;
create policy commissions_update on public.commissions for update to authenticated
  using (app.has_permission(tenant_id, 'billing.write') or app.has_permission(tenant_id, 'agreements.write') or app.has_permission(tenant_id, 'payroll.write'))
  with check (app.has_permission(tenant_id, 'billing.write') or app.has_permission(tenant_id, 'agreements.write') or app.has_permission(tenant_id, 'payroll.write'));

create or replace function app.commissions_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p public.commission_plans;
  g public.agreements;
  v_tz text;
  v_today date;
  v_role text;
  v_terms record;
  v_paid integer;
begin
  select * into p from public.commission_plans where id = new.plan_id and tenant_id = new.tenant_id;
  if tg_op = 'INSERT' then
    new.hold_paid_invoices := p.hold_paid_invoices;
    new.chargeback_days := p.chargeback_days;
  end if;
  -- Jobs and the seed are trusted; another company's row is row level security's to refuse.
  if auth.uid() is null or not app.is_member(new.tenant_id) then return new; end if;
  select * into g from public.agreements where id = new.agreement_id and tenant_id = new.tenant_id;
  select timezone into v_tz from public.tenants where id = new.tenant_id;
  v_today := (now() at time zone v_tz)::date;
  if tg_op = 'INSERT' then
    select r.key into v_role from public.memberships m join public.roles r on r.id = m.role_id where m.tenant_id = new.tenant_id and m.user_id = new.user_id;
    if g.id is null or g.signed_at is null or g.sold_by is distinct from new.user_id then
      raise exception 'a commission is the seller''s, on a signed agreement' using errcode = '42501';
    end if;
    if p.id is null or not p.active or not (new.user_id = any(p.user_ids) or v_role = any(p.role_keys)) then
      raise exception 'that plan does not cover this seller' using errcode = '42501';
    end if;
    if new.status <> 'held' or new.released_on is not null or new.paid_on is not null or new.payout_id is not null or new.charged_back_on is not null then
      raise exception 'a commission starts held' using errcode = '42501';
    end if;
    select * into v_terms from app.commission_terms(new.agreement_id, new.plan_id);
    if new.basis_cents <> v_terms.basis_cents or new.amount_cents <> v_terms.amount_cents then
      raise exception 'the commission must be % on a basis of %', v_terms.amount_cents, v_terms.basis_cents using errcode = '23514';
    end if;
    -- Earned in the signing itself: a plan made later, or a sale signed long ago, earns nothing after the fact.
    if g.signed_at is distinct from now() or new.earned_on <> (g.signed_at at time zone v_tz)::date then
      raise exception 'a commission is earned when the agreement is signed, in the same step' using errcode = '42501';
    end if;
    new.releasable_on := new.earned_on + p.hold_days;
    return new;
  end if;
  if (new.tenant_id, new.user_id, new.agreement_id, new.plan_id, new.basis_cents, new.amount_cents, new.earned_on, new.releasable_on, new.hold_paid_invoices, new.chargeback_days)
     is distinct from (old.tenant_id, old.user_id, old.agreement_id, old.plan_id, old.basis_cents, old.amount_cents, old.earned_on, old.releasable_on, old.hold_paid_invoices, old.chargeback_days) then
    raise exception 'a commission''s terms do not change once earned' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if old.status = 'held' and new.status = 'payable' then
      select count(*)::int into v_paid from public.invoices i where i.agreement_id = new.agreement_id and i.kind = 'invoice' and i.status = 'paid';
      if not app.has_permission(new.tenant_id, 'billing.write') or v_today < old.releasable_on or v_paid < old.hold_paid_invoices then
        raise exception 'this commission is still held' using errcode = '42501';
      end if;
    elsif old.status = 'payable' and new.status = 'paid' then
      if not (app.has_permission(new.tenant_id, 'billing.write') or app.has_permission(new.tenant_id, 'payroll.write')) or new.payout_id is null then
        raise exception 'commissions are paid by a payout' using errcode = '42501';
      end if;
    elsif new.status = 'charged_back' and old.status in ('held', 'payable', 'paid') then
      if g.cancelled_on is null or g.cancelled_on > old.earned_on + old.chargeback_days then
        raise exception 'only an agreement cancelled inside the window charges back' using errcode = '42501';
      end if;
    else
      raise exception 'a commission cannot go from % to %', old.status, new.status using errcode = '42501';
    end if;
  elsif (new.released_on, new.paid_on, new.payout_id, new.charged_back_on) is distinct from (old.released_on, old.paid_on, old.payout_id, old.charged_back_on) then
    raise exception 'those dates follow the status' using errcode = '42501';
  end if;
  if new.recovered_payout_id is distinct from old.recovered_payout_id and (old.recovered_payout_id is not null or not (app.has_permission(new.tenant_id, 'billing.write') or app.has_permission(new.tenant_id, 'payroll.write'))) then
    raise exception 'only a payout recovers a charged back commission' using errcode = '42501';
  end if;
  return new;
end $$;

-- Job costing's labor rate for each person, for whoever reads reports; the rest of a pay rate stays with payroll.
create or replace function app.labor_costs(p_tenant uuid) returns table (user_id uuid, effective_from date, cents_per_hour bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.user_id, r.effective_from, coalesce(r.labor_cost_cents_per_hour, r.hourly_rate_cents)
  from public.pay_rates r
  where r.tenant_id = p_tenant and (auth.uid() is null or app.has_permission(p_tenant, 'reports.read') or app.has_permission(p_tenant, 'payroll.read'))
$$;
revoke all on function app.labor_costs(uuid) from public;
grant execute on function app.labor_costs(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The ledger: receipts, counts and the payroll journal
-- ---------------------------------------------------------------------------

alter table public.journal_entries drop constraint journal_entries_source_type_check;
alter table public.journal_entries add constraint journal_entries_source_type_check
  check (source_type in ('invoice', 'credit_memo', 'void', 'visit', 'product_use', 'payment', 'refund', 'payout', 'reclass', 'reclass_reversal', 'opening',
                         'manual', 'reversal', 'recognition', 'commission', 'commission_payout', 'stock_receipt', 'stock_adjustment', 'payroll'));

-- app.post_entry as spec 17 left it, with the sources a member's run may post for inventory and payroll.
create or replace function app.post_entry(p_tenant uuid, p_entry jsonb, p_lines jsonb, p_chart jsonb default '[]'::jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type text := p_entry->>'source_type';
  v_source uuid := nullif(p_entry->>'source_id', '')::uuid;
  v_reverses uuid := nullif(p_entry->>'reverses', '')::uuid;
  v_existing uuid;
  v_id uuid;
  v_account uuid;
  v_posted_on date := (p_entry->>'posted_on')::date;
  v_memo text := coalesce(p_entry->>'memo', '');
  v_debits bigint := 0;
  v_credits bigint := 0;
  v_ok boolean;
  l jsonb;
  i integer := 0;
begin
  if auth.uid() is not null then
    if not app.is_member(p_tenant) then raise exception 'not a member of this company' using errcode = '42501'; end if;
    if v_type in ('manual', 'reversal', 'opening', 'reclass', 'reclass_reversal') then
      if not app.has_permission(p_tenant, 'gl.write') then raise exception 'posting needs gl.write' using errcode = '42501'; end if;
    else
      v_ok := case v_type
        when 'invoice' then exists (select 1 from public.invoices x where x.id = v_source and x.tenant_id = p_tenant)
        when 'credit_memo' then exists (select 1 from public.invoices x where x.id = v_source and x.tenant_id = p_tenant)
        when 'void' then exists (select 1 from public.invoices x where x.id = v_source and x.tenant_id = p_tenant)
        when 'visit' then exists (select 1 from public.visits x where x.id = v_source and x.tenant_id = p_tenant)
        when 'recognition' then exists (select 1 from public.agreements x where x.id = v_source and x.tenant_id = p_tenant and x.recognition = 'straight_line')
        when 'commission' then exists (select 1 from public.commissions x where x.id = v_source and x.tenant_id = p_tenant)
        when 'commission_payout' then exists (select 1 from public.commission_payouts x where x.id = v_source and x.tenant_id = p_tenant)
        when 'product_use' then exists (select 1 from public.visit_products x where x.id = v_source and x.tenant_id = p_tenant)
        when 'payment' then exists (select 1 from public.payments x where x.id = v_source and x.tenant_id = p_tenant)
        when 'refund' then exists (select 1 from public.payments x where x.id = v_source and x.tenant_id = p_tenant)
        when 'payout' then exists (select 1 from public.payouts x where x.id = v_source and x.tenant_id = p_tenant)
        when 'stock_receipt' then exists (select 1 from public.stock_movements x where x.id = v_source and x.tenant_id = p_tenant and x.kind = 'receipt')
        when 'stock_adjustment' then exists (select 1 from public.stock_movements x where x.id = v_source and x.tenant_id = p_tenant and x.kind = 'adjustment')
        when 'payroll' then app.has_permission(p_tenant, 'payroll.write') and exists (select 1 from public.pay_periods x where x.id = v_source and x.tenant_id = p_tenant)
        else false end;
      if not v_ok then raise exception 'a % posting needs its source row in this company', v_type using errcode = '42501'; end if;
    end if;
  end if;
  select id into v_existing from public.journal_entries where tenant_id = p_tenant and source_key = p_entry->>'source_key';
  if v_existing is not null then return v_existing; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'a journal entry needs lines' using errcode = '23514';
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_debits := v_debits + coalesce((l->>'debit_cents')::bigint, 0);
    v_credits := v_credits + coalesce((l->>'credit_cents')::bigint, 0);
  end loop;
  if v_debits <> v_credits then
    raise exception 'journal entry does not balance: debits % credits %', v_debits, v_credits using errcode = '23514';
  end if;
  if v_reverses is not null then
    if not exists (select 1 from public.journal_entries r where r.id = v_reverses and r.tenant_id = p_tenant) then
      raise exception 'the entry to reverse is not in this company' using errcode = '23514';
    end if;
    if exists (select 1 from public.journal_entries r where r.id = v_reverses and r.reversed_by is not null) then
      raise exception 'this entry is already reversed' using errcode = '23514';
    end if;
  end if;
  -- An event dated in a closed month posts on the first open day, saying so (rule 9). A date the bookkeeper chose
  -- (a manual entry, a reversal, an opening position) is refused by the period check instead.
  if v_type not in ('manual', 'reversal', 'opening') then
    while exists (select 1 from public.period_closes c where c.tenant_id = p_tenant and c.period = to_char(v_posted_on, 'YYYY-MM') and c.status = 'closed') loop
      v_posted_on := (date_trunc('month', v_posted_on) + interval '1 month')::date;
    end loop;
    if v_posted_on <> (p_entry->>'posted_on')::date then
      v_memo := trim(v_memo || ' (dated ' || (p_entry->>'posted_on') || '; that period is closed, posted on ' || v_posted_on::text || ')');
    end if;
  end if;
  insert into public.journal_entries (tenant_id, posted_on, source_type, source_id, source_key, memo, reverses, posted_by)
  values (p_tenant, v_posted_on, v_type, v_source, p_entry->>'source_key', v_memo, v_reverses, auth.uid())
  returning id into v_id;
  perform set_config('app.posting_entry', v_id::text, true);
  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    v_account := nullif(l->>'gl_account_id', '')::uuid;
    if v_account is null then
      select g.id into v_account from public.gl_accounts g where g.tenant_id = p_tenant and g.key = l->>'account_key';
      if v_account is null then
        perform app.ensure_chart(p_tenant, p_chart);
        select g.id into v_account from public.gl_accounts g where g.tenant_id = p_tenant and g.key = l->>'account_key';
      end if;
      if v_account is null then raise exception 'no account for key %', l->>'account_key' using errcode = '23514'; end if;
    end if;
    -- The contract balance is per agreement: a deferred revenue line always names its agreement (spec 09 rule 7).
    if nullif(l->>'agreement_id', '') is null and exists (select 1 from public.gl_accounts g where g.id = v_account and g.key = 'contract_liability') then
      raise exception 'a deferred revenue line names its agreement' using errcode = '23514';
    end if;
    insert into public.journal_lines (tenant_id, entry_id, position, gl_account_id, debit_cents, credit_cents, agreement_id, jurisdiction, memo)
    values (p_tenant, v_id, i, v_account, coalesce((l->>'debit_cents')::bigint, 0), coalesce((l->>'credit_cents')::bigint, 0),
            nullif(l->>'agreement_id', '')::uuid, nullif(l->>'jurisdiction', ''), nullif(l->>'memo', ''));
  end loop;
  perform set_config('app.posting_entry', '', true);
  if v_reverses is not null then update public.journal_entries set reversed_by = v_id where id = v_reverses; end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

create policy inventory_settings_select on public.inventory_settings for select to authenticated using (app.is_member(tenant_id));
create policy inventory_settings_write on public.inventory_settings for all to authenticated
  using (app.has_permission(tenant_id, 'inventory.write')) with check (app.has_permission(tenant_id, 'inventory.write'));

create policy stock_locations_select on public.stock_locations for select to authenticated
  using (app.has_permission(tenant_id, 'inventory.read') or (app.is_member(tenant_id) and user_id = auth.uid()));
create policy stock_locations_insert on public.stock_locations for insert to authenticated with check (app.has_permission(tenant_id, 'inventory.write'));
create policy stock_locations_update on public.stock_locations for update to authenticated
  using (app.has_permission(tenant_id, 'inventory.write')) with check (app.has_permission(tenant_id, 'inventory.write'));

-- A technician reads their own truck's movements; usage comes off it under their session when a stop they worked
-- completes (rule 3). Receipts and counts go through the functions above.
create or replace function app.own_location(p_location uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.stock_locations l where l.id = p_location and l.user_id = auth.uid())
$$;
revoke all on function app.own_location(uuid) from public;
grant execute on function app.own_location(uuid) to authenticated;

create policy stock_movements_select on public.stock_movements for select to authenticated
  using (app.has_permission(tenant_id, 'inventory.read') or (app.is_member(tenant_id) and (app.own_location(from_location_id) or app.own_location(to_location_id))));
create policy stock_movements_insert on public.stock_movements for insert to authenticated
  with check ((app.has_permission(tenant_id, 'inventory.write') and kind in ('transfer', 'usage'))
              or (kind = 'usage' and app.on_crew(visit_id)
                  and exists (select 1 from public.visit_products vp where vp.id = visit_product_id and vp.visit_id = stock_movements.visit_id and vp.tenant_id = stock_movements.tenant_id)));

create policy time_entries_select on public.time_entries for select to authenticated
  using (app.has_permission(tenant_id, 'payroll.read') or (app.is_member(tenant_id) and user_id = auth.uid()));
create policy time_entries_insert on public.time_entries for insert to authenticated
  with check (app.has_permission(tenant_id, 'payroll.write') or (app.is_member(tenant_id) and user_id = auth.uid()));
create policy time_entries_update on public.time_entries for update to authenticated
  using (app.has_permission(tenant_id, 'payroll.write') or (app.is_member(tenant_id) and user_id = auth.uid() and ended_at is null))
  with check (app.has_permission(tenant_id, 'payroll.write') or (app.is_member(tenant_id) and user_id = auth.uid()));
create policy time_entries_delete on public.time_entries for delete to authenticated using (app.has_permission(tenant_id, 'payroll.write'));

create policy pay_settings_select on public.pay_settings for select to authenticated using (app.is_member(tenant_id));
create policy pay_settings_write on public.pay_settings for all to authenticated
  using (app.has_permission(tenant_id, 'payroll.write')) with check (app.has_permission(tenant_id, 'payroll.write'));

create policy pay_rates_select on public.pay_rates for select to authenticated
  using (app.has_permission(tenant_id, 'payroll.read') or (app.is_member(tenant_id) and user_id = auth.uid()));
create policy pay_rates_write on public.pay_rates for all to authenticated
  using (app.has_permission(tenant_id, 'payroll.write')) with check (app.has_permission(tenant_id, 'payroll.write'));

create policy pay_periods_select on public.pay_periods for select to authenticated using (app.has_permission(tenant_id, 'payroll.read'));
create policy pay_periods_insert on public.pay_periods for insert to authenticated
  with check (app.has_permission(tenant_id, 'payroll.write') and status = 'exported' and posted_on is null);
create policy pay_periods_update on public.pay_periods for update to authenticated
  using (app.has_permission(tenant_id, 'payroll.write')) with check (app.has_permission(tenant_id, 'payroll.write'));

create policy pay_period_lines_select on public.pay_period_lines for select to authenticated
  using (app.has_permission(tenant_id, 'payroll.read') or (app.is_member(tenant_id) and user_id = auth.uid()));
create policy pay_period_lines_insert on public.pay_period_lines for insert to authenticated with check (app.has_permission(tenant_id, 'payroll.write'));

-- Payroll pays commissions through the export (rule 12).
create policy commission_payouts_payroll_insert on public.commission_payouts for insert to authenticated
  with check (app.has_permission(tenant_id, 'payroll.write') and pay_period_id is not null);

-- ---------------------------------------------------------------------------
-- Timestamps, audit, the write guard
-- ---------------------------------------------------------------------------

create trigger inventory_settings_updated_at before update on public.inventory_settings for each row execute function app.set_updated_at();
create trigger stock_locations_updated_at before update on public.stock_locations for each row execute function app.set_updated_at();
create trigger time_entries_updated_at before update on public.time_entries for each row execute function app.set_updated_at();
create trigger pay_settings_updated_at before update on public.pay_settings for each row execute function app.set_updated_at();
create trigger pay_rates_updated_at before update on public.pay_rates for each row execute function app.set_updated_at();
create trigger pay_periods_updated_at before update on public.pay_periods for each row execute function app.set_updated_at();
create trigger stock_locations_audit after insert or update or delete on public.stock_locations for each row execute function app.write_audit();
create trigger time_entries_audit after insert or update or delete on public.time_entries for each row execute function app.write_audit();
create trigger pay_rates_audit after insert or update or delete on public.pay_rates for each row execute function app.write_audit();
create trigger pay_periods_audit after insert or update or delete on public.pay_periods for each row execute function app.write_audit();

create trigger tenant_write_guard before insert or update or delete on public.inventory_settings for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.stock_locations for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.stock_movements for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.time_entries for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.pay_settings for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.pay_rates for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.pay_periods for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.pay_period_lines for each row execute function app.guard_tenant_write();
