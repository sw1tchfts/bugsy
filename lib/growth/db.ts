// Growth's database work (spec 17 rules 8 to 10): sequence enrollment and sending for the messaging job, post-visit
// surveys, and referral credits. Queries run on the caller's connection.
import { randomBytes } from "node:crypto";
import type postgres from "postgres";
import { createInvoice } from "@/lib/billing/db";
import { addDays } from "@/lib/dates";
import { appUrl, queueMessage } from "@/lib/messaging/db";
import { render, textToHtml } from "@/lib/messaging/templates";
import { type Step, type Trigger, nextAt } from "./sequences";

type Sql = postgres.Sql | postgres.TransactionSql;

type SequenceRow = { id: string; name: string; trigger: Trigger; settings: Record<string, unknown>; steps: Step[] };
type Subject = { key: string; account_id: string | null; lead_id: string | null; quote_id: string | null; agreement_id: string | null };

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : fallback);

/** Rule 8: who each active sequence takes in today, once per subject. */
async function subjectsFor(tx: Sql, tenantId: string, s: SequenceRow, today: string, now: Date): Promise<Subject[]> {
  switch (s.trigger) {
    case "quote_open": {
      const days = num(s.settings.days, 3);
      return tx<Subject[]>`
        select 'quote:' || q.id as key, q.account_id, q.lead_id, q.id as quote_id, null::uuid as agreement_id from public.quotes q
        where q.tenant_id = ${tenantId} and q.status = 'sent' and q.sent_at <= ${new Date(now.getTime() - days * 86_400_000)}`;
    }
    case "renewal_due": {
      const days = num(s.settings.days, 30);
      return tx<Subject[]>`
        select 'agreement:' || g.id || ':' || g.ends_on as key, g.account_id, null::uuid as lead_id, null::uuid as quote_id, g.id as agreement_id from public.agreements g
        where g.tenant_id = ${tenantId} and g.status = 'active' and not g.auto_renew and g.ends_on between ${today}::date and ${addDays(today, days)}::date`;
    }
    case "seasonal_upsell": {
      const month = num(s.settings.month, 0);
      const type = typeof s.settings.service_type_id === "string" ? s.settings.service_type_id : null;
      if (!type || Number(today.slice(5, 7)) !== month) return [];
      return tx<Subject[]>`
        select 'upsell:' || a.id || ':' || ${today.slice(0, 4)} as key, a.id as account_id, null::uuid as lead_id, null::uuid as quote_id, null::uuid as agreement_id
        from public.accounts a
        where a.tenant_id = ${tenantId} and a.archived_at is null and a.status = 'active'
          and exists (select 1 from public.agreements g where g.account_id = a.id and g.status = 'active')
          and not exists (select 1 from public.agreements g where g.account_id = a.id and g.status in ('active', 'draft') and g.service_type_id = ${type})`;
    }
    case "win_back": {
      const days = num(s.settings.days, 60);
      return tx<Subject[]>`
        select 'winback:' || a.id || ':' || last.id as key, a.id as account_id, null::uuid as lead_id, null::uuid as quote_id, last.id as agreement_id
        from public.accounts a
          join lateral (select g.id, g.status, g.cancelled_on from public.agreements g where g.account_id = a.id order by coalesce(g.cancelled_on, g.starts_on) desc limit 1) last on true
        where a.tenant_id = ${tenantId} and a.archived_at is null and last.status = 'cancelled' and last.cancelled_on <= ${addDays(today, -days)}::date
          and not exists (select 1 from public.agreements g where g.account_id = a.id and g.status = 'active')`;
    }
  }
}

/** Rule 8: whether the subject already did what the sequence asks, so it stops. */
async function acted(tx: Sql, e: { trigger: Trigger; account_id: string | null; quote_id: string | null; agreement_id: string | null; subject_key: string; settings: Record<string, unknown> }): Promise<string | null> {
  switch (e.trigger) {
    case "quote_open": {
      const [q] = await tx<{ status: string }[]>`select status from public.quotes where id = ${e.quote_id}`;
      return !q || q.status !== "sent" ? `quote ${q?.status ?? "gone"}` : null;
    }
    case "renewal_due": {
      const [g] = await tx<{ status: string; ends_on: string }[]>`select status, ends_on::text from public.agreements where id = ${e.agreement_id}`;
      return !g || g.status !== "active" || !e.subject_key.endsWith(`:${g.ends_on}`) ? "renewed or ended" : null;
    }
    case "seasonal_upsell": {
      const [r] = await tx<{ ok: boolean }[]>`
        select exists (select 1 from public.agreements g where g.account_id = ${e.account_id} and g.status in ('active', 'draft') and g.service_type_id = ${String(e.settings.service_type_id ?? "")}::uuid) as ok`;
      return r?.ok ? "bought" : null;
    }
    case "win_back": {
      const [r] = await tx<{ ok: boolean }[]>`select exists (select 1 from public.agreements g where g.account_id = ${e.account_id} and g.status = 'active') as ok`;
      return r?.ok ? "came back" : null;
    }
  }
}

