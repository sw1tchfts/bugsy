-- Spec 03 review fixes: minimum-risk (25(b)) products, which carry no EPA registration number, are unique by name and
-- manufacturer the way registered products are unique by number; and the platform console can count how many
-- companies enabled a product without reading their rows.

create unique index products_master_exempt_name on public.products (lower(name), lower(coalesce(manufacturer, '')))
  where tenant_id is null and epa_reg_no = '25b-exempt' and archived_at is null;
create unique index products_tenant_exempt_name on public.products (tenant_id, lower(name), lower(coalesce(manufacturer, '')))
  where tenant_id is not null and epa_reg_no = '25b-exempt' and archived_at is null;

-- Same rule as registered numbers: a company cannot add what the master list has, and approval refuses a row the
-- master list got first. Minimum-risk products match on name and manufacturer.
create or replace function app.check_product_epa() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (
    select 1 from public.products p
    where p.tenant_id is null and p.id <> new.id and p.archived_at is null
      and (
        (new.epa_reg_no <> '25b-exempt' and p.epa_reg_no = new.epa_reg_no)
        or (new.epa_reg_no = '25b-exempt' and p.epa_reg_no = '25b-exempt'
            and lower(p.name) = lower(new.name) and lower(coalesce(p.manufacturer, '')) = lower(coalesce(new.manufacturer, '')))
      )
  ) then
    if new.tenant_id is not null then
      raise exception '% is already in the master list; enable that product instead', case when new.epa_reg_no = '25b-exempt' then new.name else new.epa_reg_no end using errcode = '23514';
    elsif tg_op = 'UPDATE' and old.tenant_id is not null then
      raise exception '% reached the master list first; enable that row and archive this one', case when new.epa_reg_no = '25b-exempt' then new.name else new.epa_reg_no end using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists products_epa on public.products;
create trigger products_epa before insert or update of epa_reg_no, tenant_id, name, manufacturer on public.products
  for each row execute function app.check_product_epa();

-- How many companies enabled a product: a number for platform admins, never the rows.
create or replace function app.product_enabled_by(product uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when app.is_platform_admin() then (select count(*)::int from public.tenant_products tp where tp.product_id = product and tp.enabled)
    else 0
  end
$$;
revoke all on function app.product_enabled_by(uuid) from public;
grant execute on function app.product_enabled_by(uuid) to authenticated, service_role;
