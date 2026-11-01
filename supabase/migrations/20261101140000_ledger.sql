-- Spec 09: the general ledger. A chart of accounts per company from the pest template, journal entries whose lines
-- balance to the cent and are never edited or deleted (a correction is a reversal), one contract balance per agreement
-- on the contract liability subledger, sales tax payable by jurisdiction, monthly periods that refuse postings once
-- closed, and gateway payouts. Entries are written only through app.post_entry, which checks the balance and the
-- period and seals the lines to the entry being posted.

-- ---------------------------------------------------------------------------
-- Chart of accounts
-- ---------------------------------------------------------------------------
create table public.gl_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text,
  number text not null,
  name text not null,
  type text not null check (type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  subtype text not null check (subtype in ('bank', 'clearing', 'receivable', 'contract_asset', 'inventory', 'fixed_asset', 'contract_liability', 'tax_payable', 'payable',
                                           'service_revenue', 'other_income', 'cost_of_service', 'operating_expense', 'equity')),
  active boolean not null default true,
  system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, number),
  unique (tenant_id, key),
  constraint gl_accounts_number_shape check (number ~ '^[0-9]{3,6}$'),
  constraint gl_accounts_name check (length(trim(name)) > 0)
);
alter table public.gl_accounts enable row level security;
create trigger gl_accounts_updated_at before update on public.gl_accounts for each row execute function app.set_updated_at();

-- A template account stays; any account with lines stays.
create or replace function app.protect_gl_account() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.system then raise exception 'template accounts are never deleted; deactivate instead' using errcode = '23514'; end if;
    if exists (select 1 from public.journal_lines l where l.gl_account_id = old.id) then
      raise exception 'an account with journal lines is never deleted; deactivate instead' using errcode = '23514';
    end if;
    return old;
  end if;
  if old.system and (new.key is distinct from old.key or new.type <> old.type or new.subtype <> old.subtype) then
    raise exception 'a template account keeps its key, type and subtype' using errcode = '23514';
  end if;
  if new.tenant_id <> old.tenant_id then raise exception 'accounts never move between companies' using errcode = '23514'; end if;
  return new;
end $$;
create trigger gl_accounts_protect before update or delete on public.gl_accounts for each row execute function app.protect_gl_account();

-- ---------------------------------------------------------------------------
-- Journal
-- ---------------------------------------------------------------------------
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  number integer,
  posted_on date not null,
  period text not null default '',
  source_type text not null check (source_type in ('invoice', 'credit_memo', 'void', 'visit', 'product_use', 'payment', 'refund', 'payout', 'reclass', 'reclass_reversal', 'opening', 'manual', 'reversal')),
  source_id uuid,
  source_key text not null,
  memo text not null default '',
  reverses uuid references public.journal_entries(id),
  reversed_by uuid references public.journal_entries(id),
  posted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, source_key),
  unique (tenant_id, number)
);
create index journal_entries_period on public.journal_entries (tenant_id, period, posted_on);
create index journal_entries_source on public.journal_entries (tenant_id, source_type, source_id);
alter table public.journal_entries enable row level security;

create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  entry_id uuid not null references public.journal_entries(id) on delete restrict,
  position integer not null,
  gl_account_id uuid not null references public.gl_accounts(id) on delete restrict,
  debit_cents bigint not null default 0 check (debit_cents >= 0),
  credit_cents bigint not null default 0 check (credit_cents >= 0),
  agreement_id uuid references public.agreements(id) on delete restrict,
  jurisdiction text,
  memo text,
  created_at timestamptz not null default now(),
  constraint journal_lines_one_side check ((debit_cents > 0 and credit_cents = 0) or (credit_cents > 0 and debit_cents = 0)),
  unique (entry_id, position)
);
create index journal_lines_account on public.journal_lines (tenant_id, gl_account_id);
create index journal_lines_agreement on public.journal_lines (tenant_id, agreement_id) where agreement_id is not null;
create index journal_lines_entry on public.journal_lines (entry_id);
alter table public.journal_lines enable row level security;

