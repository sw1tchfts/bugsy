-- Spec 07: compliance. Application records locked from the visit, amendments, the notice obligations with their
-- proof, notification registries matched to properties, and the tasks that raise credential and license alerts.
-- Nothing here names a state: due times, lock times and retention come from the state's rule pack in the app.

alter table public.branches add column license_expires_on date;

-- ---------------------------------------------------------------------------
-- Application records: a snapshot of the visit, locked when the pack says the record must be complete.
-- Records, amendments and notices restrict tenant deletion: spec 13 exports them first.
-- ---------------------------------------------------------------------------

create table public.application_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  visit_id uuid not null unique,
  state_code text not null check (state_code ~ '^[A-Z]{2}$'),
  pack_version text,
  job_kind text not null,
  business_date date not null,
  arrived_at timestamptz,
  departed_at timestamptz,
  required_fields text[] not null default '{}',
  missing_fields text[] not null default '{}',
  complete boolean not null default false,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  status text not null default 'draft' check (status in ('draft', 'locked')),
  lock_due_at timestamptz not null,
  locked_at timestamptz,
  locked_by uuid references auth.users(id),
  retention_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (tenant_id, visit_id) references public.visits (tenant_id, id) on delete restrict,
  constraint records_locked_fields check ((status = 'locked') = (locked_at is not null))
);
alter table public.application_records enable row level security;
create index application_records_tenant_date on public.application_records (tenant_id, business_date desc);
create index application_records_due on public.application_records (tenant_id, lock_due_at) where status = 'draft';

create table public.application_record_amendments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  record_id uuid not null references public.application_records(id) on delete restrict,
  changed_fields jsonb not null check (jsonb_typeof(changed_fields) = 'object' and changed_fields <> '{}'::jsonb),
  reason text not null check (length(trim(reason)) > 0),
  author_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.application_record_amendments enable row level security;
create index amendments_record on public.application_record_amendments (tenant_id, record_id, created_at);

-- ---------------------------------------------------------------------------
-- Notices: every obligation as a row with a due time, a permitted channel and proof.
-- ---------------------------------------------------------------------------

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  kind text not null check (kind in ('post_application', 'pre_application_offer', 'resident_notice', 'posting_sign', 'registry_advance', 'other')),
  rule_key text not null default 'default',
  -- One obligation, one row: the engine names each notice it derives and the job inserts it at most once.
  dedupe_key text not null,
  required boolean not null default false,
  visit_id uuid,
  agreement_id uuid,
  property_id uuid not null,
  unit_id uuid,
  recipient_contact_id uuid references public.contacts(id) on delete set null,
  recipient_name text not null,
  recipient_address text,
  recipient_email text,
  recipient_phone text,
  channel text not null check (channel in ('email', 'sms', 'print', 'mail', 'phone', 'posted')),
  due_by timestamptz,
  for_scheduled_for date,
  status text not null default 'due' check (status in ('due', 'sent', 'failed', 'waived')),
  sent_at timestamptz,
  proof jsonb not null default '{}'::jsonb check (jsonb_typeof(proof) = 'object'),
  content_file_id uuid references public.files(id) on delete restrict,
  waived_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (tenant_id, visit_id) references public.visits (tenant_id, id) on delete restrict,
  foreign key (tenant_id, agreement_id) references public.agreements (tenant_id, id) on delete restrict,
  foreign key (tenant_id, property_id) references public.properties (tenant_id, id) on delete restrict,
  unique (tenant_id, dedupe_key),
  constraint notices_sent_fields check (status <> 'sent' or sent_at is not null),
  constraint notices_waived_reason check (status <> 'waived' or (waived_reason is not null and length(trim(waived_reason)) > 0))
);
alter table public.notices enable row level security;
create index notices_tenant_due on public.notices (tenant_id, status, due_by);
create index notices_visit on public.notices (tenant_id, visit_id);
create index notices_property on public.notices (tenant_id, property_id);

-- ---------------------------------------------------------------------------
-- Notification registries: people who must get advance notice before nearby applications, imported per state.
-- ---------------------------------------------------------------------------

create table public.notification_registries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  state_code text not null check (state_code ~ '^[A-Z]{2}$'),
  registry_kind text not null default 'general',
  registry_year integer not null check (registry_year between 2000 and 2100),
  name text,
  line1 text not null,
  line2 text,
  city text not null,
  postal_code text not null,
  normalized_address text not null,
  contact_name text,
  phone text,
  email text,
  notes text,
  source_file_id uuid references public.files(id) on delete set null,
  imported_at timestamptz not null default now(),
  row_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, state_code, registry_kind, registry_year, row_hash)
);
alter table public.notification_registries enable row level security;
create index registries_address on public.notification_registries (tenant_id, state_code, normalized_address);

-- ---------------------------------------------------------------------------
-- Compliance tasks: what the licensed manager must look at, raised by the job and closed by people.
-- ---------------------------------------------------------------------------

