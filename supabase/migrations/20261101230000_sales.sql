-- Spec 17: sales and growth. Territories and door knocks, the door sale's seller and card capture, commission plans
-- with holds, releases, chargebacks and payouts (posted to commissions payable), marketing sequences, post-visit
-- surveys and the referral program. Every new table is tenant-owned, under row level security and the write guard.

-- ---------------------------------------------------------------------------
-- Territories and knocks (rules 1 and 2)
-- ---------------------------------------------------------------------------

create table public.territories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  zip_codes text[] not null default '{}',
  streets text[] not null default '{}',
  rep_ids uuid[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, id)
);
alter table public.territories enable row level security;

create table public.knocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  territory_id uuid not null,
  rep_id uuid not null references auth.users(id),
  address text not null check (length(trim(address)) > 0),
  normalized_address text not null,
  postal_code text,
  lat double precision,
  lng double precision,
  outcome text not null check (outcome in ('not_home', 'not_interested', 'come_back', 'sold', 'do_not_knock')),
  notes text,
  follow_up_at timestamptz,
  lead_id uuid,
  agreement_id uuid,
  cleared_at timestamptz,
  knocked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, territory_id) references public.territories (tenant_id, id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id),
  foreign key (tenant_id, agreement_id) references public.agreements (tenant_id, id)
);
alter table public.knocks enable row level security;
create index knocks_address on public.knocks (tenant_id, normalized_address, knocked_at desc);
create index knocks_territory on public.knocks (tenant_id, territory_id, knocked_at desc);

-- Whether the signed-in member is assigned to the territory.
create or replace function app.on_territory(p_territory uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.territories t where t.id = p_territory and auth.uid() = any(t.rep_ids) and t.active)
$$;
revoke all on function app.on_territory(uuid) from public;
grant execute on function app.on_territory(uuid) to authenticated, service_role;

alter table public.agreements add column sold_by uuid references auth.users(id);
alter table public.agreements add column knock_id uuid;
alter table public.agreements add constraint agreements_knock_fkey foreign key (tenant_id, knock_id) references public.knocks (tenant_id, id);

-- The seller is one of the company's people, and is fixed once the customer signs (their commission rides on it).
create or replace function app.agreement_seller_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.sold_by is not null and (tg_op = 'INSERT' or new.sold_by is distinct from old.sold_by)
     and not exists (select 1 from public.memberships m where m.tenant_id = new.tenant_id and m.user_id = new.sold_by) then
    raise exception 'the seller is one of the company''s people' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null and old.signed_at is not null and new.sold_by is distinct from old.sold_by then
    raise exception 'the seller is fixed once the agreement is signed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger agreements_seller_guard before insert or update of sold_by on public.agreements for each row execute function app.agreement_seller_guard();

-- ---------------------------------------------------------------------------
-- Card capture at the door: a permission that saves a card and nothing more
-- ---------------------------------------------------------------------------

update public.roles set permissions = array_append(permissions, 'payments.capture')
where tenant_id is null and key in ('sales_rep', 'office') and not ('payments.capture' = any(permissions));

create policy payment_methods_capture_insert on public.payment_methods for insert to authenticated
  with check (app.has_permission(tenant_id, 'payments.capture'));
create policy payment_methods_capture_update on public.payment_methods for update to authenticated
  using (app.has_permission(tenant_id, 'payments.capture')) with check (app.has_permission(tenant_id, 'payments.capture'));
create policy payment_methods_capture_select on public.payment_methods for select to authenticated
  using (app.has_permission(tenant_id, 'payments.capture'));

-- The customer's drawn signature at the door: whoever signs agreements stores it (spec 17 rule 3).
create policy files_signature_insert on public.files for insert to authenticated
  with check (kind = 'signature' and app.has_permission(tenant_id, 'agreements.write'));

