// Spec 06 seed: UPCs on the demo products and one visit in progress for the demo technician, with a product line,
// notes, a photo, a signature and the sync ledger rows behind them, so the office page and the RLS suite have rows in
// every capture table. Called from seed.ts after dispatch.
import type postgres from "postgres";
import { checkLabelRate } from "../lib/catalog/label-rates";
import { todayInZone } from "../lib/dates";
import { scheduleVisit } from "../lib/dispatch/db";
import { putFile } from "../lib/files";
import { type SeedTenant, seedUserEmail } from "./seed-data";

type Sql = postgres.Sql;

/** Stand-in images: a photo of the treated perimeter and the customer's signature, both tiny SVGs. */
const DEMO_PHOTO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"><rect width="320" height="240" fill="#d6d3d1"/><rect y="150" width="320" height="90" fill="#78716c"/><rect x="40" y="60" width="240" height="100" fill="#f5f5f4" stroke="#57534e" stroke-width="3"/><text x="160" y="215" font-family="sans-serif" font-size="16" text-anchor="middle" fill="#fafaf9">Perimeter, north foundation</text></svg>`;
export const DEMO_SIGNATURE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80"><path d="M10 55 C 30 10, 50 70, 80 40 S 130 10, 150 50 S 200 60, 230 25" fill="none" stroke="#1c1917" stroke-width="2.5" stroke-linecap="round"/></svg>`;

/** The product master gets a demo UPC per EPA number so the scanner has something to find. */
export async function seedProductUpcs(sql: Sql): Promise<void> {
  await sql`update public.products set upc = 'DEMO-' || epa_reg_no where tenant_id is null and upc is null and epa_reg_no <> ''`;
}

export async function seedTechnician(sql: Sql, tenant: SeedTenant, tenantId: string): Promise<void> {
  const today = todayInZone(tenant.timezone);
  const [technician] = await sql<{ id: string }[]>`select id from auth.users where email = ${seedUserEmail(tenant, "technician")}`;

  // One stop in progress for the technician: an existing one from a previous run, else a planned visit scheduled for today and started.
  let [visit] = await sql<{ id: string; account_id: string }[]>`
    select id, account_id from public.visits where tenant_id = ${tenantId} and technician_id = ${technician.id} and status = 'in_progress' order by scheduled_for limit 1`;
  if (!visit) {
    const [planned] = await sql<{ id: string; account_id: string }[]>`
      select id, account_id from public.visits where tenant_id = ${tenantId} and status = 'planned' order by due_start, sequence limit 1`;
    if (!planned) return;
    const result = await scheduleVisit(sql, tenantId, planned.id, technician.id, today, today);
    if (!result.ok) {
      console.warn(`seed: could not start a visit for the technician: ${result.blockers.map((b) => b.message).join(" ")}`);
      return;
    }
    await sql`
      update public.visits set status = 'in_progress', arrived_at = now() - interval '25 minutes', started_by = ${technician.id}
      where id = ${planned.id} and tenant_id = ${tenantId}`;
    visit = planned;
  }

  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from public.visit_products where tenant_id = ${tenantId} and visit_id = ${visit.id}`;
  if (n > 0) return;

  const ledger: { kind: string }[] = [];

  // Demand CS on the exterior perimeter, 0.5 fl oz per gallon for ants, checked against the label as the device would.
  const [product] = await sql<{ id: string; label_rates: unknown }[]>`select id, label_rates from public.products where tenant_id is null and epa_reg_no = '100-1066'`;
  if (product) {
    const check = checkLabelRate(product, { site: "perimeter", amount: 0.5, amountUnit: "fl_oz", per: 1, perUnit: "gal" });
    await sql`
      insert into public.visit_products (tenant_id, visit_id, product_id, applied_by, site_treated, location_description, amount, amount_unit, carrier_amount, carrier_unit, target_pests, label_check, recorded_at)
      values (${tenantId}, ${visit.id}, ${product.id}, ${technician.id}, 'perimeter', 'Exterior foundation, 3 ft band', 0.5, 'fl_oz', 1, 'gal', ${["ants"]},
              ${sql.json({ status: check.status, reason: check.reason })}, now() - interval '12 minutes')`;
    ledger.push({ kind: "product" });
  }

  await sql`
    insert into public.visit_notes (tenant_id, visit_id, kind, content, recorded_at) values
      (${tenantId}, ${visit.id}, 'note', 'Ant trail along the north foundation into the garage. Treated the exterior perimeter and the garage entry.', now() - interval '10 minutes'),
      (${tenantId}, ${visit.id}, 'recommendation', 'Trim the shrubs back from the siding and seal the gap under the garage side door.', now() - interval '9 minutes')`;
  ledger.push({ kind: "note" }, { kind: "note" });

  const photoId = await putFile(sql, tenantId, { kind: "photo", contentType: "image/svg+xml", data: new TextEncoder().encode(DEMO_PHOTO) });
  await sql`
    insert into public.visit_photos (tenant_id, visit_id, file_id, kind, caption, taken_at)
    values (${tenantId}, ${visit.id}, ${photoId}, 'before', 'Ant trail at the north foundation', now() - interval '20 minutes')`;
  ledger.push({ kind: "photo" });

  const [contact] = await sql<{ name: string }[]>`
    select coalesce(c.name, a.name) as name
    from public.accounts a left join public.contacts c on c.account_id = a.id and c.role = 'primary' and c.archived_at is null
    where a.id = ${visit.account_id} order by c.created_at limit 1`;
  const signatureId = await putFile(sql, tenantId, { kind: "signature", contentType: "image/svg+xml", data: new TextEncoder().encode(DEMO_SIGNATURE) });
  await sql`
    insert into public.visit_signatures (tenant_id, visit_id, file_id, signer_name, signed_at)
    values (${tenantId}, ${visit.id}, ${signatureId}, ${contact?.name ?? "Customer"}, now() - interval '3 minutes')`;
  ledger.push({ kind: "signature" });

  // The device's sync ledger: every change above arrived once; the last one was sent twice and recognised the second time.
  for (const entry of ledger) {
    await sql`
      insert into public.sync_log (tenant_id, user_id, client_change_id, kind, visit_id, result)
      values (${tenantId}, ${technician.id}, gen_random_uuid(), ${entry.kind}, ${visit.id}, 'applied')`;
  }
  await sql`
    insert into public.sync_log (tenant_id, user_id, client_change_id, kind, visit_id, result, detail)
    values (${tenantId}, ${technician.id}, gen_random_uuid(), 'signature', ${visit.id}, 'duplicate', ${sql.json({ reason: "already applied" })})`;
}
