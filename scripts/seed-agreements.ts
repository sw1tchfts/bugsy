// Spec 04 seed: signed agreements with their generated visits, a seasonal program, a re-service, an applied price
// increase and a cancelled agreement for each demo tenant. Called from seed.ts after customers and the catalog.
import type postgres from "postgres";
import { applyPriceIncrease, bookReservice, cancelAgreement, syncVisits } from "../lib/agreements/db";
import { addDays, addMonths, startOfMonth, todayInZone } from "../lib/dates";
import type { SeedTenant } from "./seed-data";

type Sql = postgres.Sql;

async function serviceTypeId(sql: Sql, tenantId: string, name: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`select id from public.service_types where tenant_id = ${tenantId} and name = ${name} and archived_at is null`;
  if (!row) throw new Error(`seed service type ${name} is missing for the tenant`);
  return row.id;
}

async function accountAndProperty(sql: Sql, tenantId: string, accountName: string, propertyName: string): Promise<{ accountId: string; propertyId: string; contactId: string | null }> {
  const [row] = await sql<{ account_id: string; property_id: string }[]>`
    select a.id as account_id, p.id as property_id from public.accounts a join public.properties p on p.account_id = a.id
    where a.tenant_id = ${tenantId} and a.name = ${accountName} and p.name = ${propertyName} and p.archived_at is null order by p.created_at limit 1`;
  if (!row) throw new Error(`seed account ${accountName} / ${propertyName} is missing`);
  const [contact] = await sql<{ id: string }[]>`select id from public.contacts where tenant_id = ${tenantId} and account_id = ${row.account_id} and archived_at is null order by created_at limit 1`;
  return { accountId: row.account_id, propertyId: row.property_id, contactId: contact?.id ?? null };
}

type AgreementSeed = {
  key: string;
  account: string;
  property: string;
  serviceType: string;
  cadence: string;
  cadence_rule?: Record<string, unknown>;
  season_start?: string;
  season_end?: string;
  billing_mode: string;
  initial: number;
  recurring: number;
  starts_on: string;
  first_visit_on?: string;
  term_months?: number;
  skip_months?: number[];
  interior_only_months?: number[];
  auto_renew?: boolean;
  cancel_fee?: number;
};

