// Spec 11 seed: messaging settings on the local providers, one customized template, the job's first run (reminders
// for tomorrow's visits, due notices, the invoice emails billing queued), a text conversation with Maria Lopez, a STOP
// from another number, and a draft campaign, so the pages and the isolation suite have rows. Idempotent. Called last.
import type postgres from "postgres";
import { handleInbound, messagingSettings, runMessaging } from "../lib/messaging/db";
import type { SeedTenant } from "./seed-data";

type Sql = postgres.Sql;

export async function seedMessaging(sql: Sql, tenant: SeedTenant, tenantId: string): Promise<void> {
  await messagingSettings(sql, tenantId);
  await sql`
    update public.messaging_settings set company_phone = coalesce(company_phone, '(614) 555-0000'), reply_to_email = coalesce(reply_to_email, ${`office@${tenant.name.split(" ")[0].toLowerCase()}.test`}),
           review_url = coalesce(review_url, 'https://example.com/review')
    where tenant_id = ${tenantId}`;
  await sql`
    insert into public.message_templates (tenant_id, key, channel, subject, body, updated_by)
    values (${tenantId}, 'reminder', 'sms', null, '{{company_name}}: see you {{visit_date}}{{arrival_window}} for your {{service_name}} visit. Reply here with questions, STOP to opt out.', null)
    on conflict (tenant_id, key, channel) do nothing`;
  await sql.begin((tx) => runMessaging(tx, tenantId, tenant.timezone));

  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from public.messages where tenant_id = ${tenantId} and direction = 'inbound'`;
  if (n === 0) {
    await sql.begin((tx) => handleInbound(tx, { tenant_id: tenantId, from: "614-555-0100", to: null, body: "Can the tech come in the afternoon instead?", provider: "local", provider_message_id: `seed_in_${tenantId}_1` }, tenant.timezone));
    await sql.begin((tx) => handleInbound(tx, { tenant_id: tenantId, from: "614-555-0199", to: null, body: "STOP", provider: "local", provider_message_id: `seed_in_${tenantId}_2` }, tenant.timezone));
  }
  await sql`
    insert into public.campaigns (tenant_id, name, channel, subject, body, audience, created_by)
    select ${tenantId}, 'Mosquito season is coming', 'sms', null, '{{company_name}}: mosquito season starts soon. Reply YES to book your first treatment.', ${sql.json({ account_type: "residential" })}, null
    where not exists (select 1 from public.campaigns where tenant_id = ${tenantId})`;
}