create or replace function app.set_account_gateway_customer(p_tenant uuid, p_account uuid, p_customer text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  changed integer;
begin
  if auth.uid() is not null and not app.has_permission(p_tenant, 'billing.write') and not app.has_permission(p_tenant, 'payments.capture')
     and app.portal_account(p_tenant) is distinct from p_account then
    raise exception 'gateway customers need billing.write' using errcode = '42501';
  end if;
  update public.accounts set gateway_customer_id = p_customer where id = p_account and tenant_id = p_tenant;
  get diagnostics changed = row_count;
  return changed > 0;
end $$;

-- ---------------------------------------------------------------------------
-- Commissions (rules 4 to 7)
-- ---------------------------------------------------------------------------

create table public.commission_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  role_keys text[] not null default '{}',
  user_ids uuid[] not null default '{}',
  basis text not null check (basis in ('initial', 'first_year', 'flat')),
  percent numeric(6, 3) check (percent is null or (percent > 0 and percent <= 100)),
  flat_cents bigint check (flat_cents is null or flat_cents > 0),
  hold_days integer not null default 30 check (hold_days between 0 and 365),
  hold_paid_invoices integer not null default 1 check (hold_paid_invoices between 0 and 24),
  chargeback_days integer not null default 90 check (chargeback_days between 0 and 730),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, id),
  constraint commission_plans_amount check ((basis = 'flat') = (flat_cents is not null) and (basis = 'flat' or percent is not null)),
  constraint commission_plans_who check (cardinality(role_keys) + cardinality(user_ids) > 0)
);
alter table public.commission_plans enable row level security;

create table public.commission_payouts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  paid_on date not null,
  amount_cents bigint not null,
  method text not null default 'payroll' check (method in ('payroll', 'check', 'transfer')),
  reference text,
  paid_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
alter table public.commission_payouts enable row level security;

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  agreement_id uuid not null,
  plan_id uuid not null,
  basis_cents bigint not null check (basis_cents >= 0),
  amount_cents bigint not null check (amount_cents >= 0),
  status text not null default 'held' check (status in ('held', 'payable', 'paid', 'charged_back')),
  earned_on date not null,
  releasable_on date not null,
  released_on date,
  paid_on date,
  payout_id uuid,
  charged_back_on date,
  -- A paid commission charged back is owed back: the payout that nets it out.
  recovered_payout_id uuid,
  reason text,
  -- The plan's hold and chargeback terms as they stood when earned: a plan changed later does not change them.
  hold_paid_invoices integer not null default 0 check (hold_paid_invoices >= 0),
  chargeback_days integer not null default 0 check (chargeback_days >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (agreement_id, plan_id, user_id),
  foreign key (tenant_id, agreement_id) references public.agreements (tenant_id, id) on delete cascade,
  foreign key (tenant_id, plan_id) references public.commission_plans (tenant_id, id),
  foreign key (tenant_id, payout_id) references public.commission_payouts (tenant_id, id),
  foreign key (tenant_id, recovered_payout_id) references public.commission_payouts (tenant_id, id),
  constraint commissions_released check ((status in ('payable', 'paid')) <= (released_on is not null)),
  constraint commissions_paid check ((status = 'paid') = (paid_on is not null and payout_id is not null) or status = 'charged_back'),
  constraint commissions_charged_back check ((status = 'charged_back') = (charged_back_on is not null))
);
alter table public.commissions enable row level security;
create index commissions_user on public.commissions (tenant_id, user_id, status);

