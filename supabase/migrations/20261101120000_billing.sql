-- Spec 08: billing. Invoices from the agreement's billing mode, sales tax by service type and address, payments and
-- their allocations, saved payment methods with autopay, collections and the gateway's idempotency ledger.
-- Money is bigint cents everywhere; rates are numeric. No rate and no state fact is written here.

alter table public.accounts
  add column past_due_since date,
  add column tax_exempt_number text,
  add column tax_exempt_expires_on date,
  add column tax_exempt_file_id uuid references public.files(id) on delete set null,
  add column gateway_customer_id text;

-- ---------------------------------------------------------------------------
-- Settings and rates
-- ---------------------------------------------------------------------------

create table public.billing_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  late_fee_cents bigint not null default 0 check (late_fee_cents >= 0),
  late_fee_percent numeric not null default 0 check (late_fee_percent >= 0 and late_fee_percent <= 100),
  grace_days integer not null default 0 check (grace_days between 0 and 90),
  pause_when_past_due boolean not null default false,
  autopay_retry_days integer[] not null default '{3,7}',
  invoice_footer text,
  gateway text not null default 'local' check (gateway in ('local', 'stripe')),
  gateway_account_id text,
  gateway_onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.billing_settings enable row level security;

-- shared-table: sales tax rates come from each state revenue department's tables and apply to every tenant
create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  state_code text not null check (state_code ~ '^[A-Z]{2}$'),
  postal_code text not null check (postal_code ~ '^[0-9]{5}$'),
  jurisdiction_kind text not null check (jurisdiction_kind in ('state', 'county', 'city', 'district')),
  jurisdiction_name text not null,
  rate numeric not null check (rate >= 0 and rate < 1),
  effective_from date not null,
  effective_to date,
  source text not null check (length(trim(source)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (effective_to is null or effective_to >= effective_from)
);
alter table public.tax_rates enable row level security;
create index tax_rates_lookup on public.tax_rates (state_code, postal_code, effective_from);

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  number integer,
  kind text not null default 'invoice' check (kind in ('invoice', 'credit_memo')),
  account_id uuid not null,
  property_id uuid,
  agreement_id uuid,
  visit_id uuid,
  status text not null default 'draft' check (status in ('draft', 'issued', 'partially_paid', 'paid', 'past_due', 'void')),
  issued_on date,
  due_on date,
  terms_days integer not null default 0 check (terms_days between 0 and 120),
  po_number text,
  subtotal_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  paid_cents bigint not null default 0 check (paid_cents >= 0),
  memo text,
  source text not null check (source in ('visit', 'installment', 'prepay', 'settlement', 'late_fee', 'manual')),
  source_key text not null,
  tax_unconfirmed boolean not null default false,
  void_reason text,
  voided_at timestamptz,
  voided_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, source_key),
  unique (tenant_id, number),
  foreign key (tenant_id, account_id) references public.accounts (tenant_id, id) on delete restrict,
  foreign key (tenant_id, property_id) references public.properties (tenant_id, id) on delete restrict,
  foreign key (tenant_id, agreement_id) references public.agreements (tenant_id, id) on delete restrict,
  foreign key (tenant_id, visit_id) references public.visits (tenant_id, id) on delete restrict,
  constraint invoices_issued_fields check (status = 'draft' or (number is not null and issued_on is not null and due_on is not null)),
  constraint invoices_void_reason check (status <> 'void' or (void_reason is not null and length(trim(void_reason)) > 0)),
  constraint invoices_sign check ((kind = 'invoice' and subtotal_cents >= 0 and tax_cents >= 0) or (kind = 'credit_memo' and subtotal_cents <= 0 and tax_cents <= 0))
);
alter table public.invoices enable row level security;
create index invoices_account on public.invoices (tenant_id, account_id, issued_on desc);
create index invoices_open on public.invoices (tenant_id, status, due_on) where status in ('issued', 'partially_paid', 'past_due');

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  position integer not null default 1,
  agreement_id uuid,
  visit_id uuid,
  service_type_id uuid,
  service_line text,
  description text not null check (length(trim(description)) > 0),
  amount_cents bigint not null,
  tax_class text not null default 'unknown' check (tax_class in ('taxable', 'exempt', 'unknown', 'exempt_certificate')),
  tax_rate numeric not null default 0,
  tax_breakdown jsonb not null default '[]'::jsonb check (jsonb_typeof(tax_breakdown) = 'array'),
  tax_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (invoice_id, position)
);
alter table public.invoice_lines enable row level security;
create index invoice_lines_invoice on public.invoice_lines (tenant_id, invoice_id);

