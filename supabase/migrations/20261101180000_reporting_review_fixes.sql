-- Spec 12 review fix: an owner deletes their own reports and the shared ones, never another member's private report.
-- The old policy let an unfiltered delete (no WHERE, so no select policy) remove private reports the owner cannot see.
drop policy saved_reports_delete on public.saved_reports;
create policy saved_reports_delete on public.saved_reports for delete to authenticated
  using (app.has_permission(tenant_id, 'reports.read') and (created_by = auth.uid() or (shared and app.is_owner(tenant_id))));
