-- Spec 18 review fixes. Time inside an exported period cannot be added, moved or closed; periods never overlap; payroll
-- finds people who have left; usage comes off the shelves through one definer function (any member's job run can
-- record it, quantities worked out here, never sent in); technicians see only their own truck; labor costs and stock
-- postings stay with the people they belong to.

-- ---------------------------------------------------------------------------
-- Usage in the database (rules 1 and 3): the label units, then each application line off the right shelf, once
-- ---------------------------------------------------------------------------

-- The same units and factors as lib/catalog/label-rates.ts: volume in milliliters, mass in grams, count as is.
create or replace function app.unit_factor(p_unit text) returns table (dimension text, factor numeric)
language sql immutable as $$
  select d, f from (values
    ('ml', 'volume', 1::numeric), ('l', 'volume', 1000), ('fl_oz', 'volume', 29.5735), ('pt', 'volume', 473.176), ('qt', 'volume', 946.353), ('gal', 'volume', 3785.41),
    ('g', 'mass', 1), ('kg', 'mass', 1000), ('oz', 'mass', 28.3495), ('lb', 'mass', 453.592), ('each', 'count', 1)
  ) u(name, d, f) where u.name = p_unit
$$;

create or replace function app.record_usage(p_tenant uuid, p_visit uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  a record;
  b record;
  v_from uuid;
  v_qty numeric;
  v_recorded integer := 0;
  v_unconverted integer := 0;
  v_unplaced integer := 0;
begin
  if auth.uid() is not null and not app.is_member(p_tenant) then raise exception 'not a member of this company' using errcode = '42501'; end if;
  for r in
    select vp.id as visit_product_id, v.id as visit_id, vp.product_id, vp.amount, vp.amount_unit, tp.unit as stock_unit, tp.unit_cost_cents, v.technician_id, v.branch_id, v.completed_at
    from public.visit_products vp
      join public.visits v on v.id = vp.visit_id
      join public.inventory_settings s on s.tenant_id = v.tenant_id
      join public.tenants t on t.id = v.tenant_id
      join public.tenant_products tp on tp.tenant_id = vp.tenant_id and tp.product_id = vp.product_id
    where vp.tenant_id = p_tenant and v.status = 'completed' and not v.imported and (p_visit is null or v.id = p_visit)
      and (v.completed_at at time zone t.timezone)::date >= s.tracking_since
      and not exists (select 1 from public.stock_movements m where m.visit_product_id = vp.id)
    order by v.completed_at, vp.id
  loop
    select * into a from app.unit_factor(r.amount_unit);
    select * into b from app.unit_factor(r.stock_unit);
    if a.dimension is null or b.dimension is null or a.dimension <> b.dimension then
      v_unconverted := v_unconverted + 1;
      continue;
    end if;
    v_qty := round(r.amount * a.factor / b.factor, 4);
    if v_qty <= 0 then continue; end if;
    -- The lead technician's truck, else the visit's own branch's warehouse; never another branch's shelf.
    select l.id into v_from from public.stock_locations l where l.tenant_id = p_tenant and l.kind = 'truck' and l.active and l.user_id = r.technician_id;
    if v_from is null then
      select l.id into v_from from public.stock_locations l where l.tenant_id = p_tenant and l.kind = 'warehouse' and l.active and l.branch_id = r.branch_id;
    end if;
    if v_from is null then
      v_unplaced := v_unplaced + 1;
      continue;
    end if;
    insert into public.stock_movements (tenant_id, product_id, kind, from_location_id, quantity, unit, unit_cost_cents, value_cents, visit_id, visit_product_id, occurred_at)
    values (p_tenant, r.product_id, 'usage', v_from, v_qty, r.stock_unit, r.unit_cost_cents, round(v_qty * r.unit_cost_cents)::bigint, r.visit_id, r.visit_product_id, r.completed_at)
    on conflict (visit_product_id) do nothing;
    if found then v_recorded := v_recorded + 1; end if;
  end loop;
  return jsonb_build_object('recorded', v_recorded, 'unconverted', v_unconverted, 'unplaced', v_unplaced);
end $$;
revoke all on function app.record_usage(uuid, uuid) from public;
grant execute on function app.record_usage(uuid, uuid) to authenticated;

-- Usage is written only by the function above; members insert transfers (inventory staff) and nothing else.
drop policy stock_movements_insert on public.stock_movements;
create policy stock_movements_insert on public.stock_movements for insert to authenticated
  with check (app.has_permission(tenant_id, 'inventory.write') and kind = 'transfer');

-- A technician reads their own truck (the own-location policies), not every truck.
update public.roles set permissions = array_remove(permissions, 'inventory.read') where tenant_id is null and key = 'technician';

-- ---------------------------------------------------------------------------
-- Time and pay periods (rules 6, 7, 9 and 12)
-- ---------------------------------------------------------------------------

alter table public.pay_periods add constraint pay_periods_no_overlap exclude using gist (tenant_id with =, daterange(starts_on, ends_on, '[]') with &&);

-- Does an entry's time touch a period already sent to the payroll provider?
create or replace function app.in_exported_period(p_tenant uuid, p_start timestamptz, p_end timestamptz) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.pay_periods pp join public.tenants t on t.id = pp.tenant_id
    where pp.tenant_id = p_tenant
      and tstzrange(pp.starts_on::timestamp at time zone t.timezone, (pp.ends_on + 1)::timestamp at time zone t.timezone) && tstzrange(p_start, coalesce(p_end, 'infinity'::timestamptz)))
