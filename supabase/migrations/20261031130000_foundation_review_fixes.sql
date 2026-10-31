-- Spec 01 review fixes. Platform admins onboard companies; they do not read tenant data (spec 01, rule 6).
-- They may see platform-level audit rows and changes to tenant records, and only the invitations they
-- created themselves (the first owner's invitation for a new company).

drop policy audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using (
    (tenant_id is not null and app.has_permission(tenant_id, 'audit.read'))
    or ((tenant_id is null or table_name = 'tenants') and app.is_platform_admin())
  );

drop policy invitations_select on public.invitations;
create policy invitations_select on public.invitations for select to authenticated
  using (
    app.has_permission(tenant_id, 'users.read')
    or app.has_permission(tenant_id, 'users.write')
    or (app.is_platform_admin() and created_by = auth.uid())
  );
