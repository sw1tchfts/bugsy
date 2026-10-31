-- Spec 03: catalog. Service types with per-state rules, the price book, the shared product master and tenant enablement.
-- A service type says what the work is; its state rules say what the work requires there; the price book says what it
-- costs; products say what gets applied. Everything downstream (agreements, dispatch, records, tax, costing) reads from here.

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The distinct states a tenant works in: its active branches and properties. Members and platform admins only.
create or replace function app.tenant_states(tenant uuid) returns setof text
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct s.state_code
  from (
    select state_code from public.branches where tenant_id = tenant and archived_at is null
    union
    select state_code from public.properties where tenant_id = tenant and archived_at is null
  ) s
  where s.state_code is not null and (app.is_member(tenant) or app.is_platform_admin())
  order by 1
$$;
revoke all on function app.tenant_states(uuid) from public;
grant execute on function app.tenant_states(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Service types and their per-state rules
-- ---------------------------------------------------------------------------

create table public.service_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_line text not null check (service_line in ('general_pest', 'rodent', 'termite', 'mosquito', 'bed_bug', 'wildlife')),
  name text not null,
  description text,
  job_kind text not null check (job_kind in (
    'recurring_treatment', 'one_time_treatment', 'inspection', 'wdi_report', 'device_service', 'termite_treatment',
    'termite_monitoring', 'bed_bug_treatment', 'trapping', 'exclusion', 'bat_exclusion', 'repair')),
  treatment_areas text[] not null default '{}' check (treatment_areas <@ array['interior', 'perimeter', 'yard', 'wood', 'devices']::text[]),
  pricing_method text not null default 'price_book' check (pricing_method in ('price_book', 'bid')),
  default_duration_minutes integer not null default 60 check (default_duration_minutes between 5 and 1440),
  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, id),
  -- Job kinds that apply pesticide need at least one treatment area; inspections, reports, trapping, exclusion and repairs may have none.
  constraint service_types_areas_for_kind check (
    job_kind in ('inspection', 'wdi_report', 'trapping', 'exclusion', 'bat_exclusion', 'repair') or cardinality(treatment_areas) > 0
  )
);
alter table public.service_types enable row level security;
create unique index service_types_tenant_name on public.service_types (tenant_id, lower(name)) where archived_at is null;
create index service_types_tenant_line on public.service_types (tenant_id, service_line);

create table public.service_type_state_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_type_id uuid not null,
  state_code text not null check (state_code ~ '^[A-Z]{2}$'),
  required_cert_categories text[] not null default '{}',
  pack_cert_categories text[] not null default '{}',
  tax_class text not null default 'unknown' check (tax_class in ('taxable', 'exempt', 'unknown')),
  pack_tax_class text not null default 'unknown' check (pack_tax_class in ('taxable', 'exempt', 'unknown')),
  pack_version text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, id),
  unique (service_type_id, state_code),
  foreign key (tenant_id, service_type_id) references public.service_types (tenant_id, id) on delete cascade,
  -- Tenants may tighten the pack's categories, never loosen them.
  constraint state_rules_never_loosen check (pack_cert_categories <@ required_cert_categories)
);
alter table public.service_type_state_rules enable row level security;

-- ---------------------------------------------------------------------------
-- Price book
-- ---------------------------------------------------------------------------

create table public.price_book_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_type_id uuid not null,
  name text not null,
  add_on boolean not null default false,
  size_basis text not null default 'none' check (size_basis in ('none', 'size_sqft', 'lot_sqft')),
  size_min integer not null default 0 check (size_min >= 0),
  size_max integer check (size_max is null or size_max > size_min),
  initial_price_cents bigint not null default 0 check (initial_price_cents >= 0),
  recurring_price_cents bigint not null default 0 check (recurring_price_cents >= 0),
  one_time_price_cents bigint not null default 0 check (one_time_price_cents >= 0),
  position integer not null default 1,
  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, id),
  foreign key (tenant_id, service_type_id) references public.service_types (tenant_id, id) on delete restrict,
  constraint price_book_none_basis check (size_basis <> 'none' or (size_min = 0 and size_max is null)),
  -- Size bands never overlap within one service type, item name and basis among active items. size_min is inclusive, size_max exclusive.
  constraint price_book_no_overlap exclude using gist (
    tenant_id with =,
    service_type_id with =,
    name with =,
    size_basis with =,
    int4range(size_min, size_max) with &&
  ) where (active and archived_at is null)
);
alter table public.price_book_items enable row level security;
create index price_book_items_tenant_type on public.price_book_items (tenant_id, service_type_id);