create table public.compliance_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('credential_expiring', 'license_expiring', 'record_incomplete', 'notice_overdue', 'registry_notice_due')),
  subject_table text not null,
  subject_id uuid not null,
  due_on date not null,
  title text not null,
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  done_at timestamptz,
  done_by uuid references auth.users(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, kind, subject_id, due_on)
);
alter table public.compliance_tasks enable row level security;
create index compliance_tasks_open on public.compliance_tasks (tenant_id, status, due_on);

-- Every inspector export is logged (and so audited) with its range and who ran it.
create table public.compliance_exports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  from_date date not null,
  to_date date not null,
  state_code text check (state_code is null or state_code ~ '^[A-Z]{2}$'),
  file_count integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.compliance_exports enable row level security;

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

-- A locked record never changes; corrections are amendment rows.
create or replace function app.protect_locked_record() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'locked' then
      raise exception 'locked records change only by amendment' using errcode = '23514';
    end if;
    return old;
  end if;
  if old.status = 'locked' then
    raise exception 'locked records change only by amendment' using errcode = '23514';
  end if;
  if new.status = 'locked' then
    new.locked_at := coalesce(new.locked_at, now());
  end if;
  return new;
end $$;
create trigger application_records_locked before update or delete on public.application_records for each row execute function app.protect_locked_record();

-- Amendments are appended by compliance.write to locked records and never edited.
create or replace function app.check_amendment() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'amendments are append only' using errcode = '23514';
  end if;
  if not exists (select 1 from public.application_records r where r.id = new.record_id and r.tenant_id = new.tenant_id and r.status = 'locked') then
    raise exception 'only a locked record takes amendments; a draft is re-snapshotted instead' using errcode = '23514';
  end if;
  if auth.uid() is not null then
    new.author_id := auth.uid();
  end if;
  return new;
end $$;
create trigger amendments_check before insert or update or delete on public.application_record_amendments for each row execute function app.check_amendment();

-- A notice's proof is immutable once it is sent; status moves due -> sent | failed | waived, failed -> due | sent.
create or replace function app.check_notice() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'sent' then
      raise exception 'a sent notice is kept as proof' using errcode = '23514';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'sent' then
      raise exception 'a sent notice is kept as proof' using errcode = '23514';
    end if;
    if old.status = 'waived' and new.status <> 'waived' then
      raise exception 'a waived notice stays waived' using errcode = '23514';
    end if;
  end if;
  if new.status = 'sent' then
    new.sent_at := coalesce(new.sent_at, now());
  end if;
  return new;
end $$;
create trigger notices_check before insert or update or delete on public.notices for each row execute function app.check_notice();

-- Registry matching: a property's registry_matches is {"<kind>": [registry row ids]} for its normalized address in its
-- state. Security definer, because the office member saving a property need not be able to read registries.
create or replace function app.registry_matches_for(p_tenant uuid, p_state text, p_address text) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(kind, ids), '{}'::jsonb)
  from (
    select r.registry_kind as kind, jsonb_agg(r.id order by r.id) as ids
    from public.notification_registries r
    where r.tenant_id = p_tenant and r.state_code = p_state and r.normalized_address = p_address
    group by r.registry_kind
  ) m
$$;
revoke all on function app.registry_matches_for(uuid, text, text) from public;

create or replace function app.match_property_registries() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.registry_matches := app.registry_matches_for(new.tenant_id, new.state_code, new.normalized_address);
  return new;
end $$;
create trigger properties_registry_match before insert or update of normalized_address, state_code on public.properties
  for each row execute function app.match_property_registries();

