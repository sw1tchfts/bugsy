-- Spec 15: specialty services. Job plans and straight-line (warranty) recognition on agreements; service type job
-- plans and prep checklists; wildlife authorizations and captures; materials; prep checks; termite diagram marks and
-- WDI reports. Every new table is tenant-owned, under row level security and the write guard.

-- ---------------------------------------------------------------------------
-- Agreements, visits and service types (rules 1 and 2)
-- ---------------------------------------------------------------------------

alter table public.agreements drop constraint agreements_cadence_check;
alter table public.agreements add constraint agreements_cadence_check
  check (cadence in ('monthly', 'bimonthly', 'quarterly', 'custom', 'seasonal_rounds', 'job_plan'));
alter table public.agreements add constraint agreements_job_plan_steps
  -- A CASE, not AND: a missing steps key must fail the check rather than make it NULL (which passes).
  check (cadence <> 'job_plan' or case when jsonb_typeof(cadence_rule -> 'steps') = 'array' then jsonb_array_length(cadence_rule -> 'steps') between 1 and 20 else false end);
alter table public.agreements add column recognition text not null default 'per_visit' check (recognition in ('per_visit', 'straight_line'));

alter table public.visits add column step_label text;

-- Straight-line recognition posts as its own kind of entry, sourced from the agreement (rule 2).
alter table public.journal_entries drop constraint journal_entries_source_type_check;
alter table public.journal_entries add constraint journal_entries_source_type_check
  check (source_type in ('invoice', 'credit_memo', 'void', 'visit', 'product_use', 'payment', 'refund', 'payout', 'reclass', 'reclass_reversal', 'opening', 'manual', 'reversal', 'recognition'));

-- app.post_entry as spec 09's review left it, with one more source a member's run may post: a straight-line agreement.
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

alter table public.service_types add column job_plan jsonb
  check (job_plan is null or case when jsonb_typeof(job_plan) = 'array' then jsonb_array_length(job_plan) between 1 and 20 else false end);
alter table public.service_types add column prep_checklist text[] not null default '{}';

-- ---------------------------------------------------------------------------
-- Wildlife: authorizations and captures (rules 3 and 4); materials (rule 5); prep checks (rule 6)
-- ---------------------------------------------------------------------------

create table public.job_authorizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agreement_id uuid not null,
  signer_name text not null check (length(trim(signer_name)) > 0),
  relationship text not null check (relationship in ('owner', 'owner_agent', 'tenant_with_consent', 'property_manager')),
  signed_on date not null,
  scope text,
  file_id uuid,
  recorded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, agreement_id) references public.agreements (tenant_id, id) on delete cascade,
  foreign key (tenant_id, file_id) references public.files (tenant_id, id)
);
alter table public.job_authorizations enable row level security;
create index job_authorizations_agreement on public.job_authorizations (tenant_id, agreement_id);

create table public.wildlife_captures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  visit_id uuid not null,
  species text not null check (length(trim(species)) > 0),
  count integer not null check (count between 1 and 1000),
  disposition text not null check (disposition in ('relocated', 'released_on_site', 'euthanized', 'transferred', 'escaped', 'dead_on_arrival')),
  location text,
  notes text,
  client_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (tenant_id, visit_id) references public.visits (tenant_id, id) on delete cascade
);
alter table public.wildlife_captures enable row level security;
create index wildlife_captures_visit on public.wildlife_captures (tenant_id, visit_id);

create table public.visit_materials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  visit_id uuid not null,
  description text not null check (length(trim(description)) > 0),
  quantity numeric(12, 3) not null check (quantity > 0),
  unit text not null default 'each',
  unit_price_cents bigint not null default 0 check (unit_price_cents >= 0),
  billable boolean not null default true,
  client_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (tenant_id, visit_id) references public.visits (tenant_id, id) on delete cascade
);
alter table public.visit_materials enable row level security;
create index visit_materials_visit on public.visit_materials (tenant_id, visit_id);

