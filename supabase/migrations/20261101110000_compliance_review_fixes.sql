-- Spec 07 review fixes: the database matches rule 11. Waiving a notice and closing or dismissing a task belong to
-- compliance.write; dispatch.write still records registry advance notices and proof, and raises tasks through the job.

drop policy notices_update on public.notices;
create policy notices_update on public.notices for update to authenticated
  using (app.has_permission(tenant_id, 'compliance.write') or app.has_permission(tenant_id, 'dispatch.write'))
  with check ((status <> 'waived' and app.has_permission(tenant_id, 'dispatch.write')) or app.has_permission(tenant_id, 'compliance.write'));

drop policy compliance_tasks_insert on public.compliance_tasks;
create policy compliance_tasks_insert on public.compliance_tasks for insert to authenticated with check (app.has_permission(tenant_id, 'compliance.write'));
drop policy compliance_tasks_update on public.compliance_tasks;
create policy compliance_tasks_update on public.compliance_tasks for update to authenticated
  using (app.has_permission(tenant_id, 'compliance.write')) with check (app.has_permission(tenant_id, 'compliance.write'));
