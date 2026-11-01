-- Spec 11: customer messaging. One messages table is the outbox, the account timeline and the proof for notices. Writes
-- go through app.queue_message and app.record_message_status, which check the event's row is in the company and keep
-- a sent message as it was sent; consent is checked when a message is sent.

-- Messages reference invoices by company as everything else does.
alter table public.invoices add constraint invoices_tenant_id_id_key unique (tenant_id, id);

create table public.messaging_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  sender_name text,
  reply_to_email text check (reply_to_email is null or reply_to_email = lower(reply_to_email)),
  company_phone text,
  sms_number text check (sms_number is null or sms_number ~ '^\+[1-9][0-9]{7,14}$'),
  sms_registration text not null default 'none' check (sms_registration in ('none', 'pending', 'approved')),
  quiet_start time not null default '08:00',
  quiet_end time not null default '21:00',
  reminders_enabled boolean not null default true,
  reminder_days integer not null default 1 check (reminder_days between 0 and 14),
  on_the_way_enabled boolean not null default true,
  summary_enabled boolean not null default true,
  review_enabled boolean not null default false,
  review_url text,
  review_delay_hours integer not null default 2 check (review_delay_hours between 0 and 168),
  review_every_days integer not null default 180 check (review_every_days between 1 and 3650),
  invoice_email_enabled boolean not null default true,
  email_provider text not null default 'local' check (email_provider in ('local', 'postmark')),
  sms_provider text not null default 'local' check (sms_provider in ('local', 'twilio')),
  mail_provider text not null default 'local' check (mail_provider in ('local', 'lob')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint messaging_review_url check (not review_enabled or (review_url is not null and review_url ~ '^https?://'))
);
alter table public.messaging_settings enable row level security;
create trigger messaging_settings_updated_at before update on public.messaging_settings for each row execute function app.set_updated_at();
create unique index messaging_settings_sms_number on public.messaging_settings (sms_number) where sms_number is not null;

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  channel text not null check (channel in ('email', 'sms', 'mail')),
  subject text,
  body text not null check (length(trim(body)) > 0),
  updated_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key, channel)
);
alter table public.message_templates enable row level security;
create trigger message_templates_updated_at before update on public.message_templates for each row execute function app.set_updated_at();

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  channel text not null check (channel in ('email', 'sms')),
  subject text,
  body text not null check (length(trim(body)) > 0),
  audience jsonb not null default '{}'::jsonb check (jsonb_typeof(audience) = 'object'),
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  scheduled_for timestamptz,
  counts jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) default auth.uid(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
alter table public.campaigns enable row level security;
create trigger campaigns_updated_at before update on public.campaigns for each row execute function app.set_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  direction text not null check (direction in ('outbound', 'inbound')),
  channel text not null check (channel in ('email', 'sms', 'mail')),
  purpose text not null check (purpose in ('reminder', 'on_the_way', 'summary', 'review', 'invoice', 'notice', 'campaign', 'reply', 'keyword', 'inbound', 'other')),
  account_id uuid,
  property_id uuid,
  contact_id uuid references public.contacts(id) on delete set null,
  visit_id uuid,
  notice_id uuid references public.notices(id) on delete restrict,
  invoice_id uuid,
  campaign_id uuid,
  to_address text not null,
  from_address text,
  recipient_name text,
  subject text,
  body text not null,
  body_html text,
  status text not null check (status in ('queued', 'sent', 'delivered', 'failed', 'suppressed', 'received')),
  suppressed_reason text,
  provider text,
  provider_message_id text,
  error text,
  segments integer,
  dedupe_key text,
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  send_after timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  read_at timestamptz,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, account_id) references public.accounts (tenant_id, id) on delete restrict,
  foreign key (tenant_id, property_id) references public.properties (tenant_id, id) on delete restrict,
  foreign key (tenant_id, visit_id) references public.visits (tenant_id, id) on delete restrict,
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id) on delete restrict,
  foreign key (tenant_id, campaign_id) references public.campaigns (tenant_id, id) on delete restrict,
  constraint messages_direction_status check ((direction = 'inbound') = (status = 'received')),
  constraint messages_suppressed_reason check (status <> 'suppressed' or suppressed_reason is not null)
);
alter table public.messages enable row level security;
create unique index messages_dedupe on public.messages (tenant_id, dedupe_key) where dedupe_key is not null;
create unique index messages_provider_id on public.messages (provider, provider_message_id) where provider_message_id is not null;
create index messages_account on public.messages (tenant_id, account_id, created_at desc);
create index messages_queue on public.messages (tenant_id, status, send_after) where status = 'queued';
create index messages_inbox on public.messages (tenant_id, created_at desc) where direction = 'inbound' and read_at is null;
create trigger messages_updated_at before update on public.messages for each row execute function app.set_updated_at();

