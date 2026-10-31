-- Spec 06: technician capture. What a technician records at the stop: legal times, products with amounts and sites,
-- notes, conditions, photos and the customer's signature, plus the idempotency ledger the offline queue syncs through.

alter table public.products add column upc text;
create unique index products_master_upc on public.products (upc) where tenant_id is null and upc is not null;

alter table public.memberships add column locale text not null default 'en' check (locale in ('en', 'es'));

-- A member changes their own language and nothing else on the membership (updates otherwise need users.write).
create or replace function app.set_my_locale(p_tenant_id uuid, p_locale text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  changed integer;
begin
  if auth.uid() is null then
    return false;
  end if;
  update public.memberships set locale = p_locale where tenant_id = p_tenant_id and user_id = auth.uid();
  get diagnostics changed = row_count;
  return changed > 0;
end $$;
revoke all on function app.set_my_locale(uuid, text) from public;
grant execute on function app.set_my_locale(uuid, text) to authenticated;

alter table public.visits
  add column conditions jsonb check (conditions is null or jsonb_typeof(conditions) = 'object'),
  add column areas_treated text[] not null default '{}',
  add column target_pests text[] not null default '{}',
  add column started_by uuid references auth.users(id),
  add column summary_sent_at timestamptz;

-- ---------------------------------------------------------------------------
-- Files: photos, signatures and documents. Postgres rows behind lib/files.ts until object storage takes over.
-- ---------------------------------------------------------------------------

create table public.files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('photo', 'signature', 'document')),
  content_type text not null,
  byte_size integer not null check (byte_size between 1 and 5242880),
  sha256 text not null,
  data bytea not null,
  client_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.files enable row level security;
create index files_tenant_created on public.files (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Captures
-- ---------------------------------------------------------------------------

create table public.visit_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  visit_id uuid not null,
  product_id uuid not null references public.products(id),
  applied_by uuid not null references auth.users(id),
  site_treated text not null,
  location_description text,
  amount numeric not null check (amount > 0),
  amount_unit text not null check (amount_unit in ('fl_oz', 'oz', 'lb', 'gal', 'ml', 'l', 'g', 'kg', 'each')),
  concentration_percent numeric check (concentration_percent is null or (concentration_percent >= 0 and concentration_percent <= 100)),
  carrier_amount numeric check (carrier_amount is null or carrier_amount > 0),
  carrier_unit text check (carrier_unit is null or carrier_unit in ('fl_oz', 'oz', 'lb', 'gal', 'ml', 'l', 'g', 'kg', 'sqft', 'sqm', 'acre', '1000_sqft')),
  area_treated numeric check (area_treated is null or area_treated > 0),
  area_unit text check (area_unit is null or area_unit in ('sqft', 'sqm', 'acre', 'linear_ft', 'each')),
  mix_load_site text,
  target_pests text[] not null default '{}',
  label_check jsonb not null default '{}'::jsonb,
  client_id uuid unique,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (tenant_id, visit_id) references public.visits (tenant_id, id) on delete cascade
);
alter table public.visit_products enable row level security;
create index visit_products_visit on public.visit_products (tenant_id, visit_id);

create table public.visit_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  visit_id uuid not null,
  kind text not null default 'note' check (kind in ('note', 'recommendation', 'condition_found', 'access')),
  content text not null check (length(content) > 0),
  client_id uuid unique,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (tenant_id, visit_id) references public.visits (tenant_id, id) on delete cascade
);
alter table public.visit_notes enable row level security;
create index visit_notes_visit on public.visit_notes (tenant_id, visit_id);

create table public.visit_photos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  visit_id uuid not null,
  file_id uuid not null references public.files(id) on delete restrict,
  kind text not null default 'other' check (kind in ('before', 'after', 'posting', 'device', 'other')),
  caption text,
  taken_at timestamptz not null default now(),
  client_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (tenant_id, visit_id) references public.visits (tenant_id, id) on delete cascade
);
alter table public.visit_photos enable row level security;
create index visit_photos_visit on public.visit_photos (tenant_id, visit_id);

create table public.visit_signatures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  visit_id uuid not null unique,
  file_id uuid not null references public.files(id) on delete restrict,
  signer_name text not null check (length(signer_name) > 0),
  signed_at timestamptz not null default now(),
  client_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (tenant_id, visit_id) references public.visits (tenant_id, id) on delete cascade
);
alter table public.visit_signatures enable row level security;

-- The idempotency ledger: every change a device sends is recorded once by its client id.
create table public.sync_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_change_id uuid not null unique,
  kind text not null,
  visit_id uuid,
  result text not null check (result in ('applied', 'rejected', 'duplicate')),
  detail jsonb,
  applied_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.sync_log enable row level security;
create index sync_log_user on public.sync_log (tenant_id, user_id, applied_at desc);

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