alter table public.quote_lines add column price_book_item_id uuid;
alter table public.quote_lines
  add constraint quote_lines_price_book_item_fk foreign key (tenant_id, price_book_item_id)
  references public.price_book_items (tenant_id, id) on delete restrict;

-- ---------------------------------------------------------------------------
-- Products: one platform master list plus tenant-added rows awaiting approval
-- ---------------------------------------------------------------------------

-- shared-table: the pesticide product master (tenant_id null) that every company reads, plus products one company added
-- (tenant_id set) that stay private and unverified until a platform admin approves them into the master list
create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  name text not null,
  manufacturer text,
  -- EPA registration number as printed on the label, or 25b-exempt for FIFRA 25(b) minimum-risk products.
  epa_reg_no text not null check (epa_reg_no ~ '^\d+-\d+(-\d+)?$' or epa_reg_no = '25b-exempt'),
  active_ingredients text[] not null default '{}',
  signal_word text not null default 'caution' check (signal_word in ('caution', 'warning', 'danger', 'none')),
  restricted_use boolean not null default false,
  rei_hours numeric check (rei_hours is null or rei_hours >= 0),
  formulation text,
  label_url text,
  sds_url text,
  label_rates jsonb not null default '[]'::jsonb check (jsonb_typeof(label_rates) = 'array'),
  verified_at timestamptz,
  verified_by uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  -- Only master rows are verified; approval clears tenant_id and sets verified_at in one update.
  constraint products_verified_is_master check (tenant_id is null or verified_at is null)
);
alter table public.products enable row level security;
create unique index products_master_epa on public.products (epa_reg_no) where tenant_id is null and epa_reg_no <> '25b-exempt';
create unique index products_tenant_epa on public.products (tenant_id, epa_reg_no) where tenant_id is not null and epa_reg_no <> '25b-exempt';
create index products_tenant_name on public.products (tenant_id, lower(name));

-- A company cannot add a number the master list already has, and approval refuses a number that reached the master list first.
create or replace function app.check_product_epa() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.epa_reg_no <> '25b-exempt'
     and exists (select 1 from public.products p where p.tenant_id is null and p.epa_reg_no = new.epa_reg_no and p.id <> new.id) then
    if new.tenant_id is not null then
      raise exception 'EPA registration number % is already in the master list; enable that product instead', new.epa_reg_no using errcode = '23514';
    elsif tg_op = 'UPDATE' and old.tenant_id is not null then
      raise exception 'EPA registration number % reached the master list first; enable that row and archive this one', new.epa_reg_no using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger products_epa before insert or update of epa_reg_no, tenant_id on public.products
  for each row execute function app.check_product_epa();

create table public.tenant_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  enabled boolean not null default true,
  unit text not null default 'fl_oz' check (unit in ('fl_oz', 'oz', 'lb', 'gal', 'ml', 'l', 'g', 'kg', 'each')),
  unit_cost_cents bigint not null default 0 check (unit_cost_cents >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, product_id)
);
alter table public.tenant_products enable row level security;

-- A company may enable a master product or one it added itself, never another company's private row.
create or replace function app.check_tenant_product() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  owner_tenant uuid;
begin
  select tenant_id into owner_tenant from public.products where id = new.product_id;
  if not found then
    raise exception 'product not found' using errcode = '23503';
  end if;
  if owner_tenant is not null and owner_tenant <> new.tenant_id then
    raise exception 'a product another company added cannot be enabled here' using errcode = '23503';
  end if;
  return new;
end $$;
create trigger tenant_products_owner before insert or update of product_id, tenant_id on public.tenant_products
  for each row execute function app.check_tenant_product();

-- ---------------------------------------------------------------------------
-- Housekeeping triggers
-- ---------------------------------------------------------------------------

create trigger service_types_updated_at before update on public.service_types for each row execute function app.set_updated_at();
create trigger service_type_state_rules_updated_at before update on public.service_type_state_rules for each row execute function app.set_updated_at();
create trigger price_book_items_updated_at before update on public.price_book_items for each row execute function app.set_updated_at();
create trigger products_updated_at before update on public.products for each row execute function app.set_updated_at();
create trigger tenant_products_updated_at before update on public.tenant_products for each row execute function app.set_updated_at();

