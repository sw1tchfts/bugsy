// Spec 16 seed: per company, the portal's rules, a booking form with one submission, Maria invited to the portal, an
// open re-service request from her, and Corner Bistro's manager with an active portal login. Idempotent. Called from
// seed.ts after the commercial and specialty seeds.
import type postgres from "postgres";
import { type SeedTenant, portalCustomerEmail } from "./seed-data";

type Sql = postgres.Sql;

export async function seedPortal(sql: Sql, tenant: SeedTenant, tenantId: string, bistroUserId: string): Promise<void> {
  const types = await sql<{ id: string; name: string }[]>`select id, name from public.service_types where tenant_id = ${tenantId} and archived_at is null`;
  const typeId = (name: string) => types.find((t) => t.name === name)?.id;
  const requestable = ["One-time pest treatment", "Bed bug treatment"].map(typeId).filter((x): x is string => Boolean(x));
  await sql`
    insert into public.portal_settings (tenant_id, allow_reschedule, reschedule_notice_hours, max_stops_per_day, allow_requests, requestable_service_type_ids)
    values (${tenantId}, true, 24, 18, true, ${requestable}) on conflict (tenant_id) do nothing`;

  const [form] = await sql<{ id: string; key: string }[]>`select id, key from public.lead_forms where tenant_id = ${tenantId} and name = 'Book a visit'`;
  const formRow =
    form ??
    (
      await sql<{ id: string; key: string }[]>`
        insert into public.lead_forms (tenant_id, name, service_type_ids, ask_preferred_date, thank_you)
        values (${tenantId}, 'Book a visit', ${["One-time pest treatment", "General pest plan", "Bed bug treatment"].map(typeId).filter((x): x is string => Boolean(x))}, true,
                'Thank you. We will call you within one business day to confirm a day.')
        returning id, key`
    )[0];
  const [logged] = await sql<{ n: number }[]>`select count(*)::int as n from public.intake_log where form_id = ${formRow.id}`;
  if (!logged.n) {
    await sql`select app.intake_lead(${formRow.key}::uuid, ${sql.json({
      name: "Jordan Webb",
      email: "jordan.webb@example.com",
      phone: "555-0142",
      line1: "88 Birch Lane",
      city: "Columbus",
      state_code: tenant.branches[0]?.stateCode ?? null,
      postal_code: "43215",
      service_type_id: typeId("One-time pest treatment") ?? "",
      preferred_date: null,
      arrival_window: "morning",
      message: "Ants in the kitchen and along the back patio.",
      sms_consent: true,
    })}, 'seed-ip-hash-0001')`;
  }

  const [bistro] = await sql<{ account_id: string; contact_id: string | null }[]>`
    select a.id as account_id, (select c.id from public.contacts c where c.account_id = a.id and c.archived_at is null order by c.created_at limit 1) as contact_id
    from public.accounts a where a.tenant_id = ${tenantId} and a.name = 'Corner Bistro' limit 1`;
  if (bistro) {
    await sql`
      insert into public.portal_users (tenant_id, account_id, contact_id, email, user_id, status, accepted_at)
      values (${tenantId}, ${bistro.account_id}, ${bistro.contact_id}, ${portalCustomerEmail(tenant)}, ${bistroUserId}, 'active', now())
      on conflict do nothing`;
  }

  const [maria] = await sql<{ account_id: string; property_id: string; contact_id: string | null; email: string | null; agreement_id: string | null }[]>`
    select a.id as account_id, p.id as property_id, c.id as contact_id, c.email,
           (select g.id from public.agreements g where g.property_id = p.id and g.status = 'active' order by g.starts_on desc limit 1) as agreement_id
    from public.accounts a join public.properties p on p.account_id = a.id
      left join lateral (select id, email from public.contacts where account_id = a.id and archived_at is null order by created_at limit 1) c on true
    where a.tenant_id = ${tenantId} and a.name = 'Maria Lopez' order by p.created_at limit 1`;
  if (maria?.email) {
    await sql`insert into public.portal_users (tenant_id, account_id, contact_id, email) values (${tenantId}, ${maria.account_id}, ${maria.contact_id}, ${maria.email}) on conflict do nothing`;
  }
  if (maria?.agreement_id) {
    const [open] = await sql<{ n: number }[]>`select count(*)::int as n from public.service_requests where tenant_id = ${tenantId} and account_id = ${maria.account_id}`;
    if (!open.n) {
      await sql`insert into public.service_requests (tenant_id, account_id, property_id, kind, agreement_id, details)
                values (${tenantId}, ${maria.account_id}, ${maria.property_id}, 'reservice', ${maria.agreement_id}, 'Spiders in the garage again, mostly by the side door.')`;
    }
  }
}