-- Captures are written by the visit's crew (or dispatch). The superuser seed and imports have no auth.uid(); a user
-- outside the company is left to row level security, which refuses the row.
create or replace function app.check_capture_author() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not app.is_member(new.tenant_id) then
    return new;
  end if;
  if exists (select 1 from public.visit_crew c where c.visit_id = new.visit_id and c.user_id = auth.uid())
     or app.has_permission(new.tenant_id, 'dispatch.write') then
    return new;
  end if;
  raise exception 'only the visit''s crew records at the stop' using errcode = '42501';
end $$;
create trigger visit_products_author before insert on public.visit_products for each row execute function app.check_capture_author();
create trigger visit_notes_author before insert on public.visit_notes for each row execute function app.check_capture_author();
create trigger visit_photos_author before insert on public.visit_photos for each row execute function app.check_capture_author();
create trigger visit_signatures_author before insert on public.visit_signatures for each row execute function app.check_capture_author();

-- A product line names a product the company enabled, applied by someone on the crew; a restricted-use product
-- only by a certified, current applicator with the service type's categories in the property's state, never a trainee.
create or replace function app.check_visit_product() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v record;
  cred record;
  required text[];
  rup boolean;
begin
  if not exists (select 1 from public.tenant_products tp where tp.tenant_id = new.tenant_id and tp.product_id = new.product_id and tp.enabled) then
    raise exception 'this product is not enabled for the company' using errcode = '23514';
  end if;
  select vi.service_type_id, vi.scheduled_for, p.state_code into v
  from public.visits vi join public.properties p on p.id = vi.property_id where vi.id = new.visit_id;
  if not exists (select 1 from public.visit_crew c where c.visit_id = new.visit_id and c.user_id = new.applied_by) then
    raise exception 'the applicator must be on the visit''s crew' using errcode = '23514';
  end if;
  select restricted_use into rup from public.products where id = new.product_id;
  if rup then
    select cert_number, categories, cert_expires_on, license_expires_on, trainee_registered_on into cred
    from public.applicator_credentials
    where tenant_id = new.tenant_id and user_id = new.applied_by and state_code = v.state_code and archived_at is null;
    if cred is null or cred.cert_number is null then
      raise exception 'a restricted-use product needs a certified applicator in %', v.state_code using errcode = '23514';
    end if;
    if cred.trainee_registered_on is not null then
      raise exception 'a trainee cannot apply a restricted-use product' using errcode = '23514';
    end if;
    if (cred.cert_expires_on is not null and cred.cert_expires_on < coalesce(v.scheduled_for, (new.recorded_at at time zone 'UTC')::date))
       or (cred.license_expires_on is not null and cred.license_expires_on < coalesce(v.scheduled_for, (new.recorded_at at time zone 'UTC')::date)) then
      raise exception 'the applicator''s credential in % is expired', v.state_code using errcode = '23514';
    end if;
    select required_cert_categories into required from public.service_type_state_rules
    where tenant_id = new.tenant_id and service_type_id = v.service_type_id and state_code = v.state_code;
    if required is not null and not (required <@ cred.categories) then
      raise exception 'the applicator lacks a certification category this work needs in %', v.state_code using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger visit_products_rules before insert or update of product_id, applied_by on public.visit_products
  for each row execute function app.check_visit_product();

-- The status machine learns the legal times: Arrived sets arrived_at and who started; Done sets departed_at.
create or replace function app.check_visit_status() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('planned', 'scheduled', 'completed') then
      raise exception 'a visit starts planned or scheduled (or completed when imported)' using errcode = '23514';
    end if;
    if new.status = 'completed' then new.completed_at := coalesce(new.completed_at, now()); end if;
  elsif new.status <> old.status then
    if not (
      (old.status = 'planned' and new.status in ('scheduled', 'cancelled', 'skipped'))
      or (old.status = 'scheduled' and new.status in ('planned', 'en_route', 'in_progress', 'completed', 'skipped', 'cancelled'))
      or (old.status = 'en_route' and new.status in ('in_progress', 'scheduled'))
      or (old.status = 'in_progress' and new.status = 'completed')
    ) then
      raise exception 'a visit cannot move from % to %', old.status, new.status using errcode = '23514';
    end if;
    if new.status not in ('planned', 'cancelled') and auth.uid() is not null
       and not (app.has_permission(new.tenant_id, 'dispatch.write') or app.has_permission(new.tenant_id, 'visits.write')) then
      raise exception 'only dispatch or a technician can move a visit to %', new.status using errcode = '42501';
    end if;
    if new.status = 'in_progress' then
      new.arrived_at := coalesce(new.arrived_at, now());
      new.started_by := coalesce(new.started_by, auth.uid());
    end if;
    if new.status = 'completed' then
      new.departed_at := coalesce(new.departed_at, now());
      new.completed_at := coalesce(new.completed_at, now());
    end if;
    if new.status = 'cancelled' then new.cancelled_at := coalesce(new.cancelled_at, now()); end if;
    if new.status = 'planned' then
      new.scheduled_for := null;
      new.technician_id := null;
      new.route_position := null;
    end if;
  end if;
  if new.status = 'scheduled' and (new.scheduled_for is null or new.technician_id is null) then
    raise exception 'a scheduled visit needs a date and a lead technician' using errcode = '23514';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Housekeeping and policies