create table public.prep_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  visit_id uuid not null unique,
  ready boolean not null,
  missing text[] not null default '{}',
  notes text,
  checked_by uuid default auth.uid(),
  checked_at timestamptz not null default now(),
  client_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, visit_id) references public.visits (tenant_id, id) on delete cascade,
  constraint prep_checks_not_ready check (ready or cardinality(missing) > 0 or length(trim(coalesce(notes, ''))) > 0)
);
alter table public.prep_checks enable row level security;

-- Rule 5 edge case: what the crew records at a stop closes with the visit.
create or replace function app.visit_capture_lock() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_visit uuid := case when tg_op = 'DELETE' then old.visit_id else new.visit_id end;
begin
  if exists (select 1 from public.visits v where v.id = v_visit and v.status = 'completed') then
    raise exception 'the visit is completed; what was recorded at it is closed' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger wildlife_captures_lock before insert or update or delete on public.wildlife_captures for each row execute function app.visit_capture_lock();
create trigger visit_materials_lock before insert or update or delete on public.visit_materials for each row execute function app.visit_capture_lock();
create trigger prep_checks_lock before insert or update or delete on public.prep_checks for each row execute function app.visit_capture_lock();

-- ---------------------------------------------------------------------------
-- Termite: diagram marks (rule 8) and WDI reports (rule 7)
-- ---------------------------------------------------------------------------

create table public.diagram_marks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null,
  map_id uuid not null,
  kind text not null check (kind in ('damage', 'evidence', 'treated', 'inaccessible', 'moisture', 'note')),
  x numeric(5, 4) not null check (x >= 0 and x <= 1),
  y numeric(5, 4) not null check (y >= 0 and y <= 1),
  label text not null check (length(trim(label)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (tenant_id, property_id) references public.properties (tenant_id, id) on delete cascade,
  -- A mark sits on one of its own property's maps.
  foreign key (tenant_id, property_id, map_id) references public.site_maps (tenant_id, property_id, id) on delete cascade
);
alter table public.diagram_marks enable row level security;
create index diagram_marks_map on public.diagram_marks (tenant_id, map_id);

create table public.wdi_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  visit_id uuid not null unique,
  number integer,
  requested_by text,
  buyer text,
  seller text,
  structures text,
  inspected_areas text,
  inaccessible_areas text,
  findings jsonb not null default '{}'::jsonb check (jsonb_typeof(findings) = 'object'),
  treatment_recommended boolean,
  notes text,
  inspector_id uuid references auth.users(id),
  status text not null default 'draft' check (status in ('draft', 'issued')),
  issued_at timestamptz,
  issued_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (tenant_id, visit_id) references public.visits (tenant_id, id),
  constraint wdi_reports_issued check ((status = 'issued') = (issued_at is not null and number is not null))
);
alter table public.wdi_reports enable row level security;

-- An issued report never changes or goes away; only compliance.write issues one, and it takes the next number.
create or replace function app.wdi_report_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
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
  if not exists (select 1 from public.visits v join public.service_types st on st.id = v.service_type_id
                 where v.id = new.visit_id and st.job_kind in ('inspection', 'wdi_report')) then
    raise exception 'a WDI report belongs to an inspection or WDI visit' using errcode = '23514';
  end if;
  if new.status = 'issued' and (tg_op = 'INSERT' or old.status = 'draft') then
    if auth.uid() is not null and not app.has_permission(new.tenant_id, 'compliance.write') then
      raise exception 'issuing a WDI report needs compliance.write' using errcode = '42501';
    end if;
    new.number := coalesce(new.number, app.next_number(new.tenant_id, 'wdi'));
    new.issued_at := coalesce(new.issued_at, now());
    new.issued_by := coalesce(new.issued_by, auth.uid());
  end if;
  return new;
end $$;
create trigger wdi_reports_check before insert or update or delete on public.wdi_reports for each row execute function app.wdi_report_check();

