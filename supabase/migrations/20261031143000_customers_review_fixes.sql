-- Spec 02 review fixes: counters carry the standard columns, only the numbering triggers may draw numbers,
-- quote numbers always come from the counter, and a quote is sent only when every option has a line and
-- expires only after its valid-until date.

alter table public.counters
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add column created_by uuid default auth.uid();
create trigger counters_updated_at before update on public.counters for each row execute function app.set_updated_at();

-- app.next_number runs as its owner, so any signed-in user could advance another tenant's sequence by calling it
-- directly. Only the numbering triggers below (security definer) call it now; request code never does.
revoke execute on function app.next_number(uuid, text) from authenticated;

create or replace function app.assign_quote_number() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.number := app.next_number(new.tenant_id, 'quote');
  return new;
end $$;
-- The trigger runs before the constraint check, so the column can be not null again.
alter table public.quotes alter column number set not null;

create or replace function app.check_quote_status() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  tenant_today date;
begin
  if new.status = old.status then
    return new;
  end if;
  if not (
    (old.status = 'draft' and new.status = 'sent')
    or (old.status = 'sent' and new.status in ('accepted', 'declined', 'expired'))
  ) then
    raise exception 'a quote cannot move from % to %', old.status, new.status using errcode = '23514';
  end if;
  if new.status = 'sent' then
    if not exists (select 1 from public.quote_options o where o.quote_id = new.id) then
      raise exception 'a quote needs at least one option with a line before it is sent' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.quote_options o
      where o.quote_id = new.id and not exists (select 1 from public.quote_lines l where l.option_id = o.id)
    ) then
      raise exception 'every option on a quote needs at least one line before it is sent' using errcode = '23514';
    end if;
    new.sent_at := coalesce(new.sent_at, now());
  end if;
  if new.status = 'accepted' and new.accepted_option_id is null then
    raise exception 'accepting a quote needs the accepted option' using errcode = '23514';
  end if;
  if new.status = 'expired' then
    select (now() at time zone t.timezone)::date into tenant_today from public.tenants t where t.id = new.tenant_id;
    if new.valid_until is null or new.valid_until >= tenant_today then
      raise exception 'a quote expires only after its valid-until date has passed' using errcode = '23514';
    end if;
  end if;
  if new.status in ('accepted', 'declined', 'expired') then
    new.decided_at := coalesce(new.decided_at, now());
  end if;
  return new;
end $$;