export type SequenceCounts = { enrolled: number; sent: number; stopped: number; completed: number };

/** The messaging job's share (rule 8): enroll today's subjects, then send every step that is due. */
export async function runSequences(tx: Sql, tenantId: string, today: string, now: Date): Promise<SequenceCounts> {
  const counts: SequenceCounts = { enrolled: 0, sent: 0, stopped: 0, completed: 0 };
  const sequences = await tx<SequenceRow[]>`select id, name, trigger, settings, steps from public.sequences where tenant_id = ${tenantId} and active`;
  for (const s of sequences) {
    for (const subject of await subjectsFor(tx, tenantId, s, today, now)) {
      const first = nextAt(s.steps, 0, now);
      const r = await tx`
        insert into public.sequence_enrollments (tenant_id, sequence_id, subject_key, account_id, lead_id, quote_id, agreement_id, next_at)
        values (${tenantId}, ${s.id}, ${subject.key}, ${subject.account_id}, ${subject.lead_id}, ${subject.quote_id}, ${subject.agreement_id}, ${first})
        on conflict (sequence_id, subject_key) do nothing`;
      counts.enrolled += r.count;
    }
  }
  const [company] = await tx<{ name: string }[]>`select name from public.tenants where id = ${tenantId}`;
  const due = await tx<{ id: string; sequence_id: string; step: number; account_id: string | null; lead_id: string | null; quote_id: string | null; agreement_id: string | null; subject_key: string; trigger: Trigger; settings: Record<string, unknown>; steps: Step[] }[]>`
    select e.id, e.sequence_id, e.step, e.account_id, e.lead_id, e.quote_id, e.agreement_id, e.subject_key, s.trigger, s.settings, s.steps
    from public.sequence_enrollments e join public.sequences s on s.id = e.sequence_id
    where e.tenant_id = ${tenantId} and e.status = 'active' and e.next_at <= ${now} order by e.next_at limit 500`;
  for (const e of due) {
    const stop = await acted(tx, e);
    if (stop) {
      await tx`update public.sequence_enrollments set status = 'stopped', stopped_reason = ${stop}, next_at = null where id = ${e.id}`;
      counts.stopped += 1;
      continue;
    }
    const step = e.steps[e.step];
    // The account's decision maker for this channel: the primary contact, then billing, then a property manager (a
    // managed account may have no primary), then the account's own address; never a resident or a site contact.
    const wantEmail = step?.channel === "email";
    const [who] = e.account_id
      ? await tx<{ contact_id: string | null; name: string; email: string | null; phone: string | null }[]>`
          select * from (
            select c.id as contact_id, c.name, c.email, c.phone, (case c.role when 'primary' then 0 when 'billing' then 1 else 2 end) as rank, c.created_at
            from public.contacts c
            where c.account_id = ${e.account_id} and c.archived_at is null and c.role in ('primary', 'billing', 'property_manager')
              and (case when ${wantEmail} then c.email is not null else c.phone is not null end)
            union all
            select null::uuid, a.name, a.email, a.phone, 3, a.created_at from public.accounts a
            where a.id = ${e.account_id} and (case when ${wantEmail} then a.email is not null else a.phone is not null end)
          ) w order by rank, created_at limit 1`
      : await tx<{ contact_id: string | null; name: string; email: string | null; phone: string | null }[]>`select null::uuid as contact_id, name, email, phone from public.leads where id = ${e.lead_id}`;
    const to = step && who ? (step.channel === "email" ? who.email : who.phone) : null;
    if (step && who && to) {
      const t = randomBytes(24).toString("hex");
      const vars = { customer_name: who.name.split(" ")[0] ?? who.name, company_name: company.name, unsubscribe_url: `${appUrl()}/u/${t}` };
      let body = render(step.body, vars);
      if (step.channel === "email" && !body.includes(vars.unsubscribe_url)) body = `${body}\n\nUnsubscribe: ${vars.unsubscribe_url}`;
      await queueMessage(tx, tenantId, {
        channel: step.channel,
        purpose: "campaign",
        to_address: to,
        recipient_name: who.name,
        subject: step.subject ? render(step.subject, vars) : null,
        body,
        body_html: step.channel === "email" ? textToHtml(body) : null,
        account_id: e.account_id,
        contact_id: who.contact_id,
        dedupe_key: `sequence:${e.id}:${e.step}`,
        token: t,
      });
      counts.sent += 1;
    }
    const next = e.step + 1;
    const at = nextAt(e.steps, next, now);
    if (at) await tx`update public.sequence_enrollments set step = ${next}, next_at = ${at} where id = ${e.id}`;
    else {
      await tx`update public.sequence_enrollments set step = ${next}, next_at = null, status = 'completed' where id = ${e.id}`;
      counts.completed += 1;
    }
  }
  return counts;
}