-- ---------------------------------------------------------------------------
-- Policies (rule 9), timestamps, the write guard
-- ---------------------------------------------------------------------------

create policy job_authorizations_select on public.job_authorizations for select to authenticated
  using (app.is_member(tenant_id) and (app.has_permission(tenant_id, 'customers.read') or app.has_permission(tenant_id, 'agreements.read') or app.has_permission(tenant_id, 'visits.read')));
create policy job_authorizations_write on public.job_authorizations for all to authenticated
  using (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'agreements.write') or app.has_permission(tenant_id, 'dispatch.write'))
  with check (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'agreements.write') or app.has_permission(tenant_id, 'dispatch.write'));

create policy wildlife_captures_select on public.wildlife_captures for select to authenticated
  using (app.is_member(tenant_id) and (app.has_permission(tenant_id, 'customers.read') or app.has_permission(tenant_id, 'visits.read')));
create policy wildlife_captures_write on public.wildlife_captures for all to authenticated
  using (app.has_permission(tenant_id, 'dispatch.write') or (app.has_permission(tenant_id, 'visits.write') and app.crew_on_open_visit(visit_id)))
  with check (app.has_permission(tenant_id, 'dispatch.write') or (app.has_permission(tenant_id, 'visits.write') and app.crew_on_open_visit(visit_id)));

create policy visit_materials_select on public.visit_materials for select to authenticated
  using (app.is_member(tenant_id) and (app.has_permission(tenant_id, 'customers.read') or app.has_permission(tenant_id, 'visits.read')));
create policy visit_materials_write on public.visit_materials for all to authenticated
  using (app.has_permission(tenant_id, 'dispatch.write') or (app.has_permission(tenant_id, 'visits.write') and app.crew_on_open_visit(visit_id)))
  with check (app.has_permission(tenant_id, 'dispatch.write') or (app.has_permission(tenant_id, 'visits.write') and app.crew_on_open_visit(visit_id)));

create policy prep_checks_select on public.prep_checks for select to authenticated
  using (app.is_member(tenant_id) and (app.has_permission(tenant_id, 'customers.read') or app.has_permission(tenant_id, 'visits.read')));
create policy prep_checks_write on public.prep_checks for all to authenticated
  using (app.has_permission(tenant_id, 'dispatch.write') or (app.has_permission(tenant_id, 'visits.write') and app.crew_on_open_visit(visit_id)))
  with check (app.has_permission(tenant_id, 'dispatch.write') or (app.has_permission(tenant_id, 'visits.write') and app.crew_on_open_visit(visit_id)));

create policy diagram_marks_select on public.diagram_marks for select to authenticated
  using (app.is_member(tenant_id) and (app.has_permission(tenant_id, 'customers.read') or app.has_permission(tenant_id, 'visits.read')));