-- Rules 4 to 7 in the database. A member's insert is the seller's commission on a signed agreement under an active plan
-- that covers them, with the basis and amount worked out here (the app's figures must agree); after that only the
-- allowed moves happen: release once the hold is met, payment by a payout, a chargeback inside the window. Sales reps
-- write agreements, so without this they could write their own pay. Jobs and the seed (no user) are trusted.
create or replace function app.commission_terms(p_agreement uuid, p_plan uuid) returns table (basis_cents bigint, amount_cents bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.basis, case when p.basis = 'flat' then b.basis else floor((b.basis * round(p.percent * 1000) + 50000) / 100000)::bigint end
  from public.commission_plans p join public.agreements g on g.id = p_agreement and g.tenant_id = p.tenant_id
  cross join lateral (
    select case p.basis
      when 'flat' then p.flat_cents
      when 'initial' then (select coalesce(sum(v.price_cents), 0) from public.visits v where v.agreement_id = g.id and v.kind = 'initial')
      else (select coalesce(sum(v.price_cents), 0) from public.visits v
            where v.agreement_id = g.id and v.kind in ('initial', 'recurring') and v.due_start >= g.starts_on and v.due_start < (g.starts_on + interval '12 months')::date)
    end::bigint as basis) b
  where p.id = p_plan
$$;
revoke all on function app.commission_terms(uuid, uuid) from public;
grant execute on function app.commission_terms(uuid, uuid) to authenticated;

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
  if auth.uid() is null then return new; end if;
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
    if new.earned_on < (g.signed_at at time zone v_tz)::date or new.earned_on > v_today then
      raise exception 'a commission is earned on the day of signing' using errcode = '23514';
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
      if not app.has_permission(new.tenant_id, 'billing.write') or new.payout_id is null then
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
  if new.recovered_payout_id is distinct from old.recovered_payout_id and (old.recovered_payout_id is not null or not app.has_permission(new.tenant_id, 'billing.write')) then
    raise exception 'only a payout recovers a charged back commission' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger commissions_guard before insert or update on public.commissions for each row execute function app.commissions_guard();

-- ---------------------------------------------------------------------------
-- Sequences (rule 8)
-- ---------------------------------------------------------------------------

create table public.sequences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  trigger text not null check (trigger in ('quote_open', 'renewal_due', 'seasonal_upsell', 'win_back')),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  steps jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 1 and 10),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, id)
);
alter table public.sequences enable row level security;

create table public.sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sequence_id uuid not null,
  subject_key text not null,
  account_id uuid,
  lead_id uuid,
  quote_id uuid,
  agreement_id uuid,
  step integer not null default 0,
  next_at timestamptz,
  status text not null default 'active' check (status in ('active', 'completed', 'stopped')),
  stopped_reason text,
  enrolled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sequence_id, subject_key),
  foreign key (tenant_id, sequence_id) references public.sequences (tenant_id, id) on delete cascade,
  foreign key (tenant_id, account_id) references public.accounts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete cascade,
  foreign key (tenant_id, agreement_id) references public.agreements (tenant_id, id) on delete cascade
);
alter table public.sequence_enrollments enable row level security;
create index sequence_enrollments_due on public.sequence_enrollments (tenant_id, status, next_at);

-- ---------------------------------------------------------------------------
-- Surveys and referrals (rules 9 and 10)
-- ---------------------------------------------------------------------------

create table public.growth_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  referral_credit_cents bigint not null default 2500 check (referral_credit_cents >= 0),
  survey_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.growth_settings enable row level security;

create table public.surveys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  visit_id uuid not null unique,
  account_id uuid not null,
  token uuid not null unique default gen_random_uuid(),
  score integer check (score is null or score between 0 and 10),
  comment text check (comment is null or length(comment) <= 2000),
  sent_at timestamptz not null default now(),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, visit_id) references public.visits (tenant_id, id) on delete cascade,
  foreign key (tenant_id, account_id) references public.accounts (tenant_id, id) on delete cascade,
  constraint surveys_answer check ((responded_at is null) = (score is null))
);
alter table public.surveys enable row level security;

-- A referral code is unique across every company, since /r/<code> names no company; a new account redraws on a clash.
alter table public.accounts add column referral_code text;
create or replace function app.new_referral_code() returns text
language sql volatile set search_path = public, pg_temp as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
$$;
create or replace function app.assign_referral_code() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.referral_code := coalesce(new.referral_code, app.new_referral_code());
  while exists (select 1 from public.accounts a where a.referral_code = new.referral_code) loop
    new.referral_code := app.new_referral_code();
  end loop;
  return new;
end $$;
update public.accounts set referral_code = app.new_referral_code() where referral_code is null;
alter table public.accounts alter column referral_code set default app.new_referral_code();
alter table public.accounts alter column referral_code set not null;
create unique index accounts_referral_code on public.accounts (referral_code);
create trigger accounts_referral_code before insert on public.accounts for each row execute function app.assign_referral_code();

