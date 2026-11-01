// Sales and growth's database work (spec 17), on the caller's connection: knocks, the sale at the door, commissions
// (earn, release, charge back, pay) and their postings. The billing job runs the commission run for every company.
import type postgres from "postgres";
import { syncVisits } from "@/lib/agreements/db";
import { addPaymentMethod, issuePrepayments } from "@/lib/billing/db";
import { addDays, dateInZone } from "@/lib/dates";
import { postEntry } from "@/lib/ledger/db";
import { commissionLines, commissionPayoutLines } from "@/lib/ledger/post";
import { type Plan, commissionFor, covers, releasableOn, shouldChargeBack, shouldRelease } from "./commissions";

type Sql = postgres.Sql | postgres.TransactionSql;

export type GeoAddress = {
  line1: string;
  line2: string | null;
  city: string;
  state_code: string;
  postal_code: string;
  normalized_address: string;
  county: string | null;
  lat: number | null;
  lng: number | null;
  geocode_status: string;
};

export async function recordKnock(
  tx: Sql,
  tenantId: string,
  repId: string,
  input: { territory_id: string; address: GeoAddress; outcome: string; notes: string | null; follow_up_at: string | null },
): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into public.knocks (tenant_id, territory_id, rep_id, address, normalized_address, postal_code, lat, lng, outcome, notes, follow_up_at)
    values (${tenantId}, ${input.territory_id}, ${repId}, ${input.address.line1}, ${input.address.normalized_address}, ${input.address.postal_code},
            ${input.address.lat}, ${input.address.lng}, ${input.outcome}, ${input.notes}, ${input.follow_up_at})
    returning id`;
  return row.id;
}

export type DoorSale = {
  territory_id: string;
  address: GeoAddress;
  name: string;
  email: string | null;
  phone: string | null;
  property_type: string;
  size_sqft: number | null;
  lot_sqft: number | null;
  service_type_id: string;
  initial_price_cents: number;
  recurring_price_cents: number;
  cadence: string;
  billing_mode: string;
  starts_on: string;
  signed_name: string;
  signature_file_id: string | null;
  /** The gateway token for the card (a Stripe payment method id, or the local gateway's), or none. */
  card_token: string | null;
  ip: string | null;
  /** The company's account this sale adds to (the address or person is already a customer), or none for a new one. */
  existing_account_id?: string | null;
};

/**
 * Spec 17 rule 3: the whole sale in one transaction. The knock (sold), the lead (door to door), the account, property
 * and primary contact, the agreement signed with the customer's name and signature, its visits, the card for autopay,
 * and the seller's commissions (held).
 */
export async function doorSale(tx: Sql, tenantId: string, repId: string, sale: DoorSale, timeZone: string): Promise<{ agreement_id: string; account_id: string }> {
  const knockId = await recordKnock(tx, tenantId, repId, { territory_id: sale.territory_id, address: sale.address, outcome: "sold", notes: null, follow_up_at: null });
  const [source] = await tx<{ id: string }[]>`select id from public.lead_sources where tenant_id = ${tenantId} and key = 'door_to_door'`;
  if (!source) throw Object.assign(new Error("the door to door lead source is missing"), { code: "23514" });
  const a = sale.address;
  const [lead] = await tx<{ id: string }[]>`
    insert into public.leads ${tx({
      tenant_id: tenantId, source_id: source.id, stage: "new", name: sale.name, email: sale.email, phone: sale.phone, property_type: sale.property_type, owner_id: repId,
      line1: a.line1, line2: a.line2, city: a.city, state_code: a.state_code, postal_code: a.postal_code, normalized_address: a.normalized_address,
      county: a.county, lat: a.lat, lng: a.lng, geocode_status: a.geocode_status, service_type_id: sale.service_type_id,
    })} returning id`;
  const residential = ["house", "townhouse", "condo"].includes(sale.property_type);
  // An existing customer (the rep chose to add to their account): their property at this address, or a new one on the
  // account, and the signer among their contacts, or added as one.
  const [found] = sale.existing_account_id
    ? await tx<{ id: string }[]>`select id from public.accounts where id = ${sale.existing_account_id} and tenant_id = ${tenantId} and archived_at is null`
    : [];
  if (sale.existing_account_id && !found) throw Object.assign(new Error("That account is not one of the company's customers."), { code: "23514" });
  const account =
    found ??
    (
      await tx<{ id: string }[]>`
        insert into public.accounts ${tx({
          tenant_id: tenantId, type: residential ? "residential" : "commercial", name: sale.name, email: sale.email, phone: sale.phone, lead_id: lead.id,
          billing_line1: a.line1, billing_line2: a.line2, billing_city: a.city, billing_state_code: a.state_code, billing_postal_code: a.postal_code,
        })} returning id`
    )[0];
  const [atAddress] = found
    ? await tx<{ id: string }[]>`select id from public.properties where account_id = ${account.id} and normalized_address = ${a.normalized_address} and archived_at is null order by created_at limit 1`
    : [];
  const property =
    atAddress ??
    (
      await tx<{ id: string }[]>`
        insert into public.properties ${tx({
          tenant_id: tenantId, account_id: account.id, name: residential ? "Home" : null, property_type: sale.property_type,
          line1: a.line1, line2: a.line2, city: a.city, state_code: a.state_code, postal_code: a.postal_code, normalized_address: a.normalized_address,
          county: a.county, lat: a.lat, lng: a.lng, geocode_status: a.geocode_status, size_sqft: sale.size_sqft, lot_sqft: sale.lot_sqft,
        })} returning id`
    )[0];
  const [known] = found
    ? await tx<{ id: string }[]>`
        select id from public.contacts where account_id = ${account.id} and archived_at is null
          and ((${sale.email}::text is not null and lower(email) = lower(${sale.email})) or lower(name) = lower(${sale.name}))
        order by (role = 'primary') desc, created_at limit 1`
    : [];
  const [{ n: primaries }] = found
    ? await tx<{ n: number }[]>`select count(*)::int as n from public.contacts where account_id = ${account.id} and role = 'primary' and archived_at is null`
    : [{ n: 0 }];
  const contact =
    known ??
    (
      await tx<{ id: string }[]>`
        insert into public.contacts ${tx({ tenant_id: tenantId, account_id: account.id, property_id: property.id, name: sale.name, email: sale.email, phone: sale.phone, role: primaries ? "resident" : "primary" })} returning id`
    )[0];
  // A lead starts open (spec 02); the sale wins it in the same step.
  await tx`update public.leads set account_id = ${account.id}, property_id = ${property.id}, stage = 'won', won_at = now() where id = ${lead.id}`;
  const [terms] = await tx<{ agreement_terms: string | null }[]>`select agreement_terms from public.tenants where id = ${tenantId}`;
  if (!terms?.agreement_terms?.trim()) throw Object.assign(new Error("the company has no agreement terms to sign; set them under Settings"), { code: "23514" });
  const [branch] = await tx<{ id: string }[]>`
    select id from public.branches where tenant_id = ${tenantId} and archived_at is null order by (state_code = ${a.state_code}) desc, created_at limit 1`;
  const [agreement] = await tx<{ id: string }[]>`
    insert into public.agreements ${tx({
      tenant_id: tenantId, account_id: account.id, property_id: property.id, service_type_id: sale.service_type_id, branch_id: branch?.id ?? null, status: "draft",
      cadence: sale.cadence, cadence_rule: tx.json({}), skip_months: [], interior_only_months: [],
      initial_price_cents: sale.initial_price_cents, recurring_price_cents: sale.recurring_price_cents, billing_mode: sale.billing_mode,
      term_months: 12, auto_renew: true, cancel_fee_cents: 0, starts_on: sale.starts_on, first_visit_on: sale.starts_on,
      terms_text: terms.agreement_terms, sold_by: repId, knock_id: knockId, notes: "Sold at the door",
    })} returning id`;
  await tx`
    update public.agreements set status = 'active', signed_at = now(), signed_name = ${sale.signed_name}, signed_by_contact_id = ${contact.id}, signed_ip = ${sale.ip}
    where id = ${agreement.id}`;
  if (sale.signature_file_id) {
    await tx`update public.contacts set e_notice_consent_at = coalesce(e_notice_consent_at, now()), e_notice_consent_note = coalesce(e_notice_consent_note, 'signed at the door') where id = ${contact.id}`;
  }
  await syncVisits(tx, tenantId, agreement.id);
  const today = dateInZone(new Date(), timeZone);
  await issuePrepayments(tx, tenantId, today, timeZone);
  if (sale.card_token) {
    await addPaymentMethod(tx, tenantId, { account_id: account.id, token: sale.card_token, autopay: true, added_by: repId });
  }
  await tx`update public.knocks set lead_id = ${lead.id}, agreement_id = ${agreement.id} where id = ${knockId}`;
  await earnCommissions(tx, tenantId, agreement.id, today);
  return { agreement_id: agreement.id, account_id: account.id };
}

type PlanRow = Plan & { name: string };

/** Rule 4: the signed agreement's seller earns one held commission per active plan that covers them. */
export async function earnCommissions(tx: Sql, tenantId: string, agreementId: string, today: string): Promise<number> {
  const [g] = await tx<{ sold_by: string | null; starts_on: string; signed_at: Date | null }[]>`
    select sold_by, starts_on::text, signed_at from public.agreements where id = ${agreementId} and tenant_id = ${tenantId}`;
  if (!g?.sold_by || !g.signed_at) return 0;
  const [seller] = await tx<{ role_key: string }[]>`
    select r.key as role_key from public.memberships m join public.roles r on r.id = m.role_id where m.tenant_id = ${tenantId} and m.user_id = ${g.sold_by}`;
  if (!seller) return 0;
  const plans = await tx<PlanRow[]>`select * from public.commission_plans where tenant_id = ${tenantId} and active`;
  const visits = await tx<{ kind: string; due_start: string; price_cents: string }[]>`
    select kind, due_start::text, price_cents from public.visits where agreement_id = ${agreementId} order by due_start`;
  let made = 0;
  for (const plan of plans.filter((p) => covers(p, { user_id: g.sold_by as string, role_key: seller.role_key }))) {
    const { basis_cents, amount_cents } = commissionFor(plan, { starts_on: g.starts_on, signed_on: today, visits });
    if (amount_cents <= 0) continue;
    const r = await tx`
      insert into public.commissions (tenant_id, user_id, agreement_id, plan_id, basis_cents, amount_cents, earned_on, releasable_on)
      values (${tenantId}, ${g.sold_by}, ${agreementId}, ${plan.id}, ${basis_cents}, ${amount_cents}, ${today}, ${releasableOn(plan, today)})
      on conflict (agreement_id, plan_id, user_id) do nothing`;
    made += r.count;
  }
  return made;
}

export type CommissionCounts = { released: number; charged_back: number };

/**
 * Rules 5 and 6, for the billing job: held commissions whose hold has passed and whose agreement has enough paid
 * invoices become payable and post; commissions on agreements cancelled inside their plan's window are charged back,
 * and a released one's posting is reversed.
 */
export async function runCommissions(tx: Sql, tenantId: string, today: string): Promise<CommissionCounts> {
  const rows = await tx<
    {
      id: string;
      status: string;
      amount_cents: string;
      releasable_on: string;
      earned_on: string;
      agreement_id: string;
      agreement_number: number;
      cancelled_on: string | null;
      user_id: string;
      hold_paid_invoices: number;
      chargeback_days: number;
      paid_invoices: number;
    }[]
  >`
    select c.id, c.status, c.amount_cents, c.releasable_on::text, c.earned_on::text, c.agreement_id, g.number as agreement_number, g.cancelled_on::text, c.user_id,
           c.hold_paid_invoices, c.chargeback_days,
           (select count(*)::int from public.invoices i where i.agreement_id = c.agreement_id and i.kind = 'invoice' and i.status = 'paid') as paid_invoices
    from public.commissions c join public.agreements g on g.id = c.agreement_id
    where c.tenant_id = ${tenantId} and c.status in ('held', 'payable', 'paid')`;
  const counts: CommissionCounts = { released: 0, charged_back: 0 };
  for (const c of rows) {
    if (shouldChargeBack(c, c, c.earned_on, c.cancelled_on)) {
      const wasPosted = c.status !== "held";
      await tx`update public.commissions set status = 'charged_back', charged_back_on = ${today}, reason = ${`agreement cancelled ${c.cancelled_on}`} where id = ${c.id}`;
      if (wasPosted) {
        await postEntry(tx, tenantId, {
          source_type: "commission",
          source_key: `commission_chargeback:${c.id}`,
          source_id: c.id,
          posted_on: today,
          memo: `Commission charged back, agreement #${c.agreement_number} cancelled ${c.cancelled_on}`,
          lines: commissionLines(-Number(c.amount_cents)),
        });
      }
      counts.charged_back += 1;
      continue;
    }
    if (shouldRelease(c, c, today, c.paid_invoices)) {
      await tx`update public.commissions set status = 'payable', released_on = ${today} where id = ${c.id} and status = 'held'`;
      await postEntry(tx, tenantId, {
        source_type: "commission",
        source_key: `commission:${c.id}`,
        source_id: c.id,
        posted_on: today,
        memo: `Commission earned, agreement #${c.agreement_number}`,
        lines: commissionLines(Number(c.amount_cents)),
      });
      counts.released += 1;
    }
  }
  return counts;
}

