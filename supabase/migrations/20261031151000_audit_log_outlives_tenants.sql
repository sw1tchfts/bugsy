-- Tenants can be deleted. Two foundation rules made that impossible:
-- 1. Audit rows referenced the tenant, and deleting a tenant cascades through every audited table, whose delete
--    triggers write audit rows for a tenant that is already gone. Audit rows now outlive the tenant they describe
--    (platform operations, spec 13, keeps records available after a tenant leaves); row level security hides them
--    from everyone but the superuser once the tenant is gone.
-- 2. The last-owner and lead-source-in-use guards refused the cascade. They now step aside when the tenant itself
--    no longer exists, and still protect a living tenant.
alter table public.audit_log drop constraint if exists audit_log_tenant_id_fkey;

create or replace function app.protect_used_lead_source() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- The tenant is being deleted; its lead sources go with it.
  if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
    return old;
  end if;
  if exists (select 1 from public.leads l where l.source_id = old.id) then
    raise exception 'this lead source is in use; deactivate it instead' using errcode = '23503';
  end if;
  return old;
end $$;

create or replace function app.protect_last_owner() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  others integer;
begin
  if not app.role_is_owner(old.role_id) then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.tenant_id = old.tenant_id and app.role_is_owner(new.role_id) then
    return new;
  end if;
  -- The tenant is being deleted; its memberships go with it.
  if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
    return coalesce(new, old);
  end if;
  select count(*) into others from public.memberships m
  where m.tenant_id = old.tenant_id and m.id <> old.id and app.role_is_owner(m.role_id);
  if others = 0 then
    raise exception 'a tenant must keep at least one owner' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
