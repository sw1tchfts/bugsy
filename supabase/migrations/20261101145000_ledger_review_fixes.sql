-- Spec 09 review fixes. Members who cannot read the journal (the office voiding an invoice, a technician completing a
-- stop) still get their events posted inline: the lookups and the mirror image of a reversal happen in security
-- definer functions gated the way app.post_entry is. A deferred revenue line always names its agreement; the
-- period-end reclass is the job's to adjust, never reversed by hand; a reversal is dated today or later; template
-- accounts stay active; a refund records which allocations it released, so the cash view can tell receipts from
-- refunds.

-- Whether an entry exists for a source key, for any member of the company (the answer is an id, nothing more).
create or replace function app.journal_entry_by_key(p_tenant uuid, p_key text) returns table (id uuid, reversed_by uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id, e.reversed_by from public.journal_entries e
  where e.tenant_id = p_tenant and e.source_key = p_key and (auth.uid() is null or app.is_member(p_tenant))
$$;
revoke all on function app.journal_entry_by_key(uuid, text) from public;
grant execute on function app.journal_entry_by_key(uuid, text) to authenticated, service_role;

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
revoke all on function app.post_entry(uuid, jsonb, jsonb, jsonb) from public;
grant execute on function app.post_entry(uuid, jsonb, jsonb, jsonb) to authenticated, service_role;

-- The mirror image of an entry, posted through app.post_entry and linked both ways (rule 11). A void needs its invoice
-- in the company like any system posting; a manual reversal needs gl.write and a date no earlier than today in the
-- company's zone. The period-end reclass and its reversal are adjusted by the job, never reversed by hand.
create or replace function app.reverse_entry(p_tenant uuid, p_target uuid, p_entry jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t record;
  v_today date;
  v_lines jsonb;
begin
  if auth.uid() is not null and not app.is_member(p_tenant) then raise exception 'not a member of this company' using errcode = '42501'; end if;
  select id, number, source_type, reversed_by into t from public.journal_entries where id = p_target and tenant_id = p_tenant;
  if t.id is null then raise exception 'journal entry not found' using errcode = '23514'; end if;
  if t.reversed_by is not null then raise exception 'entry % is already reversed', t.number using errcode = '23514'; end if;
  if t.source_type in ('reclass', 'reclass_reversal') then
    raise exception 'the period-end reclass is adjusted by the job; it is not reversed by hand' using errcode = '23514';
  end if;
  if p_entry->>'source_type' = 'reversal' then
    select (now() at time zone coalesce(x.timezone, 'UTC'))::date into v_today from public.tenants x where x.id = p_tenant;
    if (p_entry->>'posted_on')::date < v_today then
      raise exception 'a reversal is dated today or later; the original stays where it was posted' using errcode = '23514';
    end if;
  end if;
  select jsonb_agg(jsonb_build_object('gl_account_id', l.gl_account_id, 'debit_cents', l.credit_cents, 'credit_cents', l.debit_cents,
                                      'agreement_id', l.agreement_id, 'jurisdiction', l.jurisdiction, 'memo', l.memo) order by l.position)
  into v_lines from public.journal_lines l where l.entry_id = p_target;
  return app.post_entry(p_tenant, p_entry || jsonb_build_object('reverses', p_target), v_lines);
end $$;
revoke all on function app.reverse_entry(uuid, uuid, jsonb) from public;
grant execute on function app.reverse_entry(uuid, uuid, jsonb) to authenticated, service_role;

-- Template accounts are what the postings name; they stay active.
create or replace function app.protect_gl_account() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.system then raise exception 'template accounts are never deleted' using errcode = '23514'; end if;
    if exists (select 1 from public.journal_lines l where l.gl_account_id = old.id) then
      raise exception 'an account with journal lines is never deleted; deactivate it instead' using errcode = '23514';
    end if;
    return old;
  end if;
  if old.system and (new.key is distinct from old.key or new.type <> old.type or new.subtype <> old.subtype) then
    raise exception 'a template account keeps its key, type and subtype' using errcode = '23514';
  end if;
  if old.system and not new.active then raise exception 'template accounts stay active; the postings use them' using errcode = '23514'; end if;
  if new.tenant_id <> old.tenant_id then raise exception 'accounts never move between companies' using errcode = '23514'; end if;
  return new;
end $$;

-- Which allocations a refund gave back, [{invoice_id, cents}], so the cash view counts the original receipt on its day
-- and the refund on its own.
alter table public.payments add column released_allocations jsonb not null default '[]'::jsonb check (jsonb_typeof(released_allocations) = 'array');
