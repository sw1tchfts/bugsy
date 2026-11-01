-- Spec 21: AI features. Settings and a usage log, churn risk scores, portal questions, and the customer's note on a
-- visit. AI drafts and flags; a person decides. Every tenant table has tenant_id, row level security and the guard.

-- ---------------------------------------------------------------------------
-- Settings and the usage log (rules 1 and 2)
-- ---------------------------------------------------------------------------

create table public.ai_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  enabled boolean not null default true,
  summaries boolean not null default true,
  label_reading boolean not null default true,
  portal_answers boolean not null default true,
  churn boolean not null default true,
  monthly_limit integer not null default 2000 check (monthly_limit between 0 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ai_settings enable row level security;

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature text not null check (feature in ('summary', 'label', 'portal_answer')),
  provider text not null check (provider in ('claude', 'local')),
  model text not null,
  status text not null check (status in ('ok', 'refused', 'failed', 'limited')),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  ms integer not null default 0 check (ms >= 0),
  subject_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.ai_runs enable row level security;
create index ai_runs_month on public.ai_runs (tenant_id, created_at desc);

-- Whether a feature may call the model now: AI on, the feature on, and under the month's limit (rule 2). Members and the
-- company's own portal logins ask; nobody else.
create or replace function app.ai_allowed(p_tenant uuid, p_feature text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s public.ai_settings;
  v_used integer;
begin
  if auth.uid() is not null and not app.is_member(p_tenant) and app.portal_account(p_tenant) is null then
    raise exception 'not this company' using errcode = '42501';
  end if;
  select * into s from public.ai_settings where tenant_id = p_tenant;
  if s.id is not null and not s.enabled then return 'off'; end if;
  if s.id is not null and not (case p_feature when 'summary' then s.summaries when 'label' then s.label_reading when 'portal_answer' then s.portal_answers else false end) then return 'off'; end if;
  select count(*) into v_used from public.ai_runs r
  where r.tenant_id = p_tenant and r.status <> 'limited' and r.provider = 'claude'
    and r.created_at >= date_trunc('month', now() at time zone (select timezone from public.tenants where id = p_tenant)) at time zone (select timezone from public.tenants where id = p_tenant);
  if v_used >= coalesce(s.monthly_limit, 2000) then return 'limited'; end if;
  return 'ok';
end $$;

create or replace function app.log_ai_run(p_tenant uuid, p_feature text, p_provider text, p_model text, p_status text, p_in integer, p_out integer, p_ms integer, p_subject uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not app.is_member(p_tenant) and app.portal_account(p_tenant) is null then
    raise exception 'not this company' using errcode = '42501';
  end if;
  insert into public.ai_runs (tenant_id, feature, provider, model, status, input_tokens, output_tokens, ms, subject_id)
  values (p_tenant, p_feature, p_provider, left(p_model, 60), p_status, greatest(coalesce(p_in, 0), 0), greatest(coalesce(p_out, 0), 0), greatest(coalesce(p_ms, 0), 0), p_subject);
  delete from public.ai_runs where tenant_id = p_tenant and created_at < now() - interval '400 days';
end $$;

-- ---------------------------------------------------------------------------
-- Churn risk (rule 6), written whole by the daily job
-- ---------------------------------------------------------------------------

create table public.churn_scores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agreement_id uuid not null references public.agreements(id) on delete cascade,
  account_id uuid not null,
  score integer not null check (score between 0 and 100),
  band text not null check (band in ('low', 'medium', 'high')),
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  computed_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, agreement_id),
  foreign key (tenant_id, account_id) references public.accounts (tenant_id, id) on delete cascade
);
alter table public.churn_scores enable row level security;
create index churn_scores_band on public.churn_scores (tenant_id, score desc);

-- The job's write: today's scores for the active plans, and none for plans no longer active.
create or replace function app.save_churn_scores(p_tenant uuid, p_day date, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_n integer;
begin
  if auth.uid() is not null and not (app.has_permission(p_tenant, 'billing.write') or app.has_permission(p_tenant, 'customers.write')) then
    raise exception 'scoring needs billing.write' using errcode = '42501';
  end if;
  delete from public.churn_scores c where c.tenant_id = p_tenant
    and not exists (select 1 from jsonb_array_elements(p_rows) r where (r ->> 'agreement_id')::uuid = c.agreement_id);
  insert into public.churn_scores (tenant_id, agreement_id, account_id, score, band, reasons, computed_on)
  select p_tenant, g.id, g.account_id, (r ->> 'score')::integer, r ->> 'band', r -> 'reasons', p_day
  from jsonb_array_elements(p_rows) r join public.agreements g on g.id = (r ->> 'agreement_id')::uuid and g.tenant_id = p_tenant and g.status = 'active'
  on conflict (tenant_id, agreement_id) do update set score = excluded.score, band = excluded.band, reasons = excluded.reasons, computed_on = excluded.computed_on;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Portal questions (rule 7)
-- ---------------------------------------------------------------------------

create table public.portal_questions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  account_id uuid not null,
  portal_user_id uuid not null references public.portal_users(id) on delete cascade,
  question text not null check (length(trim(question)) between 1 and 1000),
  answer text,
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  status text not null check (status in ('answered', 'waiting', 'answered_by_office')),
  office_answer text check (office_answer is null or length(trim(office_answer)) between 1 and 4000),
  answered_by uuid references auth.users(id),
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, account_id) references public.accounts (tenant_id, id) on delete cascade,
  check (status <> 'answered_by_office' or (office_answer is not null and answered_at is not null))
);
alter table public.portal_questions enable row level security;
create index portal_questions_waiting on public.portal_questions (tenant_id, status, created_at);