$$;
revoke all on function app.in_exported_period(uuid, timestamptz, timestamptz) from public;
grant execute on function app.in_exported_period(uuid, timestamptz, timestamptz) to authenticated;

create or replace function app.time_entries_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_payroll boolean;
begin
  if auth.uid() is null or not app.is_member(coalesce(new.tenant_id, old.tenant_id)) then return coalesce(new, old); end if;
  v_payroll := app.has_permission(coalesce(new.tenant_id, old.tenant_id), 'payroll.write');
  if tg_op = 'DELETE' then
    if old.pay_period_id is not null or app.in_exported_period(old.tenant_id, old.started_at, old.ended_at) then
      raise exception 'this entry was exported with its pay period' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.pay_period_id is not null then raise exception 'an entry joins a pay period when the period is exported' using errcode = '42501'; end if;
    if app.in_exported_period(new.tenant_id, new.started_at, new.ended_at) then
      raise exception 'that time is in a pay period already exported; it goes in the next one' using errcode = '42501';
    end if;
    -- A person clocks in; a finished entry is payroll's to add, with its reason.
    if new.user_id <> auth.uid() or new.ended_at is not null then
      if not v_payroll then raise exception 'only payroll adds time for someone else or after the fact' using errcode = '42501'; end if;
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
  -- The export itself locks the entry.
  if new.pay_period_id is not null and old.pay_period_id is null and (new.started_at, new.ended_at) is not distinct from (old.started_at, old.ended_at) then
    return new;
  end if;
  if app.in_exported_period(new.tenant_id, least(new.started_at, old.started_at), greatest(coalesce(new.ended_at, 'infinity'::timestamptz), coalesce(old.ended_at, 'infinity'::timestamptz))) then
    raise exception 'that time is in a pay period already exported; it goes in the next one' using errcode = '42501';
  end if;
  -- Clocking out: the person's own open entry gets its end, nothing else.
  if old.user_id = auth.uid() and old.ended_at is null and new.ended_at is not null and new.started_at = old.started_at
     and new.edit_reason is not distinct from old.edit_reason and new.pay_period_id is null then
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

-- Rule 10's people: everyone with a membership, or time, a rate or commissions in the company (someone who has left
-- still gets their last pay), with the email the payroll provider knows them by.
create or replace function app.payroll_people(p_tenant uuid) returns table (user_id uuid, name text, email text, payroll_id text)
language sql stable security definer set search_path = public, pg_temp, auth as $$
  with ids as (
    select m.user_id from public.memberships m where m.tenant_id = p_tenant
    union select e.user_id from public.time_entries e where e.tenant_id = p_tenant
    union select r.user_id from public.pay_rates r where r.tenant_id = p_tenant
    union select c.user_id from public.commissions c where c.tenant_id = p_tenant
    union select v.technician_id from public.visits v where v.tenant_id = p_tenant and v.technician_id is not null and v.status = 'completed' and v.completed_at > now() - interval '120 days'
    union select vc.user_id from public.visit_crew vc where vc.tenant_id = p_tenant and vc.created_at > now() - interval '120 days'
  )
  select i.user_id, coalesce(m.display_name, u.email, 'Former member'), coalesce(u.email, ''), m.payroll_id
  from ids i left join auth.users u on u.id = i.user_id left join public.memberships m on m.tenant_id = p_tenant and m.user_id = i.user_id
  where auth.uid() is null or app.has_permission(p_tenant, 'payroll.read')
$$;
revoke all on function app.payroll_people(uuid) from public;
grant execute on function app.payroll_people(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Labor cost is pay: only payroll reads it (job costing shows labor as not priced to everyone else)
-- ---------------------------------------------------------------------------

create or replace function app.labor_costs(p_tenant uuid) returns table (user_id uuid, effective_from date, cents_per_hour bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.user_id, r.effective_from, coalesce(r.labor_cost_cents_per_hour, r.hourly_rate_cents)
  from public.pay_rates r
  where r.tenant_id = p_tenant and (auth.uid() is null or app.has_permission(p_tenant, 'payroll.read'))
$$;

-- ---------------------------------------------------------------------------
-- Stock postings are inventory staff's (app.post_entry as spec 18 left it, with that one change)
-- ---------------------------------------------------------------------------

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
        when 'stock_receipt' then app.has_permission(p_tenant, 'inventory.write') and exists (select 1 from public.stock_movements x where x.id = v_source and x.tenant_id = p_tenant and x.kind = 'receipt')
        when 'stock_adjustment' then app.has_permission(p_tenant, 'inventory.write') and exists (select 1 from public.stock_movements x where x.id = v_source and x.tenant_id = p_tenant and x.kind = 'adjustment')
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

-- Payroll sees the clock changes a phone sent that were refused (an exported period, a double clock-in), to settle them.
create policy sync_log_payroll_select on public.sync_log for select to authenticated using (kind = 'clock' and app.has_permission(tenant_id, 'payroll.read'));