-- Periods are calendar months in the company's zone; a closed one refuses postings until an owner reopens it.
create table public.period_closes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'closed' check (status in ('closed', 'reopened')),
  closed_at timestamptz not null default now(),
  closed_by uuid references auth.users(id),
  reopened_at timestamptz,
  reopened_by uuid references auth.users(id),
  reopen_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, period),
  constraint period_closes_reason check (status <> 'reopened' or (reopen_reason is not null and length(trim(reopen_reason)) > 0))
);
alter table public.period_closes enable row level security;
create trigger period_closes_updated_at before update on public.period_closes for each row execute function app.set_updated_at();
create trigger period_closes_audit after insert or update or delete on public.period_closes for each row execute function app.write_audit();

-- Gateway payouts: the gross the gateway collected, what it kept, and what reached the bank.
create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  gateway text not null check (gateway in ('local', 'stripe')),
  gateway_payout_id text not null,
  arrived_on date not null,
  gross_cents bigint not null check (gross_cents >= 0),
  fee_cents bigint not null check (fee_cents >= 0),
  net_cents bigint not null,
  status text not null default 'paid' check (status in ('paid', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (gateway, gateway_payout_id),
  constraint payouts_net check (net_cents = gross_cents - fee_cents)
);
create index payouts_tenant on public.payouts (tenant_id, arrived_on);
alter table public.payouts enable row level security;
alter table public.payments add column payout_id uuid references public.payouts(id);

-- An invoice line says what it is, so the posting engine does not read descriptions.
alter table public.invoice_lines add column kind text not null default 'service' check (kind in ('service', 'fee', 'late_fee'));
update public.invoice_lines l set kind = 'late_fee' from public.invoices i where i.id = l.invoice_id and i.source = 'late_fee';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function app.is_owner(tenant uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.memberships m where m.tenant_id = tenant and m.user_id = auth.uid() and app.role_is_owner(m.role_id));
$$;
revoke all on function app.is_owner(uuid) from public;
grant execute on function app.is_owner(uuid) to authenticated, service_role;

-- Number and period before the row is checked; the closed-period rule after row level security has had its say.
create or replace function app.journal_entry_defaults() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.number is null then new.number := app.next_number(new.tenant_id, 'journal'); end if;
  new.period := to_char(new.posted_on, 'YYYY-MM');
  return new;
end $$;
create trigger journal_entries_defaults before insert on public.journal_entries for each row execute function app.journal_entry_defaults();

create or replace function app.check_journal_period() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.period_closes c where c.tenant_id = new.tenant_id and c.period = new.period and c.status = 'closed') then
    raise exception 'period % is closed; post the correction in the open period', new.period using errcode = '23514';
  end if;
  return null;
end $$;
create trigger journal_entries_period after insert on public.journal_entries for each row execute function app.check_journal_period();

-- Entries never change, except to record the entry that reversed them.
create or replace function app.protect_journal_entry() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then raise exception 'journal entries are never deleted; reverse them' using errcode = '23514'; end if;
  if (to_jsonb(new) - 'reversed_by') <> (to_jsonb(old) - 'reversed_by') then
    raise exception 'journal entries never change; reverse them' using errcode = '23514';
  end if;
  if old.reversed_by is not null and new.reversed_by is distinct from old.reversed_by then
    raise exception 'this entry is already reversed' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger journal_entries_protect before update or delete on public.journal_entries for each row execute function app.protect_journal_entry();

-- Lines are written with their entry, by app.post_entry, and never change. Checked after row level security, so a
-- row from another company is refused by the policy first.
create or replace function app.seal_journal_line() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e record;
  a record;
