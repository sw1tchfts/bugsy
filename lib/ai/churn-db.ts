// Churn risk's database side (spec 21 rule 6): each active plan's signals, scored, and saved whole once a day by the
// billing job (or a member's run). The office reads the scores; nothing else changes.
import type postgres from "postgres";
import { type ChurnScore, type ChurnSignals, churnScore, soundsUnhappy } from "./churn";

type Sql = postgres.Sql | postgres.TransactionSql;

type SignalRow = { agreement_id: string; account_id: string; reservices: number; skipped: number; past_due: boolean; price_up: boolean; low_survey: number | null; months: number; overdue: boolean };

export async function churnSignals(tx: Sql, tenantId: string, today: string): Promise<(ChurnSignals & { agreement_id: string; account_id: string })[]> {
  const rows = await tx<SignalRow[]>`
    select g.id as agreement_id, g.account_id,
      (select count(*)::int from public.visits v where v.agreement_id = g.id and v.kind = 'reservice' and v.created_at > now() - interval '90 days') as reservices,
      (select count(*)::int from public.visits v where v.agreement_id = g.id and v.status in ('skipped', 'cancelled') and v.updated_at > now() - interval '180 days') as skipped,
      (a.past_due_since is not null) as past_due,
      exists (select 1 from public.agreement_price_changes c where c.agreement_id = g.id and c.new_recurring_price_cents > c.old_recurring_price_cents
              and c.effective_on between ${today}::date - 60 and ${today}::date) as price_up,
      (select min(s.score)::int from public.surveys s where s.account_id = g.account_id and s.score is not null and s.score <= 6 and s.responded_at > now() - interval '180 days') as low_survey,
      (extract(year from age(${today}::date, g.starts_on)) * 12 + extract(month from age(${today}::date, g.starts_on)))::int as months,
      exists (select 1 from public.visits v where v.agreement_id = g.id and v.status = 'planned' and v.due_end < ${today}::date) as overdue
    from public.agreements g join public.accounts a on a.id = g.account_id
    where g.tenant_id = ${tenantId} and g.status = 'active'`;
  const unhappy = await tx<{ account_id: string; body: string }[]>`
    select m.account_id, m.body from public.messages m
    where m.tenant_id = ${tenantId} and m.direction = 'inbound' and m.account_id is not null and m.created_at > now() - interval '60 days'`;
  const upset = new Set(unhappy.filter((m) => soundsUnhappy(m.body)).map((m) => m.account_id));
  return rows.map((r) => ({
    agreement_id: r.agreement_id,
    account_id: r.account_id,
    reservices_90: r.reservices,
    skipped_180: r.skipped,
    past_due: r.past_due,
    price_increase_60: r.price_up,
    low_survey_180: r.low_survey,
    unhappy_message_60: upset.has(r.account_id),
    months_active: Math.max(0, r.months),
    overdue_visit: r.overdue,
  }));
}

/** Rule 6: once a day, every active plan scored and saved; a company with churn scores off keeps none. */
export async function scoreChurn(tx: Sql, tenantId: string, today: string, force = false): Promise<number> {
  const [s] = await tx<{ enabled: boolean; churn: boolean }[]>`select enabled, churn from public.ai_settings where tenant_id = ${tenantId}`;
  if (s && (!s.enabled || !s.churn)) {
    await tx`select app.save_churn_scores(${tenantId}, ${today}, '[]'::jsonb)`;
    return 0;
  }
  if (!force) {
    const [done] = await tx<{ n: number }[]>`select count(*)::int as n from public.churn_scores where tenant_id = ${tenantId} and computed_on = ${today}`;
    if (done.n > 0) return 0;
  }
  const scored = (await churnSignals(tx, tenantId, today)).map((sig) => ({ agreement_id: sig.agreement_id, ...churnScore(sig) }));
  const [{ n }] = await tx<{ n: number }[]>`select app.save_churn_scores(${tenantId}, ${today}, ${tx.json(scored as unknown as postgres.JSONValue)}) as n`;
  return n;
}

export type RiskRow = ChurnScore & { agreement_id: string; account_id: string; account_name: string; address: string; service: string; computed_on: string };

export async function riskList(tx: Sql, tenantId: string, band: "high" | "medium" | "all" = "all"): Promise<RiskRow[]> {
  return tx<RiskRow[]>`
    select c.agreement_id, c.account_id, a.name as account_name, p.normalized_address as address, st.name as service, c.score, c.band, c.reasons, c.computed_on::text
    from public.churn_scores c join public.accounts a on a.id = c.account_id join public.agreements g on g.id = c.agreement_id
      join public.properties p on p.id = g.property_id join public.service_types st on st.id = g.service_type_id
    where c.tenant_id = ${tenantId} and (${band} = 'all' and c.band <> 'low' or c.band = ${band})
    order by c.score desc, a.name limit 200`;
}