create table public.message_opt_outs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel text not null check (channel in ('sms', 'email')),
  address text not null,
  reason text not null check (reason in ('stop', 'unsubscribe', 'bounce', 'complaint', 'manual')),
  message_id uuid references public.messages(id) on delete set null,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (tenant_id, channel, address)
);
alter table public.message_opt_outs enable row level security;

-- A message is kept as it was sent: only the delivery fields move, forward (rule 1).
create or replace function app.protect_message() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then raise exception 'messages are never deleted' using errcode = '23514'; end if;
  if old.status <> 'queued' and (new.body <> old.body or new.subject is distinct from old.subject or new.body_html is distinct from old.body_html or new.to_address <> old.to_address or new.channel <> old.channel) then
    raise exception 'a sent message keeps what it said and to whom' using errcode = '23514';
  end if;
  if new.tenant_id <> old.tenant_id or new.direction <> old.direction or new.token <> old.token then
    raise exception 'a message keeps its company, direction and link' using errcode = '23514';
  end if;
  if new.status <> old.status and not (
    (old.status = 'queued' and new.status in ('sent', 'delivered', 'failed', 'suppressed'))
    or (old.status = 'sent' and new.status in ('delivered', 'failed'))
    or (old.status = 'delivered' and new.status = 'failed')
  ) then
    raise exception 'a message cannot move from % to %', old.status, new.status using errcode = '23514';
  end if;
  return new;
end $$;
create trigger messages_protect before update or delete on public.messages for each row execute function app.protect_message();