begin
  if tg_op <> 'INSERT' then raise exception 'journal lines never change; reverse the entry' using errcode = '23514'; end if;
  if coalesce(current_setting('app.posting_entry', true), '') <> new.entry_id::text then
    raise exception 'journal lines are written with their entry through app.post_entry' using errcode = '23514';
  end if;
  select tenant_id, created_at into e from public.journal_entries where id = new.entry_id;
  if e.tenant_id is null or e.tenant_id <> new.tenant_id then raise exception 'line and entry belong to different companies' using errcode = '23514'; end if;
  -- Only the transaction that created the entry adds its lines; an old entry never gains one.
  if e.created_at <> now() then raise exception 'journal lines are written with their entry through app.post_entry' using errcode = '23514'; end if;
  select tenant_id, active into a from public.gl_accounts where id = new.gl_account_id;
  if a.tenant_id is null or a.tenant_id <> new.tenant_id then raise exception 'the account belongs to another company' using errcode = '23514'; end if;
  if not a.active then raise exception 'the account is inactive' using errcode = '23514'; end if;
  if new.agreement_id is not null and not exists (select 1 from public.agreements g where g.id = new.agreement_id and g.tenant_id = new.tenant_id) then
    raise exception 'the agreement belongs to another company' using errcode = '23514';
  end if;
  return null;
end $$;
create trigger journal_lines_seal after insert or update or delete on public.journal_lines for each row execute function app.seal_journal_line();

-- At commit, every entry has lines and balances to the cent.
create or replace function app.check_journal_balance() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d bigint;
  c bigint;
  n integer;
begin
  select coalesce(sum(debit_cents), 0), coalesce(sum(credit_cents), 0), count(*) into d, c, n from public.journal_lines where entry_id = new.id;
  if n = 0 then raise exception 'journal entry % has no lines', new.number using errcode = '23514'; end if;
  if d <> c then raise exception 'journal entry % does not balance: debits % credits %', new.number, d, c using errcode = '23514'; end if;
  return null;
end $$;
create constraint trigger journal_entries_balance after insert on public.journal_entries deferrable initially deferred for each row execute function app.check_journal_balance();

create or replace function app.check_journal_line_balance() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d bigint;
  c bigint;
begin
  select coalesce(sum(debit_cents), 0), coalesce(sum(credit_cents), 0) into d, c from public.journal_lines where entry_id = new.entry_id;
  if d <> c then raise exception 'journal entry does not balance: debits % credits %', d, c using errcode = '23514'; end if;
  return null;
end $$;
create constraint trigger journal_lines_balance after insert on public.journal_lines deferrable initially deferred for each row execute function app.check_journal_line_balance();

-- The chart from the template the app passes in (lib/ledger/chart.ts), created once per company by whoever posts first.
create or replace function app.ensure_chart(p_tenant uuid, p_chart jsonb) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a jsonb;
  added integer := 0;
begin
  if auth.uid() is not null and not app.is_member(p_tenant) then raise exception 'not a member of this company' using errcode = '42501'; end if;
  for a in select * from jsonb_array_elements(coalesce(p_chart, '[]'::jsonb)) loop
    if not exists (select 1 from public.gl_accounts g where g.tenant_id = p_tenant and g.key = a->>'key') then
      insert into public.gl_accounts (tenant_id, key, number, name, type, subtype, system)
      values (p_tenant, a->>'key', a->>'number', a->>'name', a->>'type', a->>'subtype', true)
      on conflict (tenant_id, number) do nothing;
      added := added + 1;
    end if;
  end loop;
  return added;
end $$;
revoke all on function app.ensure_chart(uuid, jsonb) from public;
grant execute on function app.ensure_chart(uuid, jsonb) to authenticated, service_role;

-- The one way to post. System postings (an invoice, a visit, a payment...) ride on a row the member just wrote in
-- this company; manual entries, reversals, opening positions and reclasses need gl.write. Idempotent by source key.
-- Lines name an account by template key or by id.
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
        when 'product_use' then exists (select 1 from public.visit_products x where x.id = v_source and x.tenant_id = p_tenant)
        when 'payment' then exists (select 1 from public.payments x where x.id = v_source and x.tenant_id = p_tenant)
        when 'refund' then exists (select 1 from public.payments x where x.id = v_source and x.tenant_id = p_tenant)
        when 'payout' then exists (select 1 from public.payouts x where x.id = v_source and x.tenant_id = p_tenant)
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
    insert into public.journal_lines (tenant_id, entry_id, position, gl_account_id, debit_cents, credit_cents, agreement_id, jurisdiction, memo)
    values (p_tenant, v_id, i, v_account, coalesce((l->>'debit_cents')::bigint, 0), coalesce((l->>'credit_cents')::bigint, 0),
            nullif(l->>'agreement_id', '')::uuid, nullif(l->>'jurisdiction', ''), nullif(l->>'memo', ''));
  end loop;
  perform set_config('app.posting_entry', '', true);
  if v_reverses is not null then update public.journal_entries set reversed_by = v_id where id = v_reverses; end if;
  return v_id;
