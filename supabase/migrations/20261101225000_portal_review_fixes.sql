-- Spec 16 review fixes. An invitation is accepted only by its address, proven by the auth provider (a confirmed email),
-- and its link is never shown to staff; the office cannot activate or re-point an identity; customers see only
-- notices sent to them and payments on invoices they can see; the booking form's limits hold under parallel requests
-- and its refusals are logged; requests follow the office's on or off switch.

-- ---------------------------------------------------------------------------
-- Rule 1: the link is the customer's alone. Members read every column but the token.
-- ---------------------------------------------------------------------------

revoke select on public.portal_users from authenticated;
grant select (id, tenant_id, account_id, contact_id, email, user_id, property_ids, status, invited_by, invited_at, accepted_at, last_seen_at, created_at, updated_at)
  on public.portal_users to authenticated;

-- The office invites and turns access off or back on; only the invited person, signed in with that confirmed address,
-- accepts. Jobs and the seed (no user) are not checked.
create or replace function app.portal_users_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp, auth as $$
declare
  v_email text;
  v_confirmed timestamptz;
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'invited' or new.user_id is not null or new.accepted_at is not null then
      raise exception 'an invitation starts as invited; only the customer accepts it' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.tenant_id is distinct from old.tenant_id or new.account_id is distinct from old.account_id or new.email is distinct from old.email or new.token is distinct from old.token then
    raise exception 'an invitation keeps its account, address and link' using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id or new.accepted_at is distinct from old.accepted_at then
    select lower(u.email), u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = auth.uid();
    if old.user_id is not null or new.user_id is distinct from auth.uid() or v_email is null or v_email <> old.email or v_confirmed is null then
      raise exception 'only the invited person accepts an invitation' using errcode = '42501';
    end if;
  end if;
  if new.status is distinct from old.status then
    if not (
      new.status = 'disabled'
      or (old.status = 'disabled' and new.status = case when old.user_id is null then 'invited' else 'active' end)
      or (old.status = 'invited' and new.status = 'active' and new.user_id = auth.uid())
    ) then
      raise exception 'a portal user is invited, active or disabled; only acceptance makes one active' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger portal_users_guard before insert or update on public.portal_users for each row execute function app.portal_users_guard();

