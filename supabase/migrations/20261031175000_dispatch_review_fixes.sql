-- Spec 05 review fixes: dispatch reads the catalog it checks against, and a licensed manager can confirm state rules.
-- Dispatchers need service types and state rules to build the board and run the check (rule 11); confirming a
-- state rule is compliance work, not catalog editing (rule 3).

drop policy service_types_select on public.service_types;
create policy service_types_select on public.service_types for select to authenticated
  using (app.has_permission(tenant_id, 'catalog.read') or app.has_permission(tenant_id, 'dispatch.read'));

drop policy service_type_state_rules_select on public.service_type_state_rules;
create policy service_type_state_rules_select on public.service_type_state_rules for select to authenticated
  using (app.has_permission(tenant_id, 'catalog.read') or app.has_permission(tenant_id, 'dispatch.read') or app.has_permission(tenant_id, 'compliance.read'));

drop policy service_type_state_rules_update on public.service_type_state_rules;
create policy service_type_state_rules_update on public.service_type_state_rules for update to authenticated
  using (app.has_permission(tenant_id, 'catalog.write') or app.has_permission(tenant_id, 'compliance.write'))
  with check (app.has_permission(tenant_id, 'catalog.write') or app.has_permission(tenant_id, 'compliance.write'));