create policy diagram_marks_write on public.diagram_marks for all to authenticated
  using (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write'))
  with check (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write'));

-- The inspecting crew writes the draft: policies call app.on_crew directly, so members may execute it.
grant execute on function app.on_crew(uuid) to authenticated, service_role;

create policy wdi_reports_select on public.wdi_reports for select to authenticated
  using (app.is_member(tenant_id) and (app.has_permission(tenant_id, 'customers.read') or app.has_permission(tenant_id, 'visits.read') or app.has_permission(tenant_id, 'compliance.read')));
create policy wdi_reports_write on public.wdi_reports for all to authenticated
  using (app.has_permission(tenant_id, 'compliance.write') or (app.has_permission(tenant_id, 'visits.write') and app.on_crew(visit_id)))
  with check (app.has_permission(tenant_id, 'compliance.write') or (app.has_permission(tenant_id, 'visits.write') and app.on_crew(visit_id)));

create trigger job_authorizations_updated_at before update on public.job_authorizations for each row execute function app.set_updated_at();
create trigger wildlife_captures_updated_at before update on public.wildlife_captures for each row execute function app.set_updated_at();
create trigger visit_materials_updated_at before update on public.visit_materials for each row execute function app.set_updated_at();
create trigger prep_checks_updated_at before update on public.prep_checks for each row execute function app.set_updated_at();
create trigger diagram_marks_updated_at before update on public.diagram_marks for each row execute function app.set_updated_at();
create trigger wdi_reports_updated_at before update on public.wdi_reports for each row execute function app.set_updated_at();
create trigger job_authorizations_audit after insert or update or delete on public.job_authorizations for each row execute function app.write_audit();
create trigger wdi_reports_audit after insert or update or delete on public.wdi_reports for each row execute function app.write_audit();

create trigger tenant_write_guard before insert or update or delete on public.job_authorizations for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.wildlife_captures for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.visit_materials for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.prep_checks for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.diagram_marks for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.wdi_reports for each row execute function app.guard_tenant_write();

-- ---------------------------------------------------------------------------
-- Rule 5: the materials invoice is born at completion under the technician's session, like the per-visit invoice:
-- its own source, written only by the crew of its visit (spec 08 rule 15 pattern).
-- ---------------------------------------------------------------------------

alter table public.invoices drop constraint invoices_source_check;
alter table public.invoices add constraint invoices_source_check check (source in ('visit', 'installment', 'prepay', 'settlement', 'late_fee', 'manual', 'opening', 'materials'));

drop policy invoices_insert on public.invoices;
create policy invoices_insert on public.invoices for insert to authenticated
  with check (app.has_permission(tenant_id, 'billing.write') or app.has_permission(tenant_id, 'agreements.write')
              or (source in ('visit', 'materials') and visit_id is not null and app.has_permission(tenant_id, 'visits.write')
                  and exists (select 1 from public.visit_crew c where c.visit_id = invoices.visit_id and c.user_id = auth.uid())));
drop policy invoices_update on public.invoices;
create policy invoices_update on public.invoices for update to authenticated
  using (app.has_permission(tenant_id, 'billing.write') or app.has_permission(tenant_id, 'agreements.write')
         or (source in ('visit', 'materials') and visit_id is not null and app.has_permission(tenant_id, 'visits.write')
             and exists (select 1 from public.visit_crew c where c.visit_id = invoices.visit_id and c.user_id = auth.uid())))
  with check (app.has_permission(tenant_id, 'billing.write') or app.has_permission(tenant_id, 'agreements.write')
              or (source in ('visit', 'materials') and visit_id is not null and app.has_permission(tenant_id, 'visits.write')
                  and exists (select 1 from public.visit_crew c where c.visit_id = invoices.visit_id and c.user_id = auth.uid())));

drop policy invoice_lines_insert on public.invoice_lines;
create policy invoice_lines_insert on public.invoice_lines for insert to authenticated
  with check (app.has_permission(tenant_id, 'billing.write') or app.has_permission(tenant_id, 'agreements.write')
              or (app.has_permission(tenant_id, 'visits.write')
                  and exists (select 1 from public.invoices i join public.visit_crew c on c.visit_id = i.visit_id
                              where i.id = invoice_lines.invoice_id and i.source in ('visit', 'materials') and c.user_id = auth.uid())));
drop policy invoice_lines_update on public.invoice_lines;
create policy invoice_lines_update on public.invoice_lines for update to authenticated
  using (app.has_permission(tenant_id, 'billing.write')
         or (app.has_permission(tenant_id, 'visits.write')
             and exists (select 1 from public.invoices i join public.visit_crew c on c.visit_id = i.visit_id
                         where i.id = invoice_lines.invoice_id and i.source in ('visit', 'materials') and c.user_id = auth.uid())))
  with check (app.has_permission(tenant_id, 'billing.write')
              or (app.has_permission(tenant_id, 'visits.write')
                  and exists (select 1 from public.invoices i join public.visit_crew c on c.visit_id = i.visit_id
                              where i.id = invoice_lines.invoice_id and i.source in ('visit', 'materials') and c.user_id = auth.uid())));