-- The company's settings exist for any member who needs them.
create or replace function app.ensure_messaging_settings(p_tenant uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if auth.uid() is not null and not app.is_member(p_tenant) then raise exception 'not a member of this company' using errcode = '42501'; end if;
  insert into public.messaging_settings (tenant_id, sender_name) select p_tenant, t.name from public.tenants t where t.id = p_tenant
  on conflict (tenant_id) do nothing;
  select id into v_id from public.messaging_settings where tenant_id = p_tenant;
  return v_id;
end $$;
revoke all on function app.ensure_messaging_settings(uuid) from public;
grant execute on function app.ensure_messaging_settings(uuid) to authenticated, service_role;

-- Queues an outbound message (rule 14). messages.send may queue anything; automations ride on the event that caused
-- them: a visit for the crew or dispatch, an invoice for billing, a notice for compliance or dispatch, a campaign for
-- messages.manage. Idempotent by dedupe key.
create or replace function app.queue_message(p_tenant uuid, p_message jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_purpose text := p_message->>'purpose';
  v_visit uuid := nullif(p_message->>'visit_id', '')::uuid;
  v_invoice uuid := nullif(p_message->>'invoice_id', '')::uuid;
  v_notice uuid := nullif(p_message->>'notice_id', '')::uuid;
  v_campaign uuid := nullif(p_message->>'campaign_id', '')::uuid;
  v_key text := nullif(p_message->>'dedupe_key', '');
  v_ok boolean;
  v_id uuid;
begin
  if auth.uid() is not null then
    if not app.is_member(p_tenant) then raise exception 'not a member of this company' using errcode = '42501'; end if;
    v_ok := app.has_permission(p_tenant, 'messages.send') or case v_purpose
      when 'on_the_way' then exists (select 1 from public.visits v where v.id = v_visit and v.tenant_id = p_tenant)
                             and (app.has_permission(p_tenant, 'visits.write') or app.has_permission(p_tenant, 'dispatch.write'))
      when 'summary' then exists (select 1 from public.visits v where v.id = v_visit and v.tenant_id = p_tenant)
                          and (app.has_permission(p_tenant, 'visits.write') or app.has_permission(p_tenant, 'dispatch.write'))
      when 'review' then exists (select 1 from public.visits v where v.id = v_visit and v.tenant_id = p_tenant)
                         and (app.has_permission(p_tenant, 'visits.write') or app.has_permission(p_tenant, 'dispatch.write'))
      when 'reminder' then exists (select 1 from public.visits v where v.id = v_visit and v.tenant_id = p_tenant) and app.has_permission(p_tenant, 'dispatch.write')
      when 'invoice' then exists (select 1 from public.invoices i where i.id = v_invoice and i.tenant_id = p_tenant
                                  and (app.has_permission(p_tenant, 'billing.write')
                                       or (i.visit_id is not null and exists (select 1 from public.visit_crew c where c.visit_id = i.visit_id and c.user_id = auth.uid()))))
      when 'notice' then exists (select 1 from public.notices n where n.id = v_notice and n.tenant_id = p_tenant)
                         and (app.has_permission(p_tenant, 'compliance.write') or app.has_permission(p_tenant, 'dispatch.write') or app.has_permission(p_tenant, 'visits.write'))
      when 'campaign' then exists (select 1 from public.campaigns c where c.id = v_campaign and c.tenant_id = p_tenant) and app.has_permission(p_tenant, 'messages.manage')
      else false end;
    if not v_ok then raise exception 'sending a % message needs messages.send', v_purpose using errcode = '42501'; end if;
  end if;
  if v_key is not null then
    select id into v_id from public.messages where tenant_id = p_tenant and dedupe_key = v_key;
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.messages (tenant_id, direction, channel, purpose, account_id, property_id, contact_id, visit_id, notice_id, invoice_id, campaign_id,
                               to_address, from_address, recipient_name, subject, body, body_html, status, suppressed_reason, segments, dedupe_key, send_after, token)
  values (p_tenant, 'outbound', p_message->>'channel', v_purpose, nullif(p_message->>'account_id', '')::uuid, nullif(p_message->>'property_id', '')::uuid,
          nullif(p_message->>'contact_id', '')::uuid, v_visit, v_notice, v_invoice, v_campaign,
          p_message->>'to_address', nullif(p_message->>'from_address', ''), nullif(p_message->>'recipient_name', ''), nullif(p_message->>'subject', ''),
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

-- What a send attempt or a provider callback says; a notice the message carries takes the outcome as its proof (rule 9).
create or replace function app.record_message_status(p_tenant uuid, p_message uuid, p_status text, p_provider text, p_provider_id text, p_error text, p_segments integer default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m record;
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
  if m.notice_id is not null then
    if p_status in ('sent', 'delivered') then
      update public.notices set status = 'sent', sent_at = coalesce(sent_at, now()),
        proof = jsonb_build_object('method', m.channel, 'message_id', m.id, 'provider', coalesce(p_provider, m.provider), 'provider_message_id', coalesce(p_provider_id, m.provider_message_id),
                                   'to', m.to_address, 'sent_at', coalesce(m.sent_at, now()), 'delivered_at', case when p_status = 'delivered' then now() else null end)
      where id = m.notice_id and tenant_id = p_tenant and status in ('due', 'sent', 'failed');
    elsif p_status in ('failed', 'suppressed') then
      update public.notices set status = 'failed', proof = proof || jsonb_build_object('failed_message_id', m.id, 'error', coalesce(p_error, 'not sent'))
      where id = m.notice_id and tenant_id = p_tenant and status = 'due';
    end if;
  end if;
end $$;
revoke all on function app.record_message_status(uuid, uuid, text, text, text, text, integer) from public;
grant execute on function app.record_message_status(uuid, uuid, text, text, text, text, integer) to authenticated, service_role;

-- One sender at a time: a queued message is claimed for five minutes before the provider is called.
create or replace function app.claim_message(p_tenant uuid, p_message uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n integer;
begin
  if auth.uid() is not null and not app.is_member(p_tenant) then raise exception 'not a member of this company' using errcode = '42501'; end if;
  update public.messages set claimed_at = now()
  where id = p_message and tenant_id = p_tenant and status = 'queued' and (claimed_at is null or claimed_at < now() - interval '5 minutes');
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke all on function app.claim_message(uuid, uuid) from public;
grant execute on function app.claim_message(uuid, uuid) to authenticated, service_role;

-- A text held by quiet hours waits for the next allowed minute (rule 4).
create or replace function app.defer_message(p_tenant uuid, p_message uuid, p_until timestamptz) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not app.is_member(p_tenant) then raise exception 'not a member of this company' using errcode = '42501'; end if;
  update public.messages set send_after = p_until, claimed_at = null where id = p_message and tenant_id = p_tenant and status = 'queued';
end $$;
revoke all on function app.defer_message(uuid, uuid, timestamptz) from public;
grant execute on function app.defer_message(uuid, uuid, timestamptz) to authenticated, service_role;

-- Inbound messages the office has read.
create or replace function app.mark_messages_read(p_tenant uuid, p_ids uuid[]) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n integer;
begin
  if auth.uid() is not null and not app.has_permission(p_tenant, 'messages.send') then raise exception 'reading the inbox needs messages.send' using errcode = '42501'; end if;
  update public.messages set read_at = coalesce(read_at, now()) where tenant_id = p_tenant and id = any(p_ids) and direction = 'inbound';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function app.mark_messages_read(uuid, uuid[]) from public;
grant execute on function app.mark_messages_read(uuid, uuid[]) to authenticated, service_role;

-- The public message page and the unsubscribe link (rule 13): by token only, and only what the page shows.
create or replace function app.message_view(p_token text) returns table (subject text, body text, body_html text, channel text, company_name text, sent_at timestamptz, purpose text)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.subject, m.body, m.body_html, m.channel, coalesce(s.sender_name, t.name), coalesce(m.sent_at, m.created_at), m.purpose
  from public.messages m join public.tenants t on t.id = m.tenant_id left join public.messaging_settings s on s.tenant_id = m.tenant_id
  where m.token = p_token and m.direction = 'outbound' and m.status in ('sent', 'delivered', 'queued')
$$;
revoke all on function app.message_view(text) from public;
grant execute on function app.message_view(text) to anon, authenticated, service_role;

create or replace function app.unsubscribe(p_token text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m record;
begin
  select id, tenant_id, to_address, channel into m from public.messages where token = p_token and direction = 'outbound' and channel = 'email';
  if m.id is null then return null; end if;
  insert into public.message_opt_outs (tenant_id, channel, address, reason, message_id, created_by)
  values (m.tenant_id, 'email', lower(m.to_address), 'unsubscribe', m.id, null) on conflict (tenant_id, channel, address) do nothing;
  return (select coalesce(s.sender_name, t.name) from public.tenants t left join public.messaging_settings s on s.tenant_id = t.id where t.id = m.tenant_id);
end $$;
revoke all on function app.unsubscribe(text) from public;
grant execute on function app.unsubscribe(text) to anon, authenticated, service_role;

-- The public pages run as anon and call only the functions granted to it (message_view, unsubscribe, and the
-- invitation preview, which needed this too); every other app function is a trigger or revoked from public.
grant usage on schema app to anon;

-- Policies.
create policy messaging_settings_select on public.messaging_settings for select to authenticated using (app.is_member(tenant_id));
create policy messaging_settings_insert on public.messaging_settings for insert to authenticated with check (app.has_permission(tenant_id, 'messages.manage'));
create policy messaging_settings_update on public.messaging_settings for update to authenticated
  using (app.has_permission(tenant_id, 'messages.manage')) with check (app.has_permission(tenant_id, 'messages.manage'));

create policy message_templates_select on public.message_templates for select to authenticated using (app.is_member(tenant_id));
create policy message_templates_insert on public.message_templates for insert to authenticated with check (app.has_permission(tenant_id, 'messages.manage'));
create policy message_templates_update on public.message_templates for update to authenticated
  using (app.has_permission(tenant_id, 'messages.manage')) with check (app.has_permission(tenant_id, 'messages.manage'));
create policy message_templates_delete on public.message_templates for delete to authenticated using (app.has_permission(tenant_id, 'messages.manage'));

create policy campaigns_select on public.campaigns for select to authenticated using (app.has_permission(tenant_id, 'messages.manage') or app.has_permission(tenant_id, 'messages.send'));
create policy campaigns_insert on public.campaigns for insert to authenticated with check (app.has_permission(tenant_id, 'messages.manage'));
create policy campaigns_update on public.campaigns for update to authenticated
  using (app.has_permission(tenant_id, 'messages.manage')) with check (app.has_permission(tenant_id, 'messages.manage'));

-- Messages are read with the customer record; they are written through the functions above.
create policy messages_select on public.messages for select to authenticated
  using (app.has_permission(tenant_id, 'customers.read') or app.has_permission(tenant_id, 'messages.send') or app.has_permission(tenant_id, 'compliance.read'));

create policy message_opt_outs_select on public.message_opt_outs for select to authenticated using (app.has_permission(tenant_id, 'customers.read') or app.has_permission(tenant_id, 'messages.send'));
create policy message_opt_outs_insert on public.message_opt_outs for insert to authenticated with check (app.has_permission(tenant_id, 'messages.send'));
create policy message_opt_outs_delete on public.message_opt_outs for delete to authenticated using (app.has_permission(tenant_id, 'messages.manage'));

-- The office and dispatch answer customers.
update public.roles set permissions = array(select distinct unnest(permissions || array['messages.send']))
where tenant_id is null and key in ('office', 'dispatcher') and not ('messages.send' = any(permissions));
