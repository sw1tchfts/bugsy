-- Spec 11 review fixes.
-- 1. A sent notice keeps its proof (spec 07): a delivery receipt after the notice was marked sent no longer tries to
--    rewrite it (which raised and failed the webhook and the run), and a manual proof recorded first is left alone.
-- 2. A failure reported after a notice was marked sent leaves the proof as it is and opens a compliance task to reach
--    the person another way.
-- 3. Automations queue only for the caller's own stop: without dispatch (or compliance for a notice), the caller must
--    be on the visit's crew, and the address must belong to a contact of the visit's account or property.

alter table public.compliance_tasks drop constraint compliance_tasks_kind_check;
alter table public.compliance_tasks add constraint compliance_tasks_kind_check
  check (kind in ('credential_expiring', 'license_expiring', 'record_incomplete', 'notice_overdue', 'registry_notice_due', 'notice_undelivered'));

-- True when the address is one of the visit's people: a contact of its account or its property, by email or phone.
create or replace function app.visit_contact_address(p_tenant uuid, p_visit uuid, p_channel text, p_to text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.visits v join public.contacts c on c.tenant_id = v.tenant_id and (c.account_id = v.account_id or c.property_id = v.property_id)
    where v.id = p_visit and v.tenant_id = p_tenant and c.archived_at is null
      and case p_channel
            when 'email' then lower(c.email) = lower(p_to)
            when 'sms' then c.phone_digits = right(regexp_replace(coalesce(p_to, ''), '\D', '', 'g'), 10)
            else false end)
$$;
revoke all on function app.visit_contact_address(uuid, uuid, text, text) from public;

-- True when the signed-in member is on the visit's crew.
create or replace function app.on_crew(p_visit uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.visit_crew c where c.visit_id = p_visit and c.user_id = auth.uid())
$$;
revoke all on function app.on_crew(uuid) from public;