-- ---------------------------------------------------------------------------
-- Payments, methods, allocations, autopay
-- ---------------------------------------------------------------------------

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  account_id uuid not null,
  gateway text not null check (gateway in ('local', 'stripe')),
  gateway_payment_method_id text not null,
  kind text not null check (kind in ('card', 'us_bank_account')),
  brand text,
  last4 text not null check (last4 ~ '^[0-9]{4}$'),
  exp_month integer check (exp_month is null or exp_month between 1 and 12),
  exp_year integer check (exp_year is null or exp_year between 2000 and 2100),
  autopay boolean not null default false,
  is_default boolean not null default false,
  status text not null default 'active' check (status in ('active', 'removed')),
  added_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, gateway, gateway_payment_method_id),
  foreign key (tenant_id, account_id) references public.accounts (tenant_id, id) on delete cascade
);
alter table public.payment_methods enable row level security;
create index payment_methods_account on public.payment_methods (tenant_id, account_id) where status = 'active';

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  account_id uuid not null,
  kind text not null default 'payment' check (kind in ('payment', 'refund')),
  method text not null check (method in ('card', 'us_bank_account', 'cash', 'check', 'other')),
  status text not null default 'succeeded' check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  amount_cents bigint not null check (amount_cents > 0),
  gateway text check (gateway is null or gateway in ('local', 'stripe')),
  gateway_payment_id text,
  payment_method_id uuid references public.payment_methods(id) on delete set null,
  refund_of uuid references public.payments(id) on delete restrict,
  reference text,
  failure_reason text,
  received_at timestamptz not null default now(),
  visit_id uuid,
  recorded_by uuid references auth.users(id),
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (tenant_id, account_id) references public.accounts (tenant_id, id) on delete restrict,
  foreign key (tenant_id, visit_id) references public.visits (tenant_id, id) on delete restrict,
  constraint payments_refund_target check (kind <> 'refund' or refund_of is not null),
  constraint payments_gateway_methods check (method not in ('card', 'us_bank_account') or gateway is not null)
);
alter table public.payments enable row level security;
create index payments_account on public.payments (tenant_id, account_id, received_at desc);
create unique index payments_gateway_id on public.payments (tenant_id, gateway, gateway_payment_id) where gateway_payment_id is not null;

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (payment_id, invoice_id)
);
alter table public.payment_allocations enable row level security;
create index payment_allocations_invoice on public.payment_allocations (tenant_id, invoice_id);

create table public.autopay_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  payment_method_id uuid references public.payment_methods(id) on delete set null,
  attempt integer not null check (attempt >= 1),
  scheduled_for date not null,
  attempted_at timestamptz,
  result text check (result is null or result in ('succeeded', 'failed', 'skipped')),
  payment_id uuid references public.payments(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (invoice_id, attempt)
);
alter table public.autopay_attempts enable row level security;

-- shared-table: a gateway webhook arrives before its tenant is known; the row is the idempotency ledger for events
create table public.gateway_events (
  id uuid primary key default gen_random_uuid(),
  gateway text not null check (gateway in ('local', 'stripe')),
  event_id text not null,
  type text not null,
  received_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  tenant_id uuid references public.tenants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (gateway, event_id)
);
alter table public.gateway_events enable row level security;

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