/** Rule 7: one payout for a seller's payable commissions, net of paid ones since charged back; posts the payment. */
export async function payCommissions(
  tx: Sql,
  tenantId: string,
  userId: string,
  input: { paid_on: string; method: string; reference: string | null },
): Promise<{ payout_id: string | null; amount_cents: number }> {
  const payable = await tx<{ id: string; amount_cents: string }[]>`
    select id, amount_cents from public.commissions where tenant_id = ${tenantId} and user_id = ${userId} and status = 'payable' for update`;
  const owed = await tx<{ id: string; amount_cents: string }[]>`
    select id, amount_cents from public.commissions where tenant_id = ${tenantId} and user_id = ${userId} and status = 'charged_back' and paid_on is not null and recovered_payout_id is null for update`;
  const amount = payable.reduce((s, c) => s + Number(c.amount_cents), 0) - owed.reduce((s, c) => s + Number(c.amount_cents), 0);
  if (payable.length === 0 || amount <= 0) return { payout_id: null, amount_cents: 0 };
  const [payout] = await tx<{ id: string }[]>`
    insert into public.commission_payouts (tenant_id, user_id, paid_on, amount_cents, method, reference) values (${tenantId}, ${userId}, ${input.paid_on}, ${amount}, ${input.method}, ${input.reference})
    returning id`;
  await tx`update public.commissions set status = 'paid', paid_on = ${input.paid_on}, payout_id = ${payout.id} where id = any(${payable.map((c) => c.id)}::uuid[])`;
  if (owed.length) await tx`update public.commissions set recovered_payout_id = ${payout.id} where id = any(${owed.map((c) => c.id)}::uuid[])`;
  await postEntry(tx, tenantId, {
    source_type: "commission_payout",
    source_key: `commission_payout:${payout.id}`,
    source_id: payout.id,
    posted_on: input.paid_on,
    memo: `Commissions paid`,
    lines: commissionPayoutLines(amount),
  });
  return { payout_id: payout.id, amount_cents: amount };
}

export function holdLabel(c: { status: string; releasable_on: string }, today: string): string {
  if (c.status !== "held") return c.status.replace("_", " ");
  return c.releasable_on > today ? `held until ${c.releasable_on}` : `held for a paid invoice`;
}

export { addDays };