create or replace function app.queue_message(p_tenant uuid, p_message jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_purpose text := p_message->>'purpose';
  v_channel text := p_message->>'channel';
  v_to text := p_message->>'to_address';
  v_visit uuid := nullif(p_message->>'visit_id', '')::uuid;
  v_invoice uuid := nullif(p_message->>'invoice_id', '')::uuid;
  v_notice uuid := nullif(p_message->>'notice_id', '')::uuid;
  v_campaign uuid := nullif(p_message->>'campaign_id', '')::uuid;
  v_key text := nullif(p_message->>'dedupe_key', '');
  v_notice_visit uuid;
  v_invoice_visit uuid;
  v_ok boolean;
  v_id uuid;
begin
  if auth.uid() is not null then
    if not app.is_member(p_tenant) then raise exception 'not a member of this company' using errcode = '42501'; end if;
    if v_notice is not null then select n.visit_id into v_notice_visit from public.notices n where n.id = v_notice and n.tenant_id = p_tenant; end if;
    if v_invoice is not null then select i.visit_id into v_invoice_visit from public.invoices i where i.id = v_invoice and i.tenant_id = p_tenant; end if;
    v_ok := app.has_permission(p_tenant, 'messages.send') or case v_purpose
      when 'on_the_way' then exists (select 1 from public.visits v where v.id = v_visit and v.tenant_id = p_tenant)
                             and (app.has_permission(p_tenant, 'dispatch.write')
                                  or (app.has_permission(p_tenant, 'visits.write') and app.on_crew(v_visit) and app.visit_contact_address(p_tenant, v_visit, v_channel, v_to)))
      when 'summary' then exists (select 1 from public.visits v where v.id = v_visit and v.tenant_id = p_tenant)
                          and (app.has_permission(p_tenant, 'dispatch.write')
                               or (app.has_permission(p_tenant, 'visits.write') and app.on_crew(v_visit) and app.visit_contact_address(p_tenant, v_visit, v_channel, v_to)))
      when 'review' then exists (select 1 from public.visits v where v.id = v_visit and v.tenant_id = p_tenant)
                         and (app.has_permission(p_tenant, 'dispatch.write')
                              or (app.has_permission(p_tenant, 'visits.write') and app.on_crew(v_visit) and app.visit_contact_address(p_tenant, v_visit, v_channel, v_to)))
      when 'reminder' then exists (select 1 from public.visits v where v.id = v_visit and v.tenant_id = p_tenant) and app.has_permission(p_tenant, 'dispatch.write')
      when 'invoice' then exists (select 1 from public.invoices i where i.id = v_invoice and i.tenant_id = p_tenant)
                          and (app.has_permission(p_tenant, 'billing.write')
                               or (v_invoice_visit is not null and app.on_crew(v_invoice_visit) and app.visit_contact_address(p_tenant, v_invoice_visit, v_channel, v_to)))
      when 'notice' then exists (select 1 from public.notices n where n.id = v_notice and n.tenant_id = p_tenant)
                         and (app.has_permission(p_tenant, 'compliance.write') or app.has_permission(p_tenant, 'dispatch.write')
                              or (v_notice_visit is not null and app.has_permission(p_tenant, 'visits.write') and app.on_crew(v_notice_visit)
                                  and app.visit_contact_address(p_tenant, v_notice_visit, v_channel, v_to)))
      when 'campaign' then exists (select 1 from public.campaigns c where c.id = v_campaign and c.tenant_id = p_tenant) and app.has_permission(p_tenant, 'messages.manage')
      else false end;
    -- A summary that carries a notice must be for that notice's visit.
    if v_ok and v_notice is not null and v_purpose = 'summary' and v_notice_visit is distinct from v_visit then v_ok := false; end if;
    if not coalesce(v_ok, false) then raise exception 'sending a % message needs messages.send', v_purpose using errcode = '42501'; end if;
  end if;
  if v_key is not null then
    select id into v_id from public.messages where tenant_id = p_tenant and dedupe_key = v_key;
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.messages (tenant_id, direction, channel, purpose, account_id, property_id, contact_id, visit_id, notice_id, invoice_id, campaign_id,
                               to_address, from_address, recipient_name, subject, body, body_html, status, suppressed_reason, segments, dedupe_key, send_after, token)
  values (p_tenant, 'outbound', v_channel, v_purpose, nullif(p_message->>'account_id', '')::uuid, nullif(p_message->>'property_id', '')::uuid,
          nullif(p_message->>'contact_id', '')::uuid, v_visit, v_notice, v_invoice, v_campaign,
          v_to, nullif(p_message->>'from_address', ''), nullif(p_message->>'recipient_name', ''), nullif(p_message->>'subject', ''),
          p_message->>'body', nullif(p_message->>'body_html', ''), coalesce(nullif(p_message->>'status', ''), 'queued'), nullif(p_message->>'suppressed_reason', ''),
          nullif(p_message->>'segments', '')::integer, v_key, coalesce(nullif(p_message->>'send_after', '')::timestamptz, now()),
          coalesce(nullif(p_message->>'token', ''), replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')))
  on conflict (tenant_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  if v_id is null then select id into v_id from public.messages where tenant_id = p_tenant and dedupe_key = v_key; end if;
  return v_id;
end $$;
revoke all on function app.queue_message(uuid, jsonb) from public;
grant execute on function app.queue_message(uuid, jsonb) to authenticated, service_role;

create or replace function app.record_message_status(p_tenant uuid, p_message uuid, p_status text, p_provider text, p_provider_id text, p_error text, p_segments integer default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m record;
  n record;
  v_today date;
begin
  if auth.uid() is not null and not app.is_member(p_tenant) then raise exception 'not a member of this company' using errcode = '42501'; end if;
  select * into m from public.messages where id = p_message and tenant_id = p_tenant for update;
  if m.id is null then raise exception 'message not found' using errcode = '23514'; end if;
  if m.status = p_status or (m.status = 'delivered' and p_status = 'sent') or m.status in ('suppressed', 'received') then return; end if;
  update public.messages set
    status = p_status,
    provider = coalesce(p_provider, provider),
    provider_message_id = coalesce(p_provider_id, provider_message_id),
    error = case when p_status = 'failed' then coalesce(p_error, error) else error end,
    suppressed_reason = case when p_status = 'suppressed' then coalesce(p_error, 'suppressed') else suppressed_reason end,
    segments = coalesce(p_segments, segments),
    sent_at = case when p_status in ('sent', 'delivered') then coalesce(sent_at, now()) else sent_at end,
    delivered_at = case when p_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
    failed_at = case when p_status = 'failed' then coalesce(failed_at, now()) else failed_at end
  where id = p_message;
  if m.notice_id is null then return; end if;
  select id, status, kind, recipient_name, proof into n from public.notices where id = m.notice_id and tenant_id = p_tenant;
  if n.id is null then return; end if;
  if p_status in ('sent', 'delivered') and n.status in ('due', 'failed') then
    -- The first word that it went out is the proof; the message row keeps its later delivery.
    update public.notices set status = 'sent', sent_at = coalesce(sent_at, now()),
      proof = jsonb_build_object('method', m.channel, 'message_id', m.id, 'provider', coalesce(p_provider, m.provider), 'provider_message_id', coalesce(p_provider_id, m.provider_message_id),
                                 'to', m.to_address, 'sent_at', coalesce(m.sent_at, now()), 'delivered_at', case when p_status = 'delivered' then now() else null end)
    where id = n.id;
  elsif p_status in ('failed', 'suppressed') and n.status = 'due' then
    update public.notices set status = 'failed', proof = proof || jsonb_build_object('failed_message_id', m.id, 'error', coalesce(p_error, 'not sent'))
    where id = n.id;
  elsif p_status = 'failed' and n.status = 'sent' and n.proof->>'message_id' = m.id::text then
    -- Bounced or undelivered after the hand-off: the proof stands as sent, and a person reaches them another way.
    select (now() at time zone t.timezone)::date into v_today from public.tenants t where t.id = p_tenant;
    insert into public.compliance_tasks (tenant_id, kind, subject_table, subject_id, due_on, title)
    values (p_tenant, 'notice_undelivered', 'notices', n.id, v_today,
            format('%s to %s was sent but not delivered (%s); reach them another way', replace(n.kind, '_', ' '), n.recipient_name, coalesce(p_error, 'no reason given')))
    on conflict (tenant_id, kind, subject_id, due_on) do nothing;
  end if;
end $$;
revoke all on function app.record_message_status(uuid, uuid, text, text, text, text, integer) from public;
grant execute on function app.record_message_status(uuid, uuid, text, text, text, text, integer) to authenticated, service_role;