/** Rule 9: the visit's survey link, made once when the summary goes out (null when surveys are off). */
export async function surveyLink(tx: Sql, tenantId: string, visitId: string): Promise<string | null> {
  const [g] = await tx<{ survey_enabled: boolean }[]>`select survey_enabled from public.growth_settings where tenant_id = ${tenantId}`;
  if (g && !g.survey_enabled) return null;
  const [existing] = await tx<{ token: string }[]>`select token from public.surveys where visit_id = ${visitId}`;
  if (existing) return `${appUrl()}/s/${existing.token}`;
  const [v] = await tx<{ account_id: string }[]>`select account_id from public.visits where id = ${visitId} and tenant_id = ${tenantId}`;
  if (!v) return null;
  const [row] = await tx<{ token: string }[]>`insert into public.surveys (tenant_id, visit_id, account_id) values (${tenantId}, ${visitId}, ${v.account_id}) returning token`;
  return `${appUrl()}/s/${row.token}`;
}

/**
 * Rule 10: when an account that came from a referral signs its first agreement, the referrer's account gets the
 * company's referral credit once, as a credit memo that applies to their next invoice.
 */
export async function creditReferral(tx: Sql, tenantId: string, agreementId: string, today: string): Promise<boolean> {
  const [g] = await tx<{ account_id: string; referrer: string | null; number: number; earlier: number }[]>`
    select g.account_id, l.referred_by_account_id as referrer, g.number,
           (select count(*)::int from public.agreements o where o.account_id = g.account_id and o.id <> g.id and o.signed_at is not null
              and (o.signed_at, o.id) < (g.signed_at, g.id))
           + (select count(*)::int from public.referral_credits c where c.referred_account_id = g.account_id) as earlier
    from public.agreements g join public.accounts a on a.id = g.account_id left join public.leads l on l.id = a.lead_id
    where g.id = ${agreementId} and g.tenant_id = ${tenantId} and g.signed_at is not null`;
  if (!g?.referrer || g.earlier > 0 || g.referrer === g.account_id) return false;
  const [settings] = await tx<{ referral_credit_cents: string }[]>`select referral_credit_cents from public.growth_settings where tenant_id = ${tenantId}`;
  const amount = Number(settings?.referral_credit_cents ?? 2500);
  if (amount <= 0) return false;
  const [credit] = await tx<{ id: string }[]>`
    insert into public.referral_credits (tenant_id, referrer_account_id, referred_account_id, agreement_id, amount_cents)
    values (${tenantId}, ${g.referrer}, ${g.account_id}, ${agreementId}, ${amount}) on conflict (agreement_id) do nothing returning id`;
  if (!credit) return false;
  const [referred] = await tx<{ name: string }[]>`select name from public.accounts where id = ${g.account_id}`;
  const memo = await createInvoice(tx, tenantId, {
    kind: "credit_memo",
    account_id: g.referrer,
    property_id: null,
    source: "referral",
    source_key: `referral:${agreementId}`,
    issued_on: today,
    memo: `Thank you for referring ${referred?.name ?? "a friend"}`,
    lines: [{ description: `Referral credit: ${referred?.name ?? "a friend"} signed agreement #${g.number}`, amount_cents: -amount, kind: "service" }],
    issue: true,
  });
  await tx`update public.referral_credits set credit_memo_id = ${memo.id} where id = ${credit.id}`;
  return true;
}

/** Rule 10, for the billing job: referred customers whose first plan was signed by someone who cannot issue credits. */
export async function creditReferrals(tx: Sql, tenantId: string, today: string): Promise<number> {
  const due = await tx<{ id: string }[]>`
    select distinct on (g.account_id) g.id from public.agreements g join public.accounts a on a.id = g.account_id join public.leads l on l.id = a.lead_id
    where g.tenant_id = ${tenantId} and g.signed_at is not null and l.referred_by_account_id is not null
      and not exists (select 1 from public.referral_credits c where c.referred_account_id = g.account_id)
    order by g.account_id, g.signed_at, g.id`;
  let made = 0;
  for (const g of due) if (await creditReferral(tx, tenantId, g.id, today)) made += 1;
  return made;
}

