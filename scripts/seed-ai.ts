// Spec 21 seed: AI settings, a few usage rows, a plan at risk (Green Residence wrote in about cancelling and rated a
// visit low), churn scores for every active plan, portal questions (one answered, one waiting for the office), and a
// technician's note for the customer on a completed visit. Idempotent.
import type postgres from "postgres";
import { scoreChurn } from "../lib/ai/churn-db";
import { todayInZone } from "../lib/dates";
import type { SeedTenant } from "./seed-data";

type Sql = postgres.Sql;

export async function seedAi(sql: Sql, tenant: SeedTenant, tenantId: string): Promise<void> {
  await sql`insert into public.ai_settings (tenant_id) values (${tenantId}) on conflict (tenant_id) do nothing`;
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from public.ai_runs where tenant_id = ${tenantId}`;
  if (n === 0) {
    await sql`
      insert into public.ai_runs (tenant_id, feature, provider, model, status, ms, created_at)
      values (${tenantId}, 'summary', 'local', 'local', 'ok', 4, now() - interval '2 days'),
             (${tenantId}, 'portal_answer', 'local', 'local', 'ok', 3, now() - interval '1 day')`;
  }

  // A plan at risk: an unhappy message and a low survey on Green Residence.
  const [green] = await sql<{ id: string; visit_id: string | null }[]>`
    select a.id, (select v.id from public.visits v where v.account_id = a.id and v.status = 'completed'
             and not exists (select 1 from public.surveys s where s.visit_id = v.id) order by v.completed_at desc limit 1) as visit_id
    from public.accounts a where a.tenant_id = ${tenantId} and a.name = 'Green Residence'`;
  if (green) {
    const [{ m }] = await sql<{ m: number }[]>`select count(*)::int as m from public.messages where tenant_id = ${tenantId} and account_id = ${green.id} and body like 'Still seeing ants%'`;
    if (m === 0) {
      await sql`
        insert into public.messages (tenant_id, account_id, direction, channel, purpose, to_address, from_address, body, status, created_at)
        values (${tenantId}, ${green.id}, 'inbound', 'sms', 'inbound', '+15555550100', '+16145550141', 'Still seeing ants in the kitchen. Thinking about cancelling if this keeps up.', 'received', now() - interval '5 days')`;
    }
    if (green.visit_id) {
      await sql`
        insert into public.surveys (tenant_id, visit_id, account_id, token, score, comment, sent_at, responded_at)
        values (${tenantId}, ${green.visit_id}, ${green.id}, gen_random_uuid(), 4, 'Ants came back a week later.', now() - interval '20 days', now() - interval '19 days')
        on conflict do nothing`;
    }
  }
  await scoreChurn(sql, tenantId, todayInZone(tenant.timezone), true);

  // Portal questions from the company's active portal login.
  const [login] = await sql<{ id: string; account_id: string }[]>`
    select id, account_id from public.portal_users where tenant_id = ${tenantId} and status = 'active' order by created_at limit 1`;
  if (login) {
    const [{ q }] = await sql<{ q: number }[]>`select count(*)::int as q from public.portal_questions where tenant_id = ${tenantId}`;
    if (q === 0) {
      await sql`
        insert into public.portal_questions (tenant_id, account_id, portal_user_id, question, answer, status, created_at)
        values (${tenantId}, ${login.account_id}, ${login.id}, 'When is my next visit?', 'Your next visit is on the schedule under Next visits.', 'answered', now() - interval '3 days'),
               (${tenantId}, ${login.account_id}, ${login.id}, 'Can you also look at the gap under the back door?', 'I can''t answer that from your records. I''ve sent your question to the office, and their answer will show here.', 'waiting', now() - interval '1 day')`;
    }
  }

  // A technician's note for the customer on the latest completed visit with none.
  const [visit] = await sql<{ id: string }[]>`
    select v.id from public.visits v where v.tenant_id = ${tenantId} and v.status = 'completed' and not v.imported
      and not exists (select 1 from public.visit_notes n where n.visit_id = v.id and n.kind = 'customer_summary')
    order by v.completed_at desc limit 1`;
  const [{ s }] = await sql<{ s: number }[]>`select count(*)::int as s from public.visit_notes where tenant_id = ${tenantId} and kind = 'customer_summary'`;
  if (visit && s === 0) {
    await sql`
      insert into public.visit_notes (tenant_id, visit_id, kind, content, recorded_at, ai_drafted)
      values (${tenantId}, ${visit.id}, 'customer_summary', 'We treated the outside of the house and sealed two gaps by the garage door. Keep the mulch a foot back from the foundation, and call us if you see activity before your next visit.', now(), true)`;
  }
}
