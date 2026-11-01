-- The commission guard checks a member's own company's rows; a row for another company is left to row level security,
-- which refuses it (the isolation suite inserts into every tenant table as an outsider and expects that refusal).
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
  -- Jobs and the seed are trusted; another company's row is row level security's to refuse.
  if auth.uid() is null or not app.is_member(new.tenant_id) then return new; end if;
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
