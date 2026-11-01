-- Spec 08 fix: the technician app's route runs under the technician's session, which cannot read agreements, so the
-- stop never learned whether it bills per visit (cash at the door) or which agreement it belongs to. A member of the
-- visit's crew may read those two facts through this function; everyone else needs agreements.read.
create or replace function app.visit_agreement(p_visit uuid) returns table (billing_mode text, agreement_number integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.billing_mode, a.number
  from public.visits v join public.agreements a on a.id = v.agreement_id
  where v.id = p_visit
    and (auth.uid() is null
         or app.has_permission(v.tenant_id, 'agreements.read')
         or exists (select 1 from public.visit_crew c where c.visit_id = v.id and c.user_id = auth.uid()))
$$;
revoke all on function app.visit_agreement(uuid) from public;
grant execute on function app.visit_agreement(uuid) to authenticated;
