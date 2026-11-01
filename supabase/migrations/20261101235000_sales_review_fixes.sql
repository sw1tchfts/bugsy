-- Spec 17 review fixes. Card capture saves a card and nothing more; an invoice is paid only by its allocations; a
-- cancellation's date is fixed once cancelled; a commission is earned only in the signing itself; the door sale keeps
-- its drawn signature; a rep cannot clear a do-not-knock or change what happened at a door, and every rep is warned.

-- ---------------------------------------------------------------------------
-- payments.capture: the cards the person saved, on the accounts they saved them to
-- ---------------------------------------------------------------------------

drop policy payment_methods_capture_insert on public.payment_methods;
drop policy payment_methods_capture_update on public.payment_methods;
drop policy payment_methods_capture_select on public.payment_methods;
create policy payment_methods_capture_insert on public.payment_methods for insert to authenticated
  with check (app.has_permission(tenant_id, 'payments.capture') and added_by = auth.uid());
create policy payment_methods_capture_update on public.payment_methods for update to authenticated
  using (app.has_permission(tenant_id, 'payments.capture') and added_by = auth.uid())
  with check (app.has_permission(tenant_id, 'payments.capture') and added_by = auth.uid());
create policy payment_methods_capture_select on public.payment_methods for select to authenticated
  using (app.has_permission(tenant_id, 'payments.capture') and added_by = auth.uid());

-- A saved card stays on its account and with its gateway; only billing moves one.
create or replace function app.payment_methods_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or app.has_permission(new.tenant_id, 'billing.write') then return new; end if;
  if (new.tenant_id, new.account_id, new.gateway, new.gateway_payment_method_id, new.added_by)
     is distinct from (old.tenant_id, old.account_id, old.gateway, old.gateway_payment_method_id, old.added_by) then
    raise exception 'a saved card stays on its account' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger payment_methods_guard before update on public.payment_methods for each row execute function app.payment_methods_guard();

-- A seller links a new customer to the gateway; only billing (or the customer, in the portal) changes an existing link.
create or replace function app.set_account_gateway_customer(p_tenant uuid, p_account uuid, p_customer text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  changed integer;
begin
  if auth.uid() is not null and not app.has_permission(p_tenant, 'billing.write') and app.portal_account(p_tenant) is distinct from p_account then
    if not app.has_permission(p_tenant, 'payments.capture') then
      raise exception 'gateway customers need billing.write' using errcode = '42501';
    end if;
    if exists (select 1 from public.accounts a where a.id = p_account and a.tenant_id = p_tenant and a.gateway_customer_id is not null and a.gateway_customer_id <> p_customer) then
      raise exception 'this account is already linked to the payment processor' using errcode = '42501';
    end if;
  end if;
  update public.accounts set gateway_customer_id = p_customer where id = p_account and tenant_id = p_tenant;
  get diagnostics changed = row_count;
  return changed > 0;
end $$;

-- ---------------------------------------------------------------------------
-- An invoice is paid by its allocations, never by an edit (spec 08; rule 5's hold counts paid invoices)
-- ---------------------------------------------------------------------------

create or replace function app.invoices_paid_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_paid bigint;
begin
  if auth.uid() is null or new.kind <> 'invoice' then return new; end if;
  if new.paid_cents is distinct from old.paid_cents
     or (new.status is distinct from old.status and (new.status in ('paid', 'partially_paid') or old.status in ('paid', 'partially_paid'))) then
    select coalesce(sum(a.amount_cents), 0) into v_paid from public.payment_allocations a where a.invoice_id = new.id;
    if new.paid_cents <> v_paid
       or (new.status = 'paid' and v_paid < new.total_cents)
       or (new.status = 'partially_paid' and not (v_paid > 0 and v_paid < new.total_cents))
       or (new.status in ('issued', 'past_due') and v_paid > 0) then
      raise exception 'an invoice is paid by payments allocated to it' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger invoices_paid_guard before update on public.invoices for each row execute function app.invoices_paid_guard();

-- ---------------------------------------------------------------------------
-- A cancellation's date is fixed once the agreement is cancelled (rule 6's window reads it)
-- ---------------------------------------------------------------------------

create or replace function app.agreement_cancel_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and old.status = 'cancelled' and new.cancelled_on is distinct from old.cancelled_on then
    raise exception 'a cancelled agreement keeps its cancellation date' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger agreements_cancel_guard before update of cancelled_on on public.agreements for each row execute function app.agreement_cancel_guard();

-- ---------------------------------------------------------------------------
-- Commissions are earned in the signing itself (rule 4)
-- ---------------------------------------------------------------------------

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
    -- Earned in the signing itself: a plan made later, or a sale signed long ago, earns nothing after the fact.
    if g.signed_at is distinct from now() or new.earned_on <> (g.signed_at at time zone v_tz)::date then
      raise exception 'a commission is earned when the agreement is signed, in the same step' using errcode = '42501';
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


-- ---------------------------------------------------------------------------
-- The door sale keeps the customer's drawn signature (rule 3)
-- ---------------------------------------------------------------------------

alter table public.agreements add column signature_file_id uuid references public.files(id) on delete restrict;

-- ---------------------------------------------------------------------------
-- Knocks: what happened at a door stays as recorded; the list warns every rep (rule 1)
-- ---------------------------------------------------------------------------

create or replace function app.knocks_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or (app.has_permission(new.tenant_id, 'customers.write') and app.has_permission(new.tenant_id, 'users.read')) then return new; end if;
  if (new.tenant_id, new.territory_id, new.rep_id, new.address, new.normalized_address, new.outcome, new.knocked_at, new.cleared_at)
     is distinct from (old.tenant_id, old.territory_id, old.rep_id, old.address, old.normalized_address, old.outcome, old.knocked_at, old.cleared_at) then
    raise exception 'a knock keeps what happened at the door; only a manager clears a do-not-knock' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger knocks_guard before update on public.knocks for each row execute function app.knocks_guard();

-- Every rep is warned at a do-not-knock door, whoever recorded it and in whichever territory.
create or replace function app.do_not_knock(p_tenant uuid, p_normalized text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.is_member(p_tenant) and exists (
    select 1 from public.knocks k where k.tenant_id = p_tenant and k.normalized_address = p_normalized and k.outcome = 'do_not_knock' and k.cleared_at is null)
$$;
revoke all on function app.do_not_knock(uuid, text) from public;
grant execute on function app.do_not_knock(uuid, text) to authenticated;