alter table public.leads add column referred_by_account_id uuid;
alter table public.leads add constraint leads_referred_by_fkey foreign key (tenant_id, referred_by_account_id) references public.accounts (tenant_id, id);

create table public.referral_credits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  referrer_account_id uuid not null,
  referred_account_id uuid not null,
  agreement_id uuid not null unique,
  amount_cents bigint not null check (amount_cents >= 0),
  credit_memo_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, referrer_account_id) references public.accounts (tenant_id, id),
  foreign key (tenant_id, referred_account_id) references public.accounts (tenant_id, id),
  foreign key (tenant_id, agreement_id) references public.agreements (tenant_id, id) on delete cascade,
  constraint referral_credits_not_self check (referrer_account_id <> referred_account_id)
);
alter table public.referral_credits enable row level security;

alter table public.invoices drop constraint invoices_source_check;
alter table public.invoices add constraint invoices_source_check check (source in ('visit', 'installment', 'prepay', 'settlement', 'late_fee', 'manual', 'opening', 'materials', 'referral'));

-- The survey page with no user: the company, the visit's service and date, and the answer once.
create or replace function app.survey(p_token uuid) returns table (tenant_name text, service text, visit_date date, score integer, responded boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.name, st.name, (v.completed_at at time zone t.timezone)::date, s.score, s.responded_at is not null
  from public.surveys s join public.visits v on v.id = s.visit_id join public.service_types st on st.id = v.service_type_id join public.tenants t on t.id = s.tenant_id
  where s.token = p_token
$$;
revoke all on function app.survey(uuid) from public;
grant execute on function app.survey(uuid) to anon, authenticated;

create or replace function app.answer_survey(p_token uuid, p_score integer, p_comment text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if p_score is null or p_score < 0 or p_score > 10 then raise exception 'a score is 0 to 10' using errcode = '23514'; end if;
  update public.surveys set score = p_score, comment = nullif(left(trim(coalesce(p_comment, '')), 2000), ''), responded_at = now()
  where token = p_token and responded_at is null returning id into v_id;
  return v_id is not null;
end $$;
revoke all on function app.answer_survey(uuid, integer, text) from public;
grant execute on function app.answer_survey(uuid, integer, text) to anon, authenticated;

-- The referral link: the referrer's first name and the company's booking form, nothing else.
create or replace function app.referral(p_code text) returns table (tenant_id uuid, tenant_name text, referrer text, form_key uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.tenant_id, t.name, split_part(a.name, ' ', 1),
         (select f.key from public.lead_forms f where f.tenant_id = a.tenant_id and f.active order by f.created_at limit 1)
  from public.accounts a join public.tenants t on t.id = a.tenant_id
  where a.referral_code = upper(p_code) and t.status = 'active' and a.archived_at is null
  limit 1
$$;
revoke all on function app.referral(text) from public;
grant execute on function app.referral(text) to anon, authenticated;

-- The booking form's intake learns the referral code (spec 16's function, with the referrer recorded on the lead).
create or replace function app.intake_referral(p_lead uuid, p_code text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lead public.leads;
  v_account uuid;
begin
  select * into v_lead from public.leads where id = p_lead;
  if v_lead.id is null or v_lead.referred_by_account_id is not null or v_lead.created_at < now() - interval '5 minutes' then return false; end if;
  select id into v_account from public.accounts where tenant_id = v_lead.tenant_id and referral_code = upper(p_code) and archived_at is null;
  if v_account is null then return false; end if;
  update public.leads set referred_by_account_id = v_account,
    source_id = coalesce((select id from public.lead_sources where tenant_id = v_lead.tenant_id and key = 'referral'), source_id)
  where id = p_lead;
  return true;
end $$;
revoke all on function app.intake_referral(uuid, text) from public;
grant execute on function app.intake_referral(uuid, text) to anon, authenticated;

-- The booking form's lead gets the address normalized by the server (spec 16), so the office can match and convert it
-- without saving the address again. Only a lead minutes old, and only once.
create or replace function app.intake_address(p_lead uuid, p_normalized text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if coalesce(length(trim(p_normalized)), 0) = 0 then return false; end if;
  update public.leads set normalized_address = left(trim(p_normalized), 300)
  where id = p_lead and normalized_address is null and form_id is not null and created_at > now() - interval '5 minutes'
  returning id into v_id;
  return v_id is not null;
end $$;
revoke all on function app.intake_address(uuid, text) from public;
grant execute on function app.intake_address(uuid, text) to anon, authenticated;

alter table public.journal_entries drop constraint journal_entries_source_type_check;
alter table public.journal_entries add constraint journal_entries_source_type_check
  check (source_type in ('invoice', 'credit_memo', 'void', 'visit', 'product_use', 'payment', 'refund', 'payout', 'reclass', 'reclass_reversal', 'opening', 'manual', 'reversal', 'recognition', 'commission', 'commission_payout'));

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
        when 'commission' then exists (select 1 from public.commissions x where x.id = v_source and x.tenant_id = p_tenant)
        when 'commission_payout' then exists (select 1 from public.commission_payouts x where x.id = v_source and x.tenant_id = p_tenant)
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

-- ---------------------------------------------------------------------------
-- Policies, timestamps, audit, the write guard
-- ---------------------------------------------------------------------------

-- A manager (customers.write and users.read) sees every territory; a rep, who also writes customers, only their own.
create policy territories_select on public.territories for select to authenticated
  using ((app.has_permission(tenant_id, 'customers.write') and app.has_permission(tenant_id, 'users.read')) or (app.is_member(tenant_id) and auth.uid() = any(rep_ids)));
create policy territories_write on public.territories for all to authenticated
  using (app.has_permission(tenant_id, 'customers.write') and app.has_permission(tenant_id, 'users.read'))
  with check (app.has_permission(tenant_id, 'customers.write') and app.has_permission(tenant_id, 'users.read'));

create policy knocks_select on public.knocks for select to authenticated
  using ((app.is_member(tenant_id) and (rep_id = auth.uid() or app.on_territory(territory_id))) or (app.has_permission(tenant_id, 'customers.write') and app.has_permission(tenant_id, 'users.read')));
create policy knocks_insert on public.knocks for insert to authenticated
  with check (rep_id = auth.uid() and app.has_permission(tenant_id, 'customers.write') and app.on_territory(territory_id) and cleared_at is null);
create policy knocks_update on public.knocks for update to authenticated
  using ((rep_id = auth.uid() and app.on_territory(territory_id)) or (app.has_permission(tenant_id, 'customers.write') and app.has_permission(tenant_id, 'users.read')))
  with check ((rep_id = auth.uid() and app.on_territory(territory_id)) or (app.has_permission(tenant_id, 'customers.write') and app.has_permission(tenant_id, 'users.read')));

create policy commission_plans_select on public.commission_plans for select to authenticated using (app.is_member(tenant_id));
create policy commission_plans_write on public.commission_plans for all to authenticated
  using (app.has_permission(tenant_id, 'billing.write')) with check (app.has_permission(tenant_id, 'billing.write'));

create policy commissions_select on public.commissions for select to authenticated
  using (app.has_permission(tenant_id, 'billing.read') or (app.is_member(tenant_id) and user_id = auth.uid()));
create policy commissions_insert on public.commissions for insert to authenticated
  with check (app.has_permission(tenant_id, 'agreements.write') and status = 'held' and released_on is null and payout_id is null);
create policy commissions_update on public.commissions for update to authenticated
  using (app.has_permission(tenant_id, 'billing.write') or app.has_permission(tenant_id, 'agreements.write'))
  with check (app.has_permission(tenant_id, 'billing.write') or app.has_permission(tenant_id, 'agreements.write'));

create policy commission_payouts_select on public.commission_payouts for select to authenticated
  using (app.has_permission(tenant_id, 'billing.read') or (app.is_member(tenant_id) and user_id = auth.uid()));
create policy commission_payouts_insert on public.commission_payouts for insert to authenticated with check (app.has_permission(tenant_id, 'billing.write'));

create policy sequences_select on public.sequences for select to authenticated
  using (app.has_permission(tenant_id, 'messages.send') or app.has_permission(tenant_id, 'customers.read'));
create policy sequences_write on public.sequences for all to authenticated
  using (app.has_permission(tenant_id, 'messages.manage')) with check (app.has_permission(tenant_id, 'messages.manage'));
create policy sequence_enrollments_select on public.sequence_enrollments for select to authenticated
  using (app.has_permission(tenant_id, 'messages.send') or app.has_permission(tenant_id, 'customers.read'));
create policy sequence_enrollments_write on public.sequence_enrollments for all to authenticated
  using (app.has_permission(tenant_id, 'messages.send')) with check (app.has_permission(tenant_id, 'messages.send'));

create policy growth_settings_select on public.growth_settings for select to authenticated using (app.is_member(tenant_id));
-- A portal customer reads the referral credit their link earns (spec 16's additive policies).
create policy growth_settings_portal on public.growth_settings for select to authenticated using ((select app.portal_user_id()) is not null and app.portal_account(tenant_id) is not null);
create policy growth_settings_write on public.growth_settings for all to authenticated
  using (app.has_permission(tenant_id, 'settings.write')) with check (app.has_permission(tenant_id, 'settings.write'));

create policy surveys_select on public.surveys for select to authenticated
  using (app.has_permission(tenant_id, 'customers.read') or app.has_permission(tenant_id, 'reports.read'));
-- The survey goes out with the visit summary, under the technician's session at completion.
create policy surveys_insert on public.surveys for insert to authenticated
  with check (responded_at is null and (app.has_permission(tenant_id, 'messages.send') or (app.has_permission(tenant_id, 'visits.write') and app.on_crew(visit_id))));

create policy referral_credits_select on public.referral_credits for select to authenticated
  using (app.has_permission(tenant_id, 'billing.read') or app.has_permission(tenant_id, 'customers.read'));
-- A credit is money off an invoice: billing staff or the billing job write it, never a seller.
create policy referral_credits_insert on public.referral_credits for insert to authenticated with check (app.has_permission(tenant_id, 'billing.write'));
create policy referral_credits_update on public.referral_credits for update to authenticated
  using (app.has_permission(tenant_id, 'billing.write')) with check (app.has_permission(tenant_id, 'billing.write'));

create trigger territories_updated_at before update on public.territories for each row execute function app.set_updated_at();
create trigger knocks_updated_at before update on public.knocks for each row execute function app.set_updated_at();
create trigger commission_plans_updated_at before update on public.commission_plans for each row execute function app.set_updated_at();
create trigger commissions_updated_at before update on public.commissions for each row execute function app.set_updated_at();
create trigger commission_payouts_updated_at before update on public.commission_payouts for each row execute function app.set_updated_at();
create trigger sequences_updated_at before update on public.sequences for each row execute function app.set_updated_at();
create trigger sequence_enrollments_updated_at before update on public.sequence_enrollments for each row execute function app.set_updated_at();
create trigger growth_settings_updated_at before update on public.growth_settings for each row execute function app.set_updated_at();
create trigger surveys_updated_at before update on public.surveys for each row execute function app.set_updated_at();
create trigger referral_credits_updated_at before update on public.referral_credits for each row execute function app.set_updated_at();
create trigger commission_plans_audit after insert or update or delete on public.commission_plans for each row execute function app.write_audit();
create trigger commissions_audit after insert or update or delete on public.commissions for each row execute function app.write_audit();
create trigger commission_payouts_audit after insert or update or delete on public.commission_payouts for each row execute function app.write_audit();
create trigger territories_audit after insert or update or delete on public.territories for each row execute function app.write_audit();

create trigger tenant_write_guard before insert or update or delete on public.territories for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.knocks for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.commission_plans for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.commissions for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.commission_payouts for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.sequences for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.sequence_enrollments for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.growth_settings for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.surveys for each row execute function app.guard_tenant_write();
create trigger tenant_write_guard before insert or update or delete on public.referral_credits for each row execute function app.guard_tenant_write();