create trigger service_types_audit after insert or update or delete on public.service_types for each row execute function app.write_audit();
create trigger service_type_state_rules_audit after insert or update or delete on public.service_type_state_rules for each row execute function app.write_audit();
create trigger price_book_items_audit after insert or update or delete on public.price_book_items for each row execute function app.write_audit();
create trigger products_audit after insert or update or delete on public.products for each row execute function app.write_audit();
create trigger tenant_products_audit after insert or update or delete on public.tenant_products for each row execute function app.write_audit();

-- ---------------------------------------------------------------------------
-- Permissions: catalog.read for every default role, catalog.write for office staff and the licensed manager
-- ---------------------------------------------------------------------------

update public.roles set permissions = permissions || array['catalog.read']
where tenant_id is null and not ('*' = any(permissions)) and not ('catalog.read' = any(permissions));
update public.roles set permissions = permissions || array['catalog.write']
where tenant_id is null and key in ('office', 'compliance_manager') and not ('catalog.write' = any(permissions));

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

create policy service_types_select on public.service_types for select to authenticated using (app.has_permission(tenant_id, 'catalog.read'));
create policy service_types_insert on public.service_types for insert to authenticated with check (app.has_permission(tenant_id, 'catalog.write'));
create policy service_types_update on public.service_types for update to authenticated using (app.has_permission(tenant_id, 'catalog.write')) with check (app.has_permission(tenant_id, 'catalog.write'));
create policy service_types_delete on public.service_types for delete to authenticated using (app.has_permission(tenant_id, 'catalog.write'));

create policy service_type_state_rules_select on public.service_type_state_rules for select to authenticated using (app.has_permission(tenant_id, 'catalog.read'));
create policy service_type_state_rules_insert on public.service_type_state_rules for insert to authenticated with check (app.has_permission(tenant_id, 'catalog.write'));
create policy service_type_state_rules_update on public.service_type_state_rules for update to authenticated using (app.has_permission(tenant_id, 'catalog.write')) with check (app.has_permission(tenant_id, 'catalog.write'));
create policy service_type_state_rules_delete on public.service_type_state_rules for delete to authenticated using (app.has_permission(tenant_id, 'catalog.write'));

create policy price_book_items_select on public.price_book_items for select to authenticated using (app.has_permission(tenant_id, 'catalog.read'));
create policy price_book_items_insert on public.price_book_items for insert to authenticated with check (app.has_permission(tenant_id, 'catalog.write'));
create policy price_book_items_update on public.price_book_items for update to authenticated using (app.has_permission(tenant_id, 'catalog.write')) with check (app.has_permission(tenant_id, 'catalog.write'));
create policy price_book_items_delete on public.price_book_items for delete to authenticated using (app.has_permission(tenant_id, 'catalog.write'));

-- Master rows: everyone signed in reads them; only platform admins write them.
-- Tenant rows: the tenant reads and edits its own while unverified; platform admins read them to approve them.
create policy products_select on public.products for select to authenticated
  using (tenant_id is null or app.has_permission(tenant_id, 'catalog.read') or app.is_platform_admin());
create policy products_insert on public.products for insert to authenticated
  with check (
    (tenant_id is null and app.is_platform_admin())
    or (tenant_id is not null and verified_at is null and app.has_permission(tenant_id, 'catalog.write'))
  );
create policy products_update on public.products for update to authenticated
  using (app.is_platform_admin() or (tenant_id is not null and app.has_permission(tenant_id, 'catalog.write')))
  with check (app.is_platform_admin() or (tenant_id is not null and verified_at is null and app.has_permission(tenant_id, 'catalog.write')));
create policy products_delete on public.products for delete to authenticated using (app.is_platform_admin());

create policy tenant_products_select on public.tenant_products for select to authenticated using (app.has_permission(tenant_id, 'catalog.read'));
create policy tenant_products_insert on public.tenant_products for insert to authenticated with check (app.has_permission(tenant_id, 'catalog.write'));
create policy tenant_products_update on public.tenant_products for update to authenticated using (app.has_permission(tenant_id, 'catalog.write')) with check (app.has_permission(tenant_id, 'catalog.write'));
create policy tenant_products_delete on public.tenant_products for delete to authenticated using (app.has_permission(tenant_id, 'catalog.write'));
