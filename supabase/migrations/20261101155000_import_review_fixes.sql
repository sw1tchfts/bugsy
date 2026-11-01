-- Spec 10 review fixes. Only an import marks a visit done before Bugsy: a member needs data.import to insert one, and
-- nobody turns an existing visit into an imported one (rules 12 and 14). The first open day of the ledger is readable
-- by any member, so an import whose cutover falls in a closed month posts its opening positions on that day.

create or replace function app.guard_imported_visit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.imported and auth.uid() is not null and not app.has_permission(new.tenant_id, 'data.import') then
      raise exception 'only an import marks a visit done before Bugsy' using errcode = '42501';
    end if;
  elsif new.imported and not old.imported then
    raise exception 'only an import marks a visit done before Bugsy' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger visits_imported_guard before insert or update of imported on public.visits for each row execute function app.guard_imported_visit();

create or replace function app.first_open_day(p_tenant uuid, p_day date) returns date
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_day date := p_day;
begin
  if auth.uid() is not null and not app.is_member(p_tenant) then raise exception 'not a member of this company' using errcode = '42501'; end if;
  while exists (select 1 from public.period_closes c where c.tenant_id = p_tenant and c.period = to_char(v_day, 'YYYY-MM') and c.status = 'closed') loop
    v_day := (date_trunc('month', v_day) + interval '1 month')::date;
  end loop;
  return v_day;
end $$;
revoke all on function app.first_open_day(uuid, date) from public;
grant execute on function app.first_open_day(uuid, date) to authenticated, service_role;
