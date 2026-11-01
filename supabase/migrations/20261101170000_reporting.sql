-- Spec 12: saved custom reports. Every metric is computed from the operational tables and the ledger under the
-- member's session; the only stored thing is a report's definition.

create table public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  dataset text not null,
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  shared boolean not null default false,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index saved_reports_tenant on public.saved_reports (tenant_id, created_at desc);
alter table public.saved_reports enable row level security;
create trigger saved_reports_updated_at before update on public.saved_reports for each row execute function app.set_updated_at();

-- Private to the author unless shared; written by the author; owners may remove any (rule 11).
create policy saved_reports_select on public.saved_reports for select to authenticated
  using (app.has_permission(tenant_id, 'reports.read') and (shared or created_by = auth.uid()));
create policy saved_reports_insert on public.saved_reports for insert to authenticated
  with check (app.has_permission(tenant_id, 'reports.read') and created_by = auth.uid());
create policy saved_reports_update on public.saved_reports for update to authenticated
  using (app.has_permission(tenant_id, 'reports.read') and created_by = auth.uid())
  with check (app.has_permission(tenant_id, 'reports.read') and created_by = auth.uid());
create policy saved_reports_delete on public.saved_reports for delete to authenticated
  using (app.has_permission(tenant_id, 'reports.read') and (created_by = auth.uid() or app.is_owner(tenant_id)));