-- A portal login records its own question and the answer it got; at most 20 a day (rule 7).
create or replace function app.portal_ask(p_tenant uuid, p_question text, p_answer text, p_needs_office boolean, p_sources jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_account uuid := app.portal_account(p_tenant);
  v_user uuid := app.portal_user_id();
  v_id uuid;
begin
  if v_account is null or v_user is null then raise exception 'only a portal login asks' using errcode = '42501'; end if;
  if (select count(*) from public.portal_questions where portal_user_id = v_user and created_at > now() - interval '1 day') >= 20 then
    raise exception 'at most 20 questions a day; the office can help by phone' using errcode = '23514';
  end if;
  insert into public.portal_questions (tenant_id, account_id, portal_user_id, question, answer, sources, status)
  values (p_tenant, v_account, v_user, left(trim(p_question), 1000), nullif(left(p_answer, 4000), ''), coalesce(p_sources, '[]'::jsonb),
          case when p_needs_office then 'waiting' else 'answered' end)
  returning id into v_id;
  return v_id;
end $$;

-- A portal login's own plans, for the assistant's context (agreements are not readable in the portal otherwise).
create or replace function app.portal_plans(p_tenant uuid) returns table (id uuid, service text, address text, price_cents bigint, cadence text)
language sql stable security definer set search_path = public, pg_temp as $$
  select g.id, st.name, p.normalized_address, g.recurring_price_cents, g.cadence
  from public.agreements g join public.service_types st on st.id = g.service_type_id join public.properties p on p.id = g.property_id
  where g.tenant_id = p_tenant and g.status = 'active' and g.account_id = app.portal_account(p_tenant) and app.portal_property(p_tenant, g.property_id)
  order by g.number
$$;

-- ---------------------------------------------------------------------------
-- The customer's note on a visit (rule 3)
-- ---------------------------------------------------------------------------

alter table public.visit_notes drop constraint visit_notes_kind_check;
alter table public.visit_notes add constraint visit_notes_kind_check check (kind in ('note', 'recommendation', 'condition_found', 'access', 'customer_summary'));
alter table public.visit_notes add column ai_drafted boolean not null default false;

-- ---------------------------------------------------------------------------
-- Grants and row level security
-- ---------------------------------------------------------------------------

revoke all on function app.ai_allowed(uuid, text) from public;
revoke all on function app.log_ai_run(uuid, text, text, text, text, integer, integer, integer, uuid) from public;
revoke all on function app.save_churn_scores(uuid, date, jsonb) from public;
revoke all on function app.portal_ask(uuid, text, text, boolean, jsonb) from public;
revoke all on function app.portal_plans(uuid) from public;
grant execute on function app.ai_allowed(uuid, text), app.log_ai_run(uuid, text, text, text, text, integer, integer, integer, uuid), app.save_churn_scores(uuid, date, jsonb),
  app.portal_ask(uuid, text, text, boolean, jsonb), app.portal_plans(uuid) to authenticated;

create policy ai_settings_select on public.ai_settings for select to authenticated using (app.is_member(tenant_id));
create policy ai_settings_write on public.ai_settings for all to authenticated
  using (app.has_permission(tenant_id, 'settings.write')) with check (app.has_permission(tenant_id, 'settings.write'));
create policy ai_runs_select on public.ai_runs for select to authenticated using (app.has_permission(tenant_id, 'settings.read'));
create policy churn_scores_select on public.churn_scores for select to authenticated using (app.has_permission(tenant_id, 'customers.read'));
create policy portal_questions_select on public.portal_questions for select to authenticated
  using (app.has_permission(tenant_id, 'customers.read') or ((select app.portal_user_id()) is not null and account_id = app.portal_account(tenant_id)));
create policy portal_questions_update on public.portal_questions for update to authenticated
  using (app.has_permission(tenant_id, 'customers.write')) with check (app.has_permission(tenant_id, 'customers.write'));

create trigger ai_settings_updated_at before update on public.ai_settings for each row execute function app.set_updated_at();
create trigger churn_scores_updated_at before update on public.churn_scores for each row execute function app.set_updated_at();
create trigger portal_questions_updated_at before update on public.portal_questions for each row execute function app.set_updated_at();
create trigger ai_settings_audit after insert or update or delete on public.ai_settings for each row execute function app.write_audit();

create trigger tenant_write_guard before insert or update or delete on public.ai_settings for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.ai_runs for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.churn_scores for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.portal_questions for each row execute function app.guard_tenant_write();