-- Issuing takes the tenant's next invoice number and fixes the due date; afterwards the document never changes.
create or replace function app.protect_invoice() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'an issued invoice is never deleted; void it with a reason' using errcode = '23514';
    end if;
    return old;
  end if;
  if old.status = 'void' then
    raise exception 'a void invoice stays as it is' using errcode = '23514';
  end if;
  if old.status <> 'draft' and new.status = 'draft' then
    raise exception 'an issued invoice cannot go back to draft' using errcode = '23514';
  end if;
  if old.status = 'draft' and new.status <> 'draft' and new.status <> 'void' then
    if new.number is null then new.number := app.next_number(new.tenant_id, 'invoice'); end if;
    if new.issued_on is null then new.issued_on := current_date; end if;
    if new.due_on is null then new.due_on := new.issued_on + new.terms_days; end if;
  end if;
  if old.status <> 'draft' then
    if new.number is distinct from old.number or new.kind <> old.kind or new.account_id <> old.account_id or new.agreement_id is distinct from old.agreement_id
       or new.issued_on is distinct from old.issued_on or new.due_on is distinct from old.due_on or new.terms_days <> old.terms_days
       or new.subtotal_cents <> old.subtotal_cents or new.tax_cents <> old.tax_cents or new.total_cents <> old.total_cents
       or new.source <> old.source or new.source_key <> old.source_key then
      raise exception 'an issued invoice never changes; void it with a reason or issue a credit memo' using errcode = '23514';
    end if;
  end if;
  if new.status = 'void' then
    if old.paid_cents > 0 or exists (select 1 from public.payment_allocations a where a.invoice_id = new.id) then
      raise exception 'an invoice with payments cannot be voided; refund first' using errcode = '23514';
    end if;
    new.voided_at := coalesce(new.voided_at, now());
    new.voided_by := coalesce(new.voided_by, auth.uid());
  end if;
  return new;
end $$;
create trigger invoices_protect before update or delete on public.invoices for each row execute function app.protect_invoice();

-- Lines belong to a draft; once the invoice is issued they are part of the document.
create or replace function app.protect_invoice_lines() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  st text;
begin
  select status into st from public.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if st is distinct from 'draft' then
    raise exception 'lines change only on a draft invoice' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
create trigger invoice_lines_protect before insert or update or delete on public.invoice_lines for each row execute function app.protect_invoice_lines();

-- An allocation never exceeds its payment or its invoice, and only a succeeded payment is allocated to an issued invoice.
create or replace function app.check_allocation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p record;
  i record;
  allocated bigint;
begin
  select tenant_id, account_id, kind, status, amount_cents into p from public.payments where id = new.payment_id;
  select tenant_id, account_id, kind, status, total_cents into i from public.invoices where id = new.invoice_id;
  if p is null or i is null or p.tenant_id <> new.tenant_id or i.tenant_id <> new.tenant_id then
    raise exception 'allocation needs a payment and an invoice of the same company' using errcode = '23514';
  end if;
  if p.account_id <> i.account_id then
    raise exception 'a payment is allocated to its own account''s invoices' using errcode = '23514';
  end if;
  if p.kind <> 'payment' or p.status <> 'succeeded' then
    raise exception 'only a succeeded payment is allocated' using errcode = '23514';
  end if;
  if i.kind <> 'invoice' or i.status in ('draft', 'void') then
    raise exception 'allocations go to issued invoices' using errcode = '23514';
  end if;
  select coalesce(sum(amount_cents), 0) into allocated from public.payment_allocations where payment_id = new.payment_id and id <> new.id;
  if allocated + new.amount_cents > p.amount_cents then
    raise exception 'allocations exceed the payment' using errcode = '23514';
  end if;
  select coalesce(sum(amount_cents), 0) into allocated from public.payment_allocations where invoice_id = new.invoice_id and id <> new.id;
  if allocated + new.amount_cents > i.total_cents then
    raise exception 'allocations exceed the invoice' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger payment_allocations_check before insert or update on public.payment_allocations for each row execute function app.check_allocation();

-- paid_cents and the paid or partially paid status follow the allocations; past due is decided by the billing job.
create or replace function app.refresh_invoice_paid() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  target uuid;
  paid bigint;
  inv record;
begin
  target := coalesce(new.invoice_id, old.invoice_id);
  select coalesce(sum(amount_cents), 0) into paid from public.payment_allocations where invoice_id = target;
  select status, total_cents into inv from public.invoices where id = target;
  update public.invoices
  set paid_cents = paid,
      status = case
        when inv.status in ('draft', 'void') then inv.status
        when paid >= inv.total_cents then 'paid'
        when paid > 0 then 'partially_paid'
        when inv.status = 'past_due' then 'past_due'
        else 'issued' end
  where id = target;
  return coalesce(new, old);
end $$;
create trigger payment_allocations_refresh after insert or update or delete on public.payment_allocations for each row execute function app.refresh_invoice_paid();

-- The account's past-due flag follows its oldest past-due invoice.
create or replace function app.refresh_account_past_due() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.accounts a
  set past_due_since = (select min(i.due_on) from public.invoices i where i.account_id = a.id and i.status = 'past_due')
  where a.id = coalesce(new.account_id, old.account_id);
  return coalesce(new, old);