-- ---------------------------------------------------------------------------

create trigger files_updated_at before update on public.files for each row execute function app.set_updated_at();
create trigger visit_products_updated_at before update on public.visit_products for each row execute function app.set_updated_at();
create trigger visit_notes_updated_at before update on public.visit_notes for each row execute function app.set_updated_at();
create trigger visit_photos_updated_at before update on public.visit_photos for each row execute function app.set_updated_at();
create trigger visit_signatures_updated_at before update on public.visit_signatures for each row execute function app.set_updated_at();
create trigger visit_products_audit after insert or update or delete on public.visit_products for each row execute function app.write_audit();
create trigger visit_signatures_audit after insert or update or delete on public.visit_signatures for each row execute function app.write_audit();

create policy files_select on public.files for select to authenticated
  using (app.has_permission(tenant_id, 'visits.read') or app.has_permission(tenant_id, 'dispatch.read') or app.has_permission(tenant_id, 'agreements.read')
         or app.has_permission(tenant_id, 'compliance.read') or (created_by = auth.uid() and app.is_member(tenant_id)));
create policy files_insert on public.files for insert to authenticated
  with check (app.has_permission(tenant_id, 'visits.write') or app.has_permission(tenant_id, 'dispatch.write') or app.has_permission(tenant_id, 'compliance.write'));
create policy files_update on public.files for update to authenticated using (app.has_permission(tenant_id, 'compliance.write')) with check (app.has_permission(tenant_id, 'compliance.write'));
create policy files_delete on public.files for delete to authenticated using (app.has_permission(tenant_id, 'compliance.write'));

create policy visit_products_select on public.visit_products for select to authenticated
  using (app.has_permission(tenant_id, 'visits.read') or app.has_permission(tenant_id, 'dispatch.read') or app.has_permission(tenant_id, 'agreements.read') or app.has_permission(tenant_id, 'compliance.read'));
create policy visit_products_insert on public.visit_products for insert to authenticated with check (app.has_permission(tenant_id, 'visits.write') or app.has_permission(tenant_id, 'dispatch.write'));
create policy visit_products_update on public.visit_products for update to authenticated using (app.has_permission(tenant_id, 'visits.write')) with check (app.has_permission(tenant_id, 'visits.write'));
create policy visit_products_delete on public.visit_products for delete to authenticated using (app.has_permission(tenant_id, 'visits.write'));

create policy visit_notes_select on public.visit_notes for select to authenticated
  using (app.has_permission(tenant_id, 'visits.read') or app.has_permission(tenant_id, 'dispatch.read') or app.has_permission(tenant_id, 'agreements.read') or app.has_permission(tenant_id, 'compliance.read'));
create policy visit_notes_insert on public.visit_notes for insert to authenticated with check (app.has_permission(tenant_id, 'visits.write') or app.has_permission(tenant_id, 'dispatch.write'));
create policy visit_notes_update on public.visit_notes for update to authenticated using (app.has_permission(tenant_id, 'visits.write')) with check (app.has_permission(tenant_id, 'visits.write'));
create policy visit_notes_delete on public.visit_notes for delete to authenticated using (app.has_permission(tenant_id, 'visits.write'));

create policy visit_photos_select on public.visit_photos for select to authenticated
  using (app.has_permission(tenant_id, 'visits.read') or app.has_permission(tenant_id, 'dispatch.read') or app.has_permission(tenant_id, 'agreements.read') or app.has_permission(tenant_id, 'compliance.read'));
create policy visit_photos_insert on public.visit_photos for insert to authenticated with check (app.has_permission(tenant_id, 'visits.write') or app.has_permission(tenant_id, 'dispatch.write'));
create policy visit_photos_update on public.visit_photos for update to authenticated using (app.has_permission(tenant_id, 'visits.write')) with check (app.has_permission(tenant_id, 'visits.write'));
create policy visit_photos_delete on public.visit_photos for delete to authenticated using (app.has_permission(tenant_id, 'visits.write'));

create policy visit_signatures_select on public.visit_signatures for select to authenticated
  using (app.has_permission(tenant_id, 'visits.read') or app.has_permission(tenant_id, 'dispatch.read') or app.has_permission(tenant_id, 'agreements.read') or app.has_permission(tenant_id, 'compliance.read'));
create policy visit_signatures_insert on public.visit_signatures for insert to authenticated with check (app.has_permission(tenant_id, 'visits.write'));
create policy visit_signatures_update on public.visit_signatures for update to authenticated using (app.has_permission(tenant_id, 'compliance.write')) with check (app.has_permission(tenant_id, 'compliance.write'));
create policy visit_signatures_delete on public.visit_signatures for delete to authenticated using (app.has_permission(tenant_id, 'compliance.write'));

create policy sync_log_select on public.sync_log for select to authenticated
  using ((user_id = auth.uid() and app.is_member(tenant_id)) or app.has_permission(tenant_id, 'dispatch.read'));
create policy sync_log_insert on public.sync_log for insert to authenticated with check (user_id = auth.uid() and app.is_member(tenant_id));