end $$;
revoke all on function app.post_entry(uuid, jsonb, jsonb, jsonb) from public;
grant execute on function app.post_entry(uuid, jsonb, jsonb, jsonb) to authenticated, service_role;

-- Closing is gl.write's; reopening is an owner's, with a reason; the audit log keeps both.
create or replace function app.protect_period_close() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then raise exception 'period closes are never deleted; reopen the period' using errcode = '23514'; end if;
  if tg_op = 'INSERT' then
    new.status := 'closed';
    new.closed_at := now();
    new.closed_by := coalesce(new.closed_by, auth.uid());
    new.reopened_at := null;
    new.reopened_by := null;
    new.reopen_reason := null;
    return new;
  end if;
  if new.period <> old.period or new.tenant_id <> old.tenant_id then raise exception 'a period close keeps its period' using errcode = '23514'; end if;
  if new.status = 'reopened' and old.status = 'closed' then
    if auth.uid() is not null and not app.is_owner(new.tenant_id) then
      raise exception 'only an owner reopens a closed period' using errcode = '42501';
    end if;
    new.reopened_at := now();
    new.reopened_by := coalesce(auth.uid(), new.reopened_by);
  elsif new.status = 'closed' and old.status = 'reopened' then
    new.closed_at := now();
    new.closed_by := coalesce(auth.uid(), new.closed_by);
  end if;
  return new;
end $$;
create trigger period_closes_protect before insert or update or delete on public.period_closes for each row execute function app.protect_period_close();

-- Payouts are recorded by the job and the webhook and never change; the payments they cover point at them.
create or replace function app.protect_payout() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'payouts never change' using errcode = '23514';
end $$;
create trigger payouts_protect before update or delete on public.payouts for each row execute function app.protect_payout();

-- ---------------------------------------------------------------------------
-- Policies (spec 09 rule 17)
-- ---------------------------------------------------------------------------
create policy gl_accounts_select on public.gl_accounts for select to authenticated using (app.has_permission(tenant_id, 'gl.read'));
create policy gl_accounts_insert on public.gl_accounts for insert to authenticated with check (app.has_permission(tenant_id, 'gl.write'));
create policy gl_accounts_update on public.gl_accounts for update to authenticated
  using (app.has_permission(tenant_id, 'gl.write')) with check (app.has_permission(tenant_id, 'gl.write'));
create policy gl_accounts_delete on public.gl_accounts for delete to authenticated using (app.has_permission(tenant_id, 'gl.write'));

-- The journal is read by gl.read and written by nobody directly: app.post_entry is the only writer (rules 1 and 11).
create policy journal_entries_select on public.journal_entries for select to authenticated using (app.has_permission(tenant_id, 'gl.read'));
create policy journal_lines_select on public.journal_lines for select to authenticated using (app.has_permission(tenant_id, 'gl.read'));

create policy period_closes_select on public.period_closes for select to authenticated using (app.has_permission(tenant_id, 'gl.read'));
create policy period_closes_insert on public.period_closes for insert to authenticated with check (app.has_permission(tenant_id, 'gl.write'));
create policy period_closes_update on public.period_closes for update to authenticated
  using (app.has_permission(tenant_id, 'gl.write')) with check (app.has_permission(tenant_id, 'gl.write'));

create policy payouts_select on public.payouts for select to authenticated
  using (app.has_permission(tenant_id, 'billing.read') or app.has_permission(tenant_id, 'gl.read'));
create policy payouts_insert on public.payouts for insert to authenticated
  with check (app.has_permission(tenant_id, 'billing.write') or app.has_permission(tenant_id, 'gl.write'));
