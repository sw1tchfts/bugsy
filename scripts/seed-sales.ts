// Spec 17 seed: per company, a territory for the sales rep with a few knocks (one door asked not to be knocked), a
// commission plan for reps, two commissions on the rep's older sales (one payable and paid out, one held), a renewal
// sequence with its enrollment, the growth settings, one answered and one unanswered survey, and one referral credit. Idempotent.
import type postgres from "postgres";
import { createInvoice } from "../lib/billing/db";
import { addDays, todayInZone } from "../lib/dates";
import { runSequences } from "../lib/growth/db";
import { earnCommissions, payCommissions, runCommissions } from "../lib/sales/db";
import type { SeedTenant } from "./seed-data";
import { seedUserEmail } from "./seed-data";

type Sql = postgres.Sql;

const KNOCKS = [
  { address: "210 Elm Street", outcome: "not_home", lat: 39.981, lng: -83.001 },
  { address: "214 Elm Street", outcome: "not_interested", lat: 39.9812, lng: -83.0005 },
  { address: "218 Elm Street", outcome: "come_back", lat: 39.9814, lng: -83.0001 },
  { address: "222 Elm Street", outcome: "do_not_knock", lat: 39.9816, lng: -82.9996 },
];

export async function seedSales(sql: Sql, tenant: SeedTenant, tenantId: string): Promise<void> {
  const today = todayInZone(tenant.timezone);
  const [rep] = await sql<{ id: string }[]>`select id from auth.users where email = ${seedUserEmail(tenant, "sales_rep")}`;
  if (!rep) return;
  const state = tenant.branches[0]?.stateCode ?? "OH";

  const [existing] = await sql<{ id: string }[]>`select id from public.territories where tenant_id = ${tenantId} and name = 'Elm and Oak'`;
  const territoryId =
    existing?.id ??
    (await sql<{ id: string }[]>`insert into public.territories (tenant_id, name, zip_codes, streets, rep_ids) values (${tenantId}, 'Elm and Oak', ${["43201", "43215"]}, ${["Elm Street", "Oak Avenue"]}, ${[rep.id]}) returning id`)[0].id;
  const [knocked] = await sql<{ n: number }[]>`select count(*)::int as n from public.knocks where territory_id = ${territoryId}`;
  if (!knocked.n) {
    for (const [i, k] of KNOCKS.entries()) {
      await sql`insert into public.knocks (tenant_id, territory_id, rep_id, address, normalized_address, postal_code, lat, lng, outcome, notes, follow_up_at, knocked_at)
                values (${tenantId}, ${territoryId}, ${rep.id}, ${k.address}, ${`${k.address.toUpperCase()}, COLUMBUS ${state} 43201`}, '43201', ${k.lat}, ${k.lng}, ${k.outcome},
                        ${k.outcome === "come_back" ? "Husband decides; back Saturday" : null}, ${k.outcome === "come_back" ? addDays(today, 2) : null}, now() - make_interval(hours => ${i + 1}))`;
    }
  }

  const [plan] = await sql<{ id: string }[]>`select id from public.commission_plans where tenant_id = ${tenantId} and name = 'Door sales'`;
  if (!plan) {
    await sql`insert into public.commission_plans (tenant_id, name, role_keys, basis, percent, hold_days, hold_paid_invoices, chargeback_days)
              values (${tenantId}, 'Door sales', ${["sales_rep"]}, 'first_year', 10, 30, 1, 90)`;
  }
  // The rep sold Maria's general plan and Oakwood's rodent program (seeded by spec 04) before Bugsy kept commissions.
  const sold = await sql<{ id: string; signed_at: Date }[]>`
    select id, signed_at from public.agreements where tenant_id = ${tenantId} and notes in ('seed:maria-general', 'seed:oakwood-rodent') and sold_by is null`;
  for (const g of sold) {
    await sql`update public.agreements set sold_by = ${rep.id} where id = ${g.id}`;
    await earnCommissions(sql, tenantId, g.id, todayInZone(tenant.timezone));
  }
  // Oakwood's commission is past its hold and its invoices are paid: payable, then paid out.
  await sql`update public.commissions set earned_on = ${addDays(today, -60)}, releasable_on = ${addDays(today, -30)}
            where tenant_id = ${tenantId} and status = 'held' and agreement_id in (select id from public.agreements where notes = 'seed:oakwood-rodent' and tenant_id = ${tenantId})`;
  await runCommissions(sql, tenantId, today);
  const [payout] = await sql<{ n: number }[]>`select count(*)::int as n from public.commission_payouts where tenant_id = ${tenantId}`;
  if (!payout.n) await payCommissions(sql, tenantId, rep.id, { paid_on: today, method: "payroll", reference: "seed payroll" });

  await sql`insert into public.growth_settings (tenant_id, referral_credit_cents, survey_enabled) values (${tenantId}, 2500, true) on conflict (tenant_id) do nothing`;
  const [seq] = await sql<{ id: string }[]>`select id from public.sequences where tenant_id = ${tenantId} and name = 'Renewal nudge'`;
  if (!seq) {
    await sql`insert into public.sequences (tenant_id, name, trigger, settings, steps) values (${tenantId}, 'Renewal nudge', 'renewal_due', ${sql.json({ days: 45 })}, ${sql.json([
      { delay_days: 0, channel: "email", subject: "Your plan with {{company_name}} ends soon", body: "Hi {{customer_name}}, your plan ends this month. Reply and we will renew it at the same price." },
      { delay_days: 7, channel: "email", subject: "Keep your home protected", body: "Hi {{customer_name}}, a quick reminder: renew this week and keep your free re-services." },
    ])})`;
    await runSequences(sql, tenantId, today, new Date());
  }

  const [visit] = await sql<{ id: string; account_id: string }[]>`
    select v.id, v.account_id from public.visits v join public.accounts a on a.id = v.account_id
    where v.tenant_id = ${tenantId} and a.name = 'Maria Lopez' and v.status = 'completed' order by v.completed_at desc limit 1`;
  if (visit) {
    await sql`insert into public.surveys (tenant_id, visit_id, account_id, score, comment, responded_at) values (${tenantId}, ${visit.id}, ${visit.account_id}, 9, 'On time and explained everything.', now())
              on conflict (visit_id) do nothing`;
  }
  // One survey still waiting for its answer: another customer's latest completed visit.
  const [open] = await sql<{ id: string; account_id: string }[]>`
    select v.id, v.account_id from public.visits v join public.accounts a on a.id = v.account_id
    where v.tenant_id = ${tenantId} and a.name <> 'Maria Lopez' and v.status = 'completed' and not v.imported
      and not exists (select 1 from public.surveys s where s.visit_id = v.id)
    order by v.completed_at desc limit 1`;
  const [{ n: waiting }] = await sql<{ n: number }[]>`select count(*)::int as n from public.surveys where tenant_id = ${tenantId} and responded_at is null`;
  if (open && !waiting) await sql`insert into public.surveys (tenant_id, visit_id, account_id) values (${tenantId}, ${open.id}, ${open.account_id})`;

  // Maria referred the Patel family: their warranty earned her the credit.
  const [patel] = await sql<{ agreement_id: string; account_id: string }[]>`
    select g.id as agreement_id, g.account_id from public.agreements g where g.tenant_id = ${tenantId} and g.notes = 'seed:patel-warranty'`;
  const [maria] = await sql<{ id: string }[]>`select id from public.accounts where tenant_id = ${tenantId} and name = 'Maria Lopez'`;
  if (patel && maria) {
    const [credit] = await sql<{ id: string }[]>`
      insert into public.referral_credits (tenant_id, referrer_account_id, referred_account_id, agreement_id, amount_cents)
      values (${tenantId}, ${maria.id}, ${patel.account_id}, ${patel.agreement_id}, 2500) on conflict (agreement_id) do nothing returning id`;
    if (credit) {
      const memo = await createInvoice(sql, tenantId, {
        kind: "credit_memo",
        account_id: maria.id,
        property_id: null,
        source: "referral",
        source_key: `referral:${patel.agreement_id}`,
        issued_on: today,
        memo: "Thank you for referring the Patel family",
        lines: [{ description: "Referral credit: Patel Family signed a termite warranty", amount_cents: -2500, kind: "service" }],
        issue: true,
      });
      await sql`update public.referral_credits set credit_memo_id = ${memo.id} where id = ${credit.id}`;
    }
  }
}
