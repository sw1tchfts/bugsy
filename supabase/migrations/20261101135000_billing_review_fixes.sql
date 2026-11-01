-- Spec 08 review fixes. The crew at the stop writes only the invoice of their own visit and allocates the cash they took
-- only to it (rule 15); a draft can be voided with a reason like any other unpaid invoice (rule 9).

drop policy invoices_insert on public.invoices;
create policy invoices_insert on public.invoices for insert to authenticated
  with check (app.has_permission(tenant_id, 'billing.write') or app.has_permission(tenant_id, 'agreements.write')
              or (source = 'visit' and visit_id is not null and app.has_permission(tenant_id, 'visits.write')
                  and exists (select 1 from public.visit_crew c where c.visit_id = invoices.visit_id and c.user_id = auth.uid())));
drop policy invoices_update on public.invoices;
create policy invoices_update on public.invoices for update to authenticated
  using (app.has_permission(tenant_id, 'billing.write') or app.has_permission(tenant_id, 'agreements.write')
         or (source = 'visit' and visit_id is not null and app.has_permission(tenant_id, 'visits.write')
             and exists (select 1 from public.visit_crew c where c.visit_id = invoices.visit_id and c.user_id = auth.uid())))
  with check (app.has_permission(tenant_id, 'billing.write') or app.has_permission(tenant_id, 'agreements.write')
              or (source = 'visit' and visit_id is not null and app.has_permission(tenant_id, 'visits.write')
                  and exists (select 1 from public.visit_crew c where c.visit_id = invoices.visit_id and c.user_id = auth.uid())));

drop policy invoice_lines_insert on public.invoice_lines;
create policy invoice_lines_insert on public.invoice_lines for insert to authenticated
  with check (app.has_permission(tenant_id, 'billing.write') or app.has_permission(tenant_id, 'agreements.write')
              or (app.has_permission(tenant_id, 'visits.write')
                  and exists (select 1 from public.invoices i join public.visit_crew c on c.visit_id = i.visit_id
                              where i.id = invoice_lines.invoice_id and i.source = 'visit' and c.user_id = auth.uid())));
drop policy invoice_lines_update on public.invoice_lines;
create policy invoice_lines_update on public.invoice_lines for update to authenticated
  using (app.has_permission(tenant_id, 'billing.write')
         or (app.has_permission(tenant_id, 'visits.write')
             and exists (select 1 from public.invoices i join public.visit_crew c on c.visit_id = i.visit_id
                         where i.id = invoice_lines.invoice_id and i.source = 'visit' and c.user_id = auth.uid())))
  with check (app.has_permission(tenant_id, 'billing.write')
              or (app.has_permission(tenant_id, 'visits.write')
                  and exists (select 1 from public.invoices i join public.visit_crew c on c.visit_id = i.visit_id
                              where i.id = invoice_lines.invoice_id and i.source = 'visit' and c.user_id = auth.uid())));

drop policy payment_allocations_insert on public.payment_allocations;
create policy payment_allocations_insert on public.payment_allocations for insert to authenticated
  with check (app.has_permission(tenant_id, 'billing.write')
              or exists (select 1 from public.payments p join public.visit_crew c on c.visit_id = p.visit_id join public.invoices i on i.id = payment_allocations.invoice_id
                         where p.id = payment_allocations.payment_id and c.user_id = auth.uid() and i.visit_id = p.visit_id));

alter table public.invoices drop constraint invoices_issued_fields;
alter table public.invoices add constraint invoices_issued_fields
  check (status in ('draft', 'void') or (number is not null and issued_on is not null and due_on is not null));
