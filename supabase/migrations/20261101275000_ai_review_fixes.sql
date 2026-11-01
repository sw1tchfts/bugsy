-- Spec 21 review fixes: a portal login reads only its own questions; the monthly AI limit and the 20-a-day portal
-- limit are taken atomically (a reservation under a lock, the model called outside the transaction); one month start
-- in the company's time zone for the limit and the usage shown.

drop policy portal_questions_select on public.portal_questions;
create policy portal_questions_select on public.portal_questions for select to authenticated
  using (app.has_permission(tenant_id, 'customers.read') or ((select app.portal_user_id()) is not null and portal_user_id = (select app.portal_user_id())));

alter table public.ai_runs drop constraint ai_runs_status_check;
alter table public.ai_runs add constraint ai_runs_status_check check (status in ('pending', 'ok', 'refused', 'failed', 'limited'));

-- The start of the company's month, as an instant: the limit and the usage page count from the same moment.
create or replace function app.ai_month_start(p_tenant uuid) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select date_trunc('month', now() at time zone t.timezone) at time zone t.timezone from public.tenants t where t.id = p_tenant
$$;

-- Rule 2: a call's place in the month, taken under a lock per company so parallel calls cannot all slip under the
-- limit. 'disabled' (AI off for the company) and 'off' (this feature off) reserve nothing.
create or replace function app.ai_reserve(p_tenant uuid, p_feature text, p_provider text, p_subject uuid) returns table (run_id uuid, allowed text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.ai_settings;
  v_used integer;
  v_id uuid;
begin
  if auth.uid() is not null and not app.is_member(p_tenant) and app.portal_account(p_tenant) is null then
    raise exception 'not this company' using errcode = '42501';
  end if;
  select * into s from public.ai_settings where tenant_id = p_tenant;
  if s.id is not null and not (case p_feature when 'summary' then s.summaries when 'label' then s.label_reading when 'portal_answer' then s.portal_answers else false end) then
    return query select null::uuid, 'off'::text;
    return;
  end if;
  if s.id is not null and not s.enabled and p_provider <> 'local' then
    return query select null::uuid, 'disabled'::text;
    return;
  end if;
  if p_provider = 'claude' then
    perform pg_advisory_xact_lock(hashtext('ai:' || p_tenant::text));
    select count(*) into v_used from public.ai_runs r
    where r.tenant_id = p_tenant and r.provider = 'claude' and r.status <> 'limited' and r.created_at >= app.ai_month_start(p_tenant);
    if v_used >= coalesce(s.monthly_limit, 2000) then
      insert into public.ai_runs (tenant_id, feature, provider, model, status, subject_id) values (p_tenant, p_feature, 'claude', 'none', 'limited', p_subject) returning id into v_id;
      return query select v_id, 'limited'::text;
      return;
    end if;
  end if;
  insert into public.ai_runs (tenant_id, feature, provider, model, status, subject_id) values (p_tenant, p_feature, p_provider, p_provider, 'pending', p_subject) returning id into v_id;
  return query select v_id, 'ok'::text;
end $$;

create or replace function app.ai_finish(p_run uuid, p_model text, p_status text, p_in integer, p_out integer, p_ms integer) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.ai_runs;
begin
  select * into r from public.ai_runs where id = p_run and status = 'pending';
  if r.id is null then return; end if;
  if auth.uid() is not null and not app.is_member(r.tenant_id) and app.portal_account(r.tenant_id) is null then
    raise exception 'not this company' using errcode = '42501';
  end if;
  update public.ai_runs set model = left(p_model, 60), status = p_status, input_tokens = greatest(coalesce(p_in, 0), 0), output_tokens = greatest(coalesce(p_out, 0), 0),
    ms = greatest(coalesce(p_ms, 0), 0) where id = p_run;
end $$;

-- Rule 7: the question takes its place in the login's day under a lock (at most 20), before the model is asked; the
-- answer is written after, in its own step.
create or replace function app.portal_ask_begin(p_tenant uuid, p_question text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_account uuid := app.portal_account(p_tenant);
  v_user uuid := app.portal_user_id();
  v_id uuid;
begin
  if v_account is null or v_user is null then raise exception 'only a portal login asks' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('ask:' || v_user::text));
  if (select count(*) from public.portal_questions where portal_user_id = v_user and created_at > now() - interval '1 day') >= 20 then
    raise exception 'at most 20 questions a day; the office can help by phone' using errcode = '23514';
  end if;
  insert into public.portal_questions (tenant_id, account_id, portal_user_id, question, status)
  values (p_tenant, v_account, v_user, left(trim(p_question), 1000), 'waiting') returning id into v_id;
  return v_id;
end $$;

create or replace function app.portal_ask_finish(p_question uuid, p_answer text, p_needs_office boolean, p_sources jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.portal_questions set answer = nullif(left(p_answer, 4000), ''), sources = coalesce(p_sources, '[]'::jsonb),
    status = case when p_needs_office then 'waiting' else 'answered' end
  where id = p_question and portal_user_id = app.portal_user_id() and answer is null and status = 'waiting';
end $$;

revoke all on function app.ai_month_start(uuid) from public;
revoke all on function app.ai_reserve(uuid, text, text, uuid) from public;
revoke all on function app.ai_finish(uuid, text, text, integer, integer, integer) from public;
revoke all on function app.portal_ask_begin(uuid, text) from public;
revoke all on function app.portal_ask_finish(uuid, text, boolean, jsonb) from public;
grant execute on function app.ai_month_start(uuid), app.ai_reserve(uuid, text, text, uuid), app.ai_finish(uuid, text, text, integer, integer, integer),
  app.portal_ask_begin(uuid, text), app.portal_ask_finish(uuid, text, boolean, jsonb) to authenticated;