export async function seedAgreements(sql: Sql, tenant: SeedTenant, tenantId: string, ownerUserId: string): Promise<void> {
  const today = todayInZone(tenant.timezone);
  const thisMonth = startOfMonth(today);
  const year = Number(today.slice(0, 4));
  const seasonYear = today > `${year}-10-31` ? year + 1 : year;
  const [branch] = await sql<{ id: string }[]>`select id from public.branches where tenant_id = ${tenantId} and archived_at is null order by created_at limit 1`;

  const seeds: AgreementSeed[] = [
    // Quarterly general pest on flat monthly billing, signed this month: the fixture's shape (scenario A).
    { key: "maria-general", account: "Maria Lopez", property: "Home", serviceType: "General pest plan", cadence: "quarterly", billing_mode: "flat_monthly", initial: 24900, recurring: 11900, starts_on: thisMonth, skip_months: [], interior_only_months: [12, 1, 2] },
    // Seasonal mosquito program, annual prepay, six rounds May to October.
    { key: "maria-mosquito", account: "Maria Lopez", property: "Home", serviceType: "Mosquito and tick season", cadence: "seasonal_rounds", cadence_rule: { rounds: 6 }, season_start: `${seasonYear}-05-01`, season_end: `${seasonYear}-10-31`, billing_mode: "annual_prepay", initial: 8900, recurring: 8900, starts_on: `${seasonYear}-05-01`, term_months: 12 },
    // Monthly rodent program per visit, eleven months in, so it shows on the renewals list.
    { key: "oakwood-rodent", account: "Oakwood Properties", property: "Oakwood Apartments", serviceType: "Rodent control program", cadence: "monthly", billing_mode: "per_visit", initial: 39500, recurring: 10900, starts_on: addMonths(thisMonth, -11), auto_renew: true },
    // Commercial general pest on flat monthly, started three months ago, cancelled below.
    { key: "riverside-cancelled", account: "Riverside Hospitality Group", property: "Riverside Grill downtown", serviceType: "General pest plan", cadence: "monthly", billing_mode: "flat_monthly", initial: 29900, recurring: 13900, starts_on: addMonths(thisMonth, -3), cancel_fee: 5000, auto_renew: false },
  ];

  const ids = new Map<string, string>();
  for (const s of seeds) {
    const [existing] = await sql<{ id: string; status: string; visits: number }[]>`
      select id, status, (select count(*)::int from public.visits v where v.agreement_id = a.id) as visits
      from public.agreements a where tenant_id = ${tenantId} and notes = ${`seed:${s.key}`}`;
    if (existing) {
      ids.set(s.key, existing.id);
      // A run that stopped between signing and planning leaves an active agreement without visits; finish it.
      if (existing.status === "active" && existing.visits === 0) await syncVisits(sql, tenantId, existing.id);
      continue;
    }
    const target = await accountAndProperty(sql, tenantId, s.account, s.property);
    const [row] = await sql<{ id: string }[]>`
      insert into public.agreements ${sql({
        tenant_id: tenantId,
        account_id: target.accountId,
        property_id: target.propertyId,
        service_type_id: await serviceTypeId(sql, tenantId, s.serviceType),
        branch_id: branch?.id ?? null,
        status: "draft",
        cadence: s.cadence,
        cadence_rule: sql.json(s.cadence_rule ?? {}),
        season_start: s.season_start ?? null,
        season_end: s.season_end ?? null,
        skip_months: s.skip_months ?? [],
        interior_only_months: s.interior_only_months ?? [],
        initial_price_cents: s.initial,
        recurring_price_cents: s.recurring,
        billing_mode: s.billing_mode,
        term_months: s.term_months ?? 12,
        auto_renew: s.auto_renew ?? true,
        cancel_fee_cents: s.cancel_fee ?? 0,
        starts_on: s.starts_on,
        first_visit_on: s.first_visit_on ?? s.starts_on,
        terms_text: "Demo terms: 12-month agreement, free re-services between visits, 30 days notice to cancel.",
        notes: `seed:${s.key}`,
        created_by: ownerUserId,
      })} returning id`;
    ids.set(s.key, row.id);
    // Signed by the primary contact on the start date.
    await sql`
      update public.agreements set status = 'active', signed_at = ${s.starts_on}::date::timestamptz, signed_name = ${s.account}, signed_by_contact_id = ${target.contactId}, signed_ip = '127.0.0.1'
      where id = ${row.id}`;
    await syncVisits(sql, tenantId, row.id);
  }

  // Visits whose window has passed are completed, so the renewals list, the home page and the ledger have history.
  await sql`
    update public.visits set status = 'scheduled', scheduled_for = due_start, technician_id = null
    where tenant_id = ${tenantId} and status = 'planned' and kind in ('initial', 'recurring') and due_end < ${today}`;
  await sql`
    update public.visits set status = 'completed', completed_at = (due_start::timestamp + interval '10 hours'), arrived_at = (due_start::timestamp + interval '9 hours'), departed_at = (due_start::timestamp + interval '10 hours')
    where tenant_id = ${tenantId} and status = 'scheduled' and due_end < ${today} and scheduled_for = due_start`;

  // A re-service the customer asked for this week.
  const mariaId = ids.get("maria-general");
  if (mariaId) {
    const [reservice] = await sql<{ id: string }[]>`select id from public.visits where agreement_id = ${mariaId} and kind = 'reservice'`;
    if (!reservice) await bookReservice(sql, tenantId, mariaId, "Ants back in the kitchen", today, addDays(today, 6));
  }

  // A yearly increase of 3% on general pest plans, effective next month, already applied.
  const [increase] = await sql<{ id: string; applied_at: string | null }[]>`select id, applied_at from public.price_increases where tenant_id = ${tenantId} and notes = 'seed:yearly'`;
  let increaseId = increase?.id;
  if (!increaseId) {
    const [row] = await sql<{ id: string }[]>`
      insert into public.price_increases (tenant_id, kind, percent, effective_on, service_type_id, rounding, notes, created_by)
      values (${tenantId}, 'percent', 3, ${addMonths(thisMonth, 1)}, ${await serviceTypeId(sql, tenantId, "General pest plan")}, 'cent', 'seed:yearly', ${ownerUserId}) returning id`;
    increaseId = row.id;
  }
  if (!increase?.applied_at) await applyPriceIncrease(sql, tenantId, increaseId);

  // The commercial account cancelled after three months, with a save offer that did not land.
  const cancelledId = ids.get("riverside-cancelled");
  if (cancelledId) {
    const [state] = await sql<{ status: string }[]>`select status from public.agreements where id = ${cancelledId}`;
    if (state.status === "active") {
      const [reason] = await sql<{ id: string }[]>`select id from public.cancel_reasons where tenant_id = ${tenantId} and key = 'competitor'`;
      await cancelAgreement(sql, tenantId, cancelledId, { effectiveOn: today, reasonId: reason.id, note: "Signed with a national brand at a lower introductory price.", saveOfferMade: true, saveOutcome: "lost" });
    }
  }

  // A crew on the next scheduled visit, so visit_crew has rows before dispatch exists.
  const [nextVisit] = await sql<{ id: string }[]>`
    select id from public.visits where tenant_id = ${tenantId} and status = 'planned' and kind in ('initial', 'recurring') order by due_start limit 1`;
  const [tech] = await sql<{ user_id: string }[]>`
    select m.user_id from public.memberships m join public.roles r on r.id = m.role_id where m.tenant_id = ${tenantId} and r.key = 'technician' limit 1`;
  if (nextVisit && tech) {
    await sql`insert into public.visit_crew (tenant_id, visit_id, user_id, role) values (${tenantId}, ${nextVisit.id}, ${tech.user_id}, 'lead') on conflict (visit_id, user_id) do nothing`;
  }
}
