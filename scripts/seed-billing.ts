// Spec 08 seed: billing settings on the local gateway, the invoices the agreements and completed visits imply, the
// older ones paid by check so the demo companies look healthy, a saved card with autopay that the job charges, and a
// gateway event row. Idempotent. Called from seed.ts after the compliance seed.
import type postgres from "postgres";
import { addPaymentMethod, createInvoice, ensureSettings, recordPayment, runBilling } from "../lib/billing/db";
import { addDays, todayInZone } from "../lib/dates";
import type { SeedTenant } from "./seed-data";
import { seedUserEmail } from "./seed-data";

type Sql = postgres.Sql;

export async function seedBilling(sql: Sql, tenant: SeedTenant, tenantId: string): Promise<void> {
  const today = todayInZone(tenant.timezone);
  const [office] = await sql<{ id: string }[]>`select id from auth.users where email = ${seedUserEmail(tenant, "office")}`;

  await ensureSettings(sql, tenantId);
  await sql`
    update public.billing_settings set invoice_footer = coalesce(invoice_footer, 'Thank you for your business. Questions about this invoice? Call the office.'),
           gateway_account_id = coalesce(gateway_account_id, ${`local_acct_${tenantId.slice(0, 8)}`}), gateway_onboarded_at = coalesce(gateway_onboarded_at, now())
    where tenant_id = ${tenantId}`;

  // A one-off charge the office has not issued yet: the draft the billing home lists, and the one invoice whose lines
  // can still change (the isolation suite needs a line that reaches row level security rather than the lock trigger).
  const [draftAccount] = await sql<{ id: string; property_id: string | null }[]>`
    select a.id, (select p.id from public.properties p where p.account_id = a.id and p.archived_at is null order by p.created_at limit 1) as property_id
    from public.accounts a where a.tenant_id = ${tenantId} and a.archived_at is null and a.name = 'Riverside Hospitality Group' limit 1`;
  if (draftAccount) {
    await createInvoice(sql, tenantId, {
      account_id: draftAccount.id,
      property_id: draftAccount.property_id,
      source: "manual",
      source_key: "seed:one-off-draft",
      issued_on: today,
      memo: "Quoted by phone; issue once the front desk confirms the room count.",
      lines: [{ description: "Bed bug heat treatment, two guest rooms", amount_cents: 65000, service_type_id: null, service_line: "bed_bug" }],
      issue: false,
    });
  }

  // The job issues everything the agreements and completed visits imply.
  await runBilling(sql, tenantId, tenant.timezone);

  // One customer other than Maria Lopez keeps a card on file with autopay; the job charges whatever is open for them,
  // so their invoices are left for the card rather than paid by check below.
  const [cardAccount] = await sql<{ id: string }[]>`
    select a.id from public.accounts a where a.tenant_id = ${tenantId} and a.archived_at is null and a.name <> 'Maria Lopez'
      and exists (select 1 from public.agreements g where g.account_id = a.id and g.status = 'active')
      and exists (select 1 from public.invoices i where i.account_id = a.id and i.status in ('issued', 'partially_paid', 'past_due'))
    order by a.created_at limit 1`;

  // Invoices that came due before this week were paid by check on their due date, so nothing starts past due.
  const open = await sql<{ id: string; account_id: string; due_on: string; open_cents: string | number }[]>`
    select id, account_id, due_on, total_cents - paid_cents as open_cents from public.invoices
    where tenant_id = ${tenantId} and kind = 'invoice' and status in ('issued', 'partially_paid', 'past_due') and due_on < ${addDays(today, -7)}
      and account_id is distinct from ${cardAccount?.id ?? null}::uuid order by due_on`;
  for (const inv of open) {
    const cents = Number(inv.open_cents);
    if (cents <= 0) continue;
    await recordPayment(sql, tenantId, {
      account_id: inv.account_id,
      method: "check",
      amount_cents: cents,
      received_at: new Date(`${inv.due_on}T17:00:00Z`),
      reference: `${1000 + Number(inv.due_on.replace(/-/g, "").slice(-4))}`,
      recorded_by: office?.id ?? null,
      invoice_id: inv.id,
      memo: "seed: paid on the due date",
    });
  }

  if (cardAccount) {
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from public.payment_methods where tenant_id = ${tenantId} and account_id = ${cardAccount.id}`;
    if (n === 0) await addPaymentMethod(sql, tenantId, { account_id: cardAccount.id, token: "card:4000056655665556:12:2030", autopay: true, added_by: office?.id ?? null });
    await runBilling(sql, tenantId, tenant.timezone);
  }

  // The gateway's event ledger has a row per company, so the isolation suite has something to test against.
  await sql`insert into public.gateway_events (gateway, event_id, type, payload, tenant_id) values ('local', ${`local_seed_${tenantId}`}, 'seed.connected', '{}'::jsonb, ${tenantId}) on conflict (gateway, event_id) do nothing`;
}
