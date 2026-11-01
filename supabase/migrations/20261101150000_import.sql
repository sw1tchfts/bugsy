-- Spec 10: spreadsheet import. Old-system ids on what an import creates, mid-term agreements that start billing at the
-- cutover with the visits already done marked as imported, opening invoices for what customers owed, and the batches
-- with their files kept for the retention period.

alter table public.accounts add column external_id text;
alter table public.properties add column external_id text;
alter table public.contacts add column external_id text;
alter table public.agreements add column external_id text;
create unique index accounts_external_id on public.accounts (tenant_id, external_id) where external_id is not null;
create unique index properties_external_id on public.properties (tenant_id, external_id) where external_id is not null;
create unique index contacts_external_id on public.contacts (tenant_id, external_id) where external_id is not null;
create unique index agreements_external_id on public.agreements (tenant_id, external_id) where external_id is not null;

-- An imported agreement: Bugsy bills from the cutover; the old system billed imported_billed_cents before it.
alter table public.agreements add column cutover_on date;
alter table public.agreements add column imported_billed_cents bigint check (imported_billed_cents is null or imported_billed_cents >= 0);
alter table public.agreements add column import_batch_id uuid;

-- A visit done before Bugsy: completed, with no times, no record, no invoice and no revenue posting (rule 12).
alter table public.visits add column imported boolean not null default false;
alter table public.visits add constraint visits_imported_completed check (not imported or status = 'completed');

-- Only an imported visit is inserted completed, and it keeps no times and never moves.
create or replace function app.check_visit_status() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('planned', 'scheduled', 'completed') or (new.status = 'completed' and not new.imported) then
      raise exception 'a visit starts planned or scheduled (or completed when imported)' using errcode = '23514';
    end if;
    -- A visit done before Bugsy has no times of its own: its record is in the old system's files (spec 10 rule 12).
    if new.imported then
      new.arrived_at := null;
      new.departed_at := null;
      new.completed_at := null;
    end if;
  elsif old.imported and (new.status <> old.status or not new.imported) then
    raise exception 'a visit done before Bugsy stays as imported' using errcode = '23514';
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
    if new.status in ('en_route', 'in_progress', 'completed') and auth.uid() is not null
       and not (new.technician_id = auth.uid() or exists (select 1 from public.visit_crew c where c.visit_id = new.id and c.user_id = auth.uid())) then
      raise exception 'only the visit''s crew moves it to %', new.status using errcode = '42501';
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


-- Opening receivables are invoices of their own source, posted against opening balance equity (rule 11).
alter table public.invoices drop constraint invoices_source_check;
alter table public.invoices add constraint invoices_source_check check (source in ('visit', 'installment', 'prepay', 'settlement', 'late_fee', 'manual', 'opening'));
alter table public.invoices add column external_ref text;
alter table public.invoice_lines drop constraint invoice_lines_kind_check;
alter table public.invoice_lines add constraint invoice_lines_kind_check check (kind in ('service', 'fee', 'late_fee', 'opening'));

-- Uploaded spreadsheets and old records are files of their own kind, up to 20 MB.
alter table public.files drop constraint files_kind_check;
alter table public.files add constraint files_kind_check check (kind in ('photo', 'signature', 'document', 'import'));
alter table public.files drop constraint files_byte_size_check;
alter table public.files add constraint files_byte_size_check check (byte_size >= 1 and byte_size <= case when kind = 'import' then 20971520 else 5242880 end);
drop policy files_insert on public.files;
create policy files_insert on public.files for insert to authenticated
  with check (app.has_permission(tenant_id, 'visits.write') or app.has_permission(tenant_id, 'dispatch.write') or app.has_permission(tenant_id, 'compliance.write')
              or (kind = 'import' and app.has_permission(tenant_id, 'data.import')));
drop policy files_select on public.files;
create policy files_select on public.files for select to authenticated
  using (app.has_permission(tenant_id, 'visits.read') or app.has_permission(tenant_id, 'dispatch.read') or app.has_permission(tenant_id, 'agreements.read')
         or app.has_permission(tenant_id, 'compliance.read') or (kind = 'import' and app.has_permission(tenant_id, 'data.import'))
         or (created_by = auth.uid() and app.is_member(tenant_id)));

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  status text not null check (status in ('dry_run', 'committed', 'failed')),
  cutover_on date not null,
  summary jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index import_batches_tenant on public.import_batches (tenant_id, created_at desc);
alter table public.import_batches enable row level security;
-- The batch row is written last in the import's own transaction, with the final report, so the reference waits for commit.
alter table public.agreements add constraint agreements_import_batch foreign key (tenant_id, import_batch_id) references public.import_batches (tenant_id, id) deferrable initially deferred;

create table public.import_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  batch_id uuid not null,
  file_id uuid not null references public.files(id),
  kind text not null check (kind in ('template', 'history')),
  file_name text not null,
  label text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, batch_id) references public.import_batches (tenant_id, id) on delete cascade
);
create index import_files_batch on public.import_files (tenant_id, batch_id);
alter table public.import_files enable row level security;

-- Batches and their files are the importer's; history files are also the licensed manager's to read.
create policy import_batches_select on public.import_batches for select to authenticated
  using (app.has_permission(tenant_id, 'data.import') or app.has_permission(tenant_id, 'compliance.read'));
create policy import_batches_insert on public.import_batches for insert to authenticated with check (app.has_permission(tenant_id, 'data.import'));
create policy import_files_select on public.import_files for select to authenticated
  using (app.has_permission(tenant_id, 'data.import') or (kind = 'history' and app.has_permission(tenant_id, 'compliance.read')));
create policy import_files_insert on public.import_files for insert to authenticated with check (app.has_permission(tenant_id, 'data.import'));

-- Batches are a record of what happened; they never change.
create or replace function app.protect_import_batch() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'import batches never change' using errcode = '23514';
end $$;
create trigger import_batches_protect before update or delete on public.import_batches for each row when (pg_trigger_depth() = 0) execute function app.protect_import_batch();