create or replace function app.accept_portal_invitation(p_token uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp, auth as $$
declare
  v_row public.portal_users;
  v_email text;
  v_confirmed timestamptz;
begin
  if auth.uid() is null then raise exception 'sign in to accept' using errcode = '42501'; end if;
  select lower(email), email_confirmed_at into v_email, v_confirmed from auth.users where id = auth.uid();
  select * into v_row from public.portal_users where token = p_token for update;
  if v_row.id is null or v_row.status = 'disabled' then raise exception 'this invitation is no longer valid' using errcode = '23514'; end if;
  if v_email is null or v_row.email is distinct from v_email then raise exception 'this invitation was sent to another address' using errcode = '42501'; end if;
  if v_confirmed is null then raise exception 'confirm your email address first, from the message we sent' using errcode = '42501'; end if;
  if v_row.status = 'active' then
    if v_row.user_id <> auth.uid() then raise exception 'this invitation was already used' using errcode = '23514'; end if;
    return v_row.id;
  end if;
  update public.portal_users set user_id = auth.uid(), status = 'active', accepted_at = now() where id = v_row.id;
  return v_row.id;
end $$;

-- The chooser carries the company's status: a suspended or archived company is read only in the portal too.
drop function app.portal_identities();
create function app.portal_identities() returns table (id uuid, tenant_id uuid, tenant_name text, tenant_timezone text, tenant_status text, account_id uuid, account_name text, property_ids uuid[])
language sql stable security definer set search_path = public, pg_temp as $$
  select pu.id, pu.tenant_id, t.name, t.timezone, t.status, pu.account_id, a.name, pu.property_ids
  from public.portal_users pu join public.tenants t on t.id = pu.tenant_id join public.accounts a on a.id = pu.account_id
  where pu.user_id = auth.uid() and pu.status = 'active' and t.status <> 'archived'
  order by t.name, a.name
$$;
revoke all on function app.portal_identities() from public;
grant execute on function app.portal_identities() to authenticated;

-- ---------------------------------------------------------------------------
-- Rule 2: notices sent to the customer's own people (or posted at the property), never a neighbor's registry notice;
-- payments only on invoices the identity can see; animals caught at its visits for the binder.
-- ---------------------------------------------------------------------------

create or replace function app.portal_contact(p_contact uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.contacts c where c.id = p_contact and c.account_id = app.portal_account(c.tenant_id))
$$;
revoke all on function app.portal_contact(uuid) from public;
grant execute on function app.portal_contact(uuid) to authenticated;

drop policy notices_portal on public.notices;
create policy notices_portal on public.notices for select to authenticated
  using ((select app.portal_user_id()) is not null and kind <> 'registry_advance' and app.portal_property(tenant_id, property_id)
         and (app.portal_contact(recipient_contact_id) or (recipient_contact_id is null and channel = 'posted')));

-- A payment is visible when it is the account's and every invoice it paid is one the identity can see. The check reads
-- only the allocations, so a payment inserted in the same statement (no allocations yet) passes its own RETURNING.
create or replace function app.portal_payment_hidden(p_payment uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.payment_allocations a join public.invoices i on i.id = a.invoice_id
                 where a.payment_id = p_payment and i.property_id is not null and not app.portal_property(i.tenant_id, i.property_id))
$$;
revoke all on function app.portal_payment_hidden(uuid) from public;
grant execute on function app.portal_payment_hidden(uuid) to authenticated;

drop policy payments_portal on public.payments;
create policy payments_portal on public.payments for select to authenticated
  using ((select app.portal_user_id()) is not null and account_id = app.portal_account(tenant_id) and not app.portal_payment_hidden(id));
drop policy payment_allocations_portal on public.payment_allocations;
create policy payment_allocations_portal on public.payment_allocations for select to authenticated
  using ((select app.portal_user_id()) is not null
         and exists (select 1 from public.payments p where p.id = payment_id and p.account_id = app.portal_account(p.tenant_id))
         and not app.portal_payment_hidden(payment_id));
drop policy payment_allocations_portal_insert on public.payment_allocations;
create policy payment_allocations_portal_insert on public.payment_allocations for insert to authenticated
  with check ((select app.portal_user_id()) is not null
              and exists (select 1 from public.payments p where p.id = payment_id and p.account_id = app.portal_account(p.tenant_id) and p.recorded_by is null)
              and exists (select 1 from public.invoices i where i.id = invoice_id and i.account_id = app.portal_account(i.tenant_id)
                          and (i.property_id is null or app.portal_property(i.tenant_id, i.property_id))));

create policy wildlife_captures_portal on public.wildlife_captures for select to authenticated using ((select app.portal_user_id()) is not null and app.portal_visit(visit_id));

-- ---------------------------------------------------------------------------
-- Rule 4: requests only while the company takes them (on until the office turns them off).
-- ---------------------------------------------------------------------------

drop policy service_requests_insert on public.service_requests;
create policy service_requests_insert on public.service_requests for insert to authenticated
  with check (app.has_permission(tenant_id, 'customers.write') or app.has_permission(tenant_id, 'dispatch.write')
              or ((select app.portal_user_id()) is not null and portal_user_id = app.portal_user_id() and account_id = app.portal_account(tenant_id)
                  and app.portal_property(tenant_id, property_id) and status = 'open' and handled_by is null and result_visit_id is null
                  and coalesce((select s.allow_requests from public.portal_settings s where s.tenant_id = service_requests.tenant_id), true)));

-- ---------------------------------------------------------------------------
-- Rule 8: the booking form's intake. One address gets 5 submissions an hour across every form, one form 200 a day;
-- parallel requests wait their turn; every refusal is logged; the answer says what happened instead of raising.
-- ---------------------------------------------------------------------------

drop function app.intake_lead(uuid, jsonb, text);
create function app.intake_lead(p_key uuid, p_payload jsonb, p_ip_hash text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f public.lead_forms;
  v_status text;
  v_source uuid;
  v_lead uuid;
  v_service_raw text := nullif(p_payload ->> 'service_type_id', '');
  v_service uuid;
  v_state text := upper(nullif(trim(p_payload ->> 'state_code'), ''));
  v_window text := coalesce(nullif(p_payload ->> 'arrival_window', ''), 'any');
  v_date_raw text := nullif(p_payload ->> 'preferred_date', '');
  v_date date;
  v_problem text;
begin
  if coalesce(length(p_ip_hash), 0) < 8 then return jsonb_build_object('ok', false, 'status', 400, 'error', 'missing client fingerprint'); end if;
  select * into f from public.lead_forms where key = p_key and active;
  if f.id is null then return jsonb_build_object('ok', false, 'status', 404, 'error', 'this form is not taking requests'); end if;
  select status into v_status from public.tenants where id = f.tenant_id;
  if v_status <> 'active' then return jsonb_build_object('ok', false, 'status', 404, 'error', 'this form is not taking requests'); end if;
  -- One at a time per address and per form, so the counts below are the truth.
  perform pg_advisory_xact_lock(hashtext('intake-ip:' || p_ip_hash));
  perform 1 from public.lead_forms where id = f.id for update;
  if (select count(*) from public.intake_log l where l.ip_hash = p_ip_hash and l.created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.intake_log l where l.form_id = f.id and l.created_at > now() - interval '1 day') >= 200 then
    insert into public.intake_log (tenant_id, form_id, ip_hash, result) values (f.tenant_id, f.id, p_ip_hash, 'limited');
    return jsonb_build_object('ok', false, 'status', 429, 'error', 'too many requests; try again later');
  end if;
  if length(trim(coalesce(p_payload ->> 'name', ''))) = 0
     or (length(trim(coalesce(p_payload ->> 'email', ''))) = 0 and length(trim(coalesce(p_payload ->> 'phone', ''))) = 0)
     or length(trim(coalesce(p_payload ->> 'line1', ''))) = 0 then
    v_problem := 'a name, an email or phone, and an address are needed';
  elsif v_service_raw is not null and v_service_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_problem := 'pick a service from the list';
  elsif v_state is not null and v_state !~ '^[A-Z]{2}$' then
    v_problem := 'the state is its two-letter code';
  end if;
  if v_problem is null then
    v_service := v_service_raw::uuid;
    if (v_service is not null and not (v_service = any(f.service_type_ids))) or (v_service is null and cardinality(f.service_type_ids) > 0) then
      v_problem := 'pick a service from the list';
    end if;
  end if;
  if v_problem is null and f.ask_preferred_date and v_date_raw is not null then
    begin
      if v_date_raw !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'bad date'; end if;
      v_date := v_date_raw::date;
    exception when others then
      v_problem := 'pick a real preferred day';
    end;
  end if;
  if v_problem is not null then
    insert into public.intake_log (tenant_id, form_id, ip_hash, result) values (f.tenant_id, f.id, p_ip_hash, 'refused');
    return jsonb_build_object('ok', false, 'status', 422, 'error', v_problem);
  end if;
  if v_window not in ('any', 'morning', 'afternoon', 'evening') then v_window := 'any'; end if;
  select id into v_source from public.lead_sources where tenant_id = f.tenant_id and key = 'website_form';
  if v_source is null then
    insert into public.lead_sources (tenant_id, key, name) values (f.tenant_id, 'website_form', 'Website form') returning id into v_source;
  end if;
  insert into public.leads (tenant_id, source_id, name, email, phone, line1, city, state_code, postal_code, notes, service_type_id, preferred_date, arrival_window, form_id, sms_consent)
  values (f.tenant_id, v_source, left(trim(p_payload ->> 'name'), 200), nullif(lower(trim(p_payload ->> 'email')), ''), nullif(trim(p_payload ->> 'phone'), ''),
          left(trim(p_payload ->> 'line1'), 200), nullif(left(trim(p_payload ->> 'city'), 100), ''), v_state, nullif(left(trim(p_payload ->> 'postal_code'), 10), ''),
          nullif(left(trim(p_payload ->> 'message'), 2000), ''), v_service, v_date, v_window, f.id, coalesce(p_payload ->> 'sms_consent', '') in ('true', 't', 'on', '1'))
  returning id into v_lead;
  insert into public.intake_log (tenant_id, form_id, ip_hash, result, lead_id) values (f.tenant_id, f.id, p_ip_hash, 'accepted', v_lead);
  return jsonb_build_object('ok', true, 'status', 201, 'lead_id', v_lead);
end $$;
revoke all on function app.intake_lead(uuid, jsonb, text) from public;
grant execute on function app.intake_lead(uuid, jsonb, text) to anon, authenticated;

-- The audit trail keeps every change to an invitation but never its link.
create or replace function app.write_audit_portal_users() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.audit_log (tenant_id, actor_id, table_name, row_id, action, before, after)
  values (coalesce(new.tenant_id, old.tenant_id), auth.uid(), tg_table_name, coalesce(new.id, old.id), lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) - 'token' end,
          case when tg_op <> 'DELETE' then to_jsonb(new) - 'token' end);
  return coalesce(new, old);
end $$;
drop trigger portal_users_audit on public.portal_users;
create trigger portal_users_audit after insert or update or delete on public.portal_users for each row execute function app.write_audit_portal_users();
update public.audit_log set before = before - 'token', after = after - 'token' where table_name = 'portal_users';