end $$;
create trigger invoices_past_due after insert or update of status on public.invoices for each row execute function app.refresh_account_past_due();

-- One default method per account: setting a new default clears the old one.
create or replace function app.single_default_method() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.is_default and new.status = 'active' then
    update public.payment_methods set is_default = false where account_id = new.account_id and id <> new.id and is_default;
  end if;
  return new;
end $$;
create trigger payment_methods_default after insert or update of is_default, status on public.payment_methods for each row execute function app.single_default_method();

-- Billing staff keep the account's gateway customer and tax exemption without owning the customer record.
create or replace function app.set_account_gateway_customer(p_tenant uuid, p_account uuid, p_customer text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  changed integer;
begin
  if auth.uid() is not null and not app.has_permission(p_tenant, 'billing.write') then
    raise exception 'gateway customers need billing.write' using errcode = '42501';
  end if;
  update public.accounts set gateway_customer_id = p_customer where id = p_account and tenant_id = p_tenant;
  get diagnostics changed = row_count;
  return changed > 0;
end $$;
revoke all on function app.set_account_gateway_customer(uuid, uuid, text) from public;
grant execute on function app.set_account_gateway_customer(uuid, uuid, text) to authenticated;

create or replace function app.set_account_tax_exemption(p_tenant uuid, p_account uuid, p_number text, p_expires date, p_file uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  changed integer;
begin
  if auth.uid() is not null and not app.has_permission(p_tenant, 'billing.write') then
    raise exception 'tax exemptions need billing.write' using errcode = '42501';
  end if;
  update public.accounts set tax_exempt_number = p_number, tax_exempt_expires_on = p_expires, tax_exempt_file_id = p_file where id = p_account and tenant_id = p_tenant;
  get diagnostics changed = row_count;
  return changed > 0;
end $$;
revoke all on function app.set_account_tax_exemption(uuid, uuid, text, date, uuid) from public;
grant execute on function app.set_account_tax_exemption(uuid, uuid, text, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Housekeeping and policies
-- ---------------------------------------------------------------------------

create trigger billing_settings_updated_at before update on public.billing_settings for each row execute function app.set_updated_at();
create trigger tax_rates_updated_at before update on public.tax_rates for each row execute function app.set_updated_at();
create trigger invoices_updated_at before update on public.invoices for each row execute function app.set_updated_at();
create trigger invoice_lines_updated_at before update on public.invoice_lines for each row execute function app.set_updated_at();
create trigger payment_methods_updated_at before update on public.payment_methods for each row execute function app.set_updated_at();
create trigger payments_updated_at before update on public.payments for each row execute function app.set_updated_at();
create trigger payment_allocations_updated_at before update on public.payment_allocations for each row execute function app.set_updated_at();
create trigger autopay_attempts_updated_at before update on public.autopay_attempts for each row execute function app.set_updated_at();
create trigger billing_settings_audit after insert or update or delete on public.billing_settings for each row execute function app.write_audit();
create trigger invoices_audit after insert or update or delete on public.invoices for each row execute function app.write_audit();
create trigger payments_audit after insert or update or delete on public.payments for each row execute function app.write_audit();
create trigger payment_methods_audit after insert or update or delete on public.payment_methods for each row execute function app.write_audit();

create policy billing_settings_select on public.billing_settings for select to authenticated using (app.is_member(tenant_id));
create policy billing_settings_insert on public.billing_settings for insert to authenticated with check (app.has_permission(tenant_id, 'billing.write'));
create policy billing_settings_update on public.billing_settings for update to authenticated
  using (app.has_permission(tenant_id, 'billing.write')) with check (app.has_permission(tenant_id, 'billing.write'));

create policy tax_rates_select on public.tax_rates for select to authenticated using (true);
create policy tax_rates_insert on public.tax_rates for insert to authenticated with check (app.is_platform_admin());
create policy tax_rates_update on public.tax_rates for update to authenticated using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy tax_rates_delete on public.tax_rates for delete to authenticated using (app.is_platform_admin());

-- The crew at the stop reads the one invoice of their visit, so a cash payment there lands on it.
create policy invoices_select on public.invoices for select to authenticated
  using (app.has_permission(tenant_id, 'billing.read') or app.has_permission(tenant_id, 'agreements.read')
         or (visit_id is not null and exists (select 1 from public.visit_crew c where c.visit_id = invoices.visit_id and c.user_id = auth.uid())));
create policy invoices_insert on public.invoices for insert to authenticated
  with check (app.has_permission(tenant_id, 'billing.write') or app.has_permission(tenant_id, 'visits.write') or app.has_permission(tenant_id, 'agreements.write'));
create policy invoices_update on public.invoices for update to authenticated
  using (app.has_permission(tenant_id, 'billing.write') or app.has_permission(tenant_id, 'visits.write') or app.has_permission(tenant_id, 'agreements.write'))
  with check (app.has_permission(tenant_id, 'billing.write') or app.has_permission(tenant_id, 'visits.write') or app.has_permission(tenant_id, 'agreements.write'));
create policy invoices_delete on public.invoices for delete to authenticated using (app.has_permission(tenant_id, 'billing.write'));

create policy invoice_lines_select on public.invoice_lines for select to authenticated
  using (app.has_permission(tenant_id, 'billing.read') or app.has_permission(tenant_id, 'agreements.read')
         or exists (select 1 from public.invoices i join public.visit_crew c on c.visit_id = i.visit_id where i.id = invoice_lines.invoice_id and c.user_id = auth.uid()));
create policy invoice_lines_insert on public.invoice_lines for insert to authenticated
  with check (app.has_permission(tenant_id, 'billing.write') or app.has_permission(tenant_id, 'visits.write') or app.has_permission(tenant_id, 'agreements.write'));
create policy invoice_lines_update on public.invoice_lines for update to authenticated
  using (app.has_permission(tenant_id, 'billing.write')) with check (app.has_permission(tenant_id, 'billing.write'));
create policy invoice_lines_delete on public.invoice_lines for delete to authenticated using (app.has_permission(tenant_id, 'billing.write'));

create policy payment_methods_select on public.payment_methods for select to authenticated using (app.has_permission(tenant_id, 'billing.read'));
create policy payment_methods_insert on public.payment_methods for insert to authenticated with check (app.has_permission(tenant_id, 'billing.write'));
create policy payment_methods_update on public.payment_methods for update to authenticated
  using (app.has_permission(tenant_id, 'billing.write')) with check (app.has_permission(tenant_id, 'billing.write'));

create policy payments_select on public.payments for select to authenticated
  using (app.has_permission(tenant_id, 'billing.read')
         or (visit_id is not null and exists (select 1 from public.visit_crew c where c.visit_id = payments.visit_id and c.user_id = auth.uid())));
-- Billing staff record any payment; the crew at the stop record cash and checks for a visit they are on (rule 15).
create policy payments_insert on public.payments for insert to authenticated
  with check (app.has_permission(tenant_id, 'billing.write')
              or (visit_id is not null and method in ('cash', 'check') and app.has_permission(tenant_id, 'visits.write')
                  and exists (select 1 from public.visit_crew c where c.visit_id = payments.visit_id and c.user_id = auth.uid())));
create policy payments_update on public.payments for update to authenticated
  using (app.has_permission(tenant_id, 'billing.write')) with check (app.has_permission(tenant_id, 'billing.write'));

create policy payment_allocations_select on public.payment_allocations for select to authenticated
  using (app.has_permission(tenant_id, 'billing.read')
         or exists (select 1 from public.payments p join public.visit_crew c on c.visit_id = p.visit_id where p.id = payment_allocations.payment_id and c.user_id = auth.uid()));
create policy payment_allocations_insert on public.payment_allocations for insert to authenticated
  with check (app.has_permission(tenant_id, 'billing.write')
              or exists (select 1 from public.payments p join public.visit_crew c on c.visit_id = p.visit_id where p.id = payment_allocations.payment_id and c.user_id = auth.uid()));
create policy payment_allocations_delete on public.payment_allocations for delete to authenticated using (app.has_permission(tenant_id, 'billing.write'));

create policy autopay_attempts_select on public.autopay_attempts for select to authenticated using (app.has_permission(tenant_id, 'billing.read'));
create policy autopay_attempts_insert on public.autopay_attempts for insert to authenticated with check (app.has_permission(tenant_id, 'billing.write'));
create policy autopay_attempts_update on public.autopay_attempts for update to authenticated
  using (app.has_permission(tenant_id, 'billing.write')) with check (app.has_permission(tenant_id, 'billing.write'));

create policy gateway_events_select on public.gateway_events for select to authenticated
  using (tenant_id is not null and app.has_permission(tenant_id, 'billing.read'));