-- After an import, every property in that state is matched again. Callable by compliance.write members and the job.
create or replace function app.rematch_registry_state(p_tenant uuid, p_state text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  changed integer;
begin
  if auth.uid() is not null and not app.has_permission(p_tenant, 'compliance.write') then
    raise exception 'registry matching needs compliance.write' using errcode = '42501';
  end if;
  update public.properties p
  set registry_matches = app.registry_matches_for(p.tenant_id, p.state_code, p.normalized_address)
  where p.tenant_id = p_tenant and p.state_code = p_state
    and p.registry_matches is distinct from app.registry_matches_for(p.tenant_id, p.state_code, p.normalized_address);
  get diagnostics changed = row_count;
  return changed;
end $$;
revoke all on function app.rematch_registry_state(uuid, text) from public;
grant execute on function app.rematch_registry_state(uuid, text) to authenticated;

-- The licensed manager keeps the branch's business license without owning branch settings.
create or replace function app.set_branch_license(p_tenant uuid, p_branch uuid, p_number text, p_year integer, p_expires date) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  changed integer;
begin
  if auth.uid() is not null and not app.has_permission(p_tenant, 'compliance.write') then
    raise exception 'branch licenses need compliance.write' using errcode = '42501';
  end if;
  update public.branches set business_license_number = p_number, license_year = p_year, license_expires_on = p_expires
  where id = p_branch and tenant_id = p_tenant;
  get diagnostics changed = row_count;
  return changed > 0;
end $$;
revoke all on function app.set_branch_license(uuid, uuid, text, integer, date) from public;
grant execute on function app.set_branch_license(uuid, uuid, text, integer, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Housekeeping and policies
-- ---------------------------------------------------------------------------

create trigger application_records_updated_at before update on public.application_records for each row execute function app.set_updated_at();
create trigger notices_updated_at before update on public.notices for each row execute function app.set_updated_at();
create trigger notification_registries_updated_at before update on public.notification_registries for each row execute function app.set_updated_at();
create trigger compliance_tasks_updated_at before update on public.compliance_tasks for each row execute function app.set_updated_at();
create trigger application_records_audit after insert or update or delete on public.application_records for each row execute function app.write_audit();
create trigger amendments_audit after insert or update or delete on public.application_record_amendments for each row execute function app.write_audit();
create trigger notices_audit after insert or update or delete on public.notices for each row execute function app.write_audit();
create trigger notification_registries_audit after insert or update or delete on public.notification_registries for each row execute function app.write_audit();
create trigger compliance_tasks_audit after insert or update or delete on public.compliance_tasks for each row execute function app.write_audit();

create policy application_records_select on public.application_records for select to authenticated
  using (app.has_permission(tenant_id, 'compliance.read') or app.has_permission(tenant_id, 'dispatch.write') or app.has_permission(tenant_id, 'agreements.read')
         or exists (select 1 from public.visit_crew c where c.visit_id = application_records.visit_id and c.user_id = auth.uid()));
create policy application_records_insert on public.application_records for insert to authenticated
  with check (app.has_permission(tenant_id, 'compliance.write') or app.has_permission(tenant_id, 'visits.write') or app.has_permission(tenant_id, 'dispatch.write'));
create policy application_records_update on public.application_records for update to authenticated
  using (app.has_permission(tenant_id, 'compliance.write')) with check (app.has_permission(tenant_id, 'compliance.write'));

create policy amendments_select on public.application_record_amendments for select to authenticated
  using (app.has_permission(tenant_id, 'compliance.read') or app.has_permission(tenant_id, 'dispatch.write') or app.has_permission(tenant_id, 'agreements.read')
         or exists (select 1 from public.application_records r join public.visit_crew c on c.visit_id = r.visit_id
                    where r.id = application_record_amendments.record_id and c.user_id = auth.uid()));
create policy amendments_insert on public.application_record_amendments for insert to authenticated
  with check (app.has_permission(tenant_id, 'compliance.write'));

create policy notices_select on public.notices for select to authenticated
  using (app.has_permission(tenant_id, 'compliance.read') or app.has_permission(tenant_id, 'dispatch.write') or app.has_permission(tenant_id, 'agreements.read')
         or exists (select 1 from public.visit_crew c where c.visit_id = notices.visit_id and c.user_id = auth.uid()));
create policy notices_insert on public.notices for insert to authenticated
  with check (app.has_permission(tenant_id, 'compliance.write') or app.has_permission(tenant_id, 'dispatch.write') or app.has_permission(tenant_id, 'visits.write'));
create policy notices_update on public.notices for update to authenticated
  using (app.has_permission(tenant_id, 'compliance.write') or app.has_permission(tenant_id, 'dispatch.write'))
  with check (app.has_permission(tenant_id, 'compliance.write') or app.has_permission(tenant_id, 'dispatch.write'));

create policy registries_select on public.notification_registries for select to authenticated
  using (app.has_permission(tenant_id, 'compliance.read') or app.has_permission(tenant_id, 'dispatch.write'));
create policy registries_insert on public.notification_registries for insert to authenticated with check (app.has_permission(tenant_id, 'compliance.write'));
create policy registries_update on public.notification_registries for update to authenticated
  using (app.has_permission(tenant_id, 'compliance.write')) with check (app.has_permission(tenant_id, 'compliance.write'));
create policy registries_delete on public.notification_registries for delete to authenticated using (app.has_permission(tenant_id, 'compliance.write'));

create policy compliance_tasks_select on public.compliance_tasks for select to authenticated
  using (app.has_permission(tenant_id, 'compliance.read') or app.has_permission(tenant_id, 'dispatch.write'));
create policy compliance_tasks_insert on public.compliance_tasks for insert to authenticated
  with check (app.has_permission(tenant_id, 'compliance.write') or app.has_permission(tenant_id, 'dispatch.write'));
create policy compliance_tasks_update on public.compliance_tasks for update to authenticated
  using (app.has_permission(tenant_id, 'compliance.write') or app.has_permission(tenant_id, 'dispatch.write'))
  with check (app.has_permission(tenant_id, 'compliance.write') or app.has_permission(tenant_id, 'dispatch.write'));
create policy compliance_tasks_delete on public.compliance_tasks for delete to authenticated using (app.has_permission(tenant_id, 'compliance.write'));

create trigger compliance_exports_updated_at before update on public.compliance_exports for each row execute function app.set_updated_at();
create trigger compliance_exports_audit after insert or update or delete on public.compliance_exports for each row execute function app.write_audit();
create policy compliance_exports_select on public.compliance_exports for select to authenticated using (app.has_permission(tenant_id, 'compliance.read'));
create policy compliance_exports_insert on public.compliance_exports for insert to authenticated with check (app.has_permission(tenant_id, 'compliance.write'));
