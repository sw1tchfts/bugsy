// Spec 02 seed: customers, properties, units, contacts, leads and quotes for a tenant. Called from seed.ts.
import type postgres from "postgres";
import { normalizeAddress } from "../lib/geo/normalize";
import type { SeedTenant } from "./seed-data";

type Sql = postgres.Sql;

type Place = { line1: string; line2?: string; city: string; stateCode: string; postalCode: string; lat: number; lng: number };

/** Addresses per seed tenant, in that tenant's state, with hand-placed pins. */
function places(tenant: SeedTenant): Record<"home" | "building" | "site1" | "site2" | "lead", Place> {
  if (tenant.domain === "northwind.test") {
    return {
      home: { line1: "1234 Neil Ave", city: "Columbus", stateCode: "OH", postalCode: "43201", lat: 39.985, lng: -83.011 },
      building: { line1: "88 Oakwood Ave", city: "Columbus", stateCode: "OH", postalCode: "43205", lat: 39.955, lng: -82.969 },
      site1: { line1: "250 High St", city: "Columbus", stateCode: "OH", postalCode: "43215", lat: 39.962, lng: -83.0 },
      site2: { line1: "7100 Sawmill Rd", city: "Dublin", stateCode: "OH", postalCode: "43016", lat: 40.11, lng: -83.09 },
      lead: { line1: "45 Maple Dr", city: "Westerville", stateCode: "OH", postalCode: "43081", lat: 40.126, lng: -82.929 },
    };
  }
  return {
    home: { line1: "310 Pine St", city: "Evanston", stateCode: "IL", postalCode: "60201", lat: 42.047, lng: -87.68 },
    building: { line1: "1500 Lake Shore Dr", city: "Chicago", stateCode: "IL", postalCode: "60610", lat: 41.909, lng: -87.628 },
    site1: { line1: "640 N Wells St", city: "Chicago", stateCode: "IL", postalCode: "60654", lat: 41.893, lng: -87.634 },
    site2: { line1: "2200 Green Bay Rd", city: "Evanston", stateCode: "IL", postalCode: "60201", lat: 42.057, lng: -87.69 },
    lead: { line1: "77 Cedar Ct", city: "Skokie", stateCode: "IL", postalCode: "60076", lat: 42.034, lng: -87.74 },
  };
}

async function insertProperty(sql: Sql, tenantId: string, accountId: string, name: string, place: Place, type: string, extra: Record<string, unknown> = {}) {
  const normalized = normalizeAddress(place);
  const [row] = await sql<{ id: string }[]>`
    insert into public.properties ${sql(
      {
        tenant_id: tenantId, account_id: accountId, name, line1: place.line1, line2: place.line2 ?? null, city: place.city,
        state_code: place.stateCode, postal_code: place.postalCode, normalized_address: normalized, lat: place.lat, lng: place.lng,
        geocode_status: "manual", property_type: type, ...extra,
      },
    )}
    on conflict do nothing
    returning id`;
  if (row) return row.id;
  const [existing] = await sql<{ id: string }[]>`select id from public.properties where tenant_id = ${tenantId} and normalized_address = ${normalized} and account_id = ${accountId}`;
  return existing.id;
}

async function ensureAccount(sql: Sql, tenantId: string, data: { type: string; name: string; email?: string; phone?: string; terms_days?: number }) {
  const [existing] = await sql<{ id: string }[]>`select id from public.accounts where tenant_id = ${tenantId} and name = ${data.name}`;
  if (existing) return existing.id;
  const [row] = await sql<{ id: string }[]>`insert into public.accounts ${sql({ tenant_id: tenantId, ...data })} returning id`;
  return row.id;
}

async function ensureContact(sql: Sql, tenantId: string, data: Record<string, unknown> & { name: string }) {
  const [existing] = await sql<{ id: string }[]>`
    select id from public.contacts where tenant_id = ${tenantId} and name = ${data.name}
      and account_id is not distinct from ${(data.account_id as string | undefined) ?? null}
      and property_id is not distinct from ${(data.property_id as string | undefined) ?? null}`;
  if (existing) return existing.id;
  const [row] = await sql<{ id: string }[]>`insert into public.contacts ${sql({ tenant_id: tenantId, ...data })} returning id`;
  return row.id;
}

export async function seedCustomers(sql: Sql, tenant: SeedTenant, tenantId: string, ownerUserId: string) {
  const p = places(tenant);
  const domain = tenant.domain;

  // A homeowner: one account, one property, one primary contact.
  const homeowner = await ensureAccount(sql, tenantId, { type: "residential", name: "Maria Lopez", email: `maria.lopez@${domain}`, phone: "614-555-0100" });
  const home = await insertProperty(sql, tenantId, homeowner, "Home", p.home, "house", { size_sqft: 2100, lot_sqft: 9000, measured_by: "manual" });
  await ensureContact(sql, tenantId, { account_id: homeowner, property_id: home, name: "Maria Lopez", email: `maria.lopez@${domain}`, phone: "614-555-0100", role: "primary", sms_opt_in: true, preferred_channel: "sms" });

  // A landlord with a three-unit building and a resident in each unit.
  const landlord = await ensureAccount(sql, tenantId, { type: "property_manager", name: "Oakwood Properties", email: `office@oakwood.${domain}`, phone: "614-555-0150", terms_days: 30 });
  const building = await insertProperty(sql, tenantId, landlord, "Oakwood Apartments", p.building, "apartment_building", { unit_count: 3 });
  await ensureContact(sql, tenantId, { account_id: landlord, name: "Dana Whitfield", email: `dana@oakwood.${domain}`, phone: "614-555-0151", role: "property_manager" });
  for (const [label, resident, phone] of [["1A", "Priya Natarajan", "614-555-0161"], ["1B", "Tom Becker", "614-555-0162"], ["2A", "Luis Ortega", "614-555-0163"]] as const) {
    const [unit] = await sql<{ id: string }[]>`
      insert into public.units (tenant_id, property_id, label, floor) values (${tenantId}, ${building}, ${label}, ${label[0]})
      on conflict (property_id, label) do update set floor = excluded.floor returning id`;
    await ensureContact(sql, tenantId, { property_id: building, unit_id: unit.id, name: resident, phone, role: "resident" });
  }

  // A restaurant group with two sites and a site contact at each.
  const group = await ensureAccount(sql, tenantId, { type: "commercial", name: "Riverside Hospitality Group", email: `ap@riverside.${domain}`, phone: "614-555-0200", terms_days: 30 });
  const site1 = await insertProperty(sql, tenantId, group, "Riverside Grill downtown", p.site1, "restaurant", { size_sqft: 4800 });
  const site2 = await insertProperty(sql, tenantId, group, "Riverside Grill north", p.site2, "restaurant", { size_sqft: 5200 });
  await ensureContact(sql, tenantId, { account_id: group, name: "Accounts payable", email: `ap@riverside.${domain}`, role: "billing" });
  await ensureContact(sql, tenantId, { account_id: group, property_id: site1, name: "Kim Park", phone: "614-555-0201", role: "site_contact" });
  await ensureContact(sql, tenantId, { account_id: group, property_id: site2, name: "Andre Dubois", phone: "614-555-0202", role: "site_contact" });

  // Leads: one in each open stage, one lost, one won and converted into the homeowner account.
  const sources = await sql<{ id: string; key: string }[]>`select id, key from public.lead_sources where tenant_id = ${tenantId}`;
  const source = (key: string) => sources.find((s) => s.key === key)!.id;
  const leadAddress = { line1: p.lead.line1, city: p.lead.city, state_code: p.lead.stateCode, postal_code: p.lead.postalCode, normalized_address: normalizeAddress(p.lead), lat: p.lead.lat, lng: p.lead.lng, geocode_status: "manual" };
  const leadRows: { name: string; stage: string; source: string; extra: Record<string, unknown> }[] = [
    { name: "Avery Chen", stage: "new", source: "website", extra: { email: `avery.chen@${domain}`, phone: "614-555-0301", property_type: "house", ...leadAddress } },
    { name: "Jordan Blake", stage: "inspection_booked", source: "phone", extra: { phone: "614-555-0302", property_type: "townhouse", inspection_at: new Date(Date.now() + 3 * 86400000), ...leadAddress, line1: "46 Maple Dr", normalized_address: normalizeAddress({ ...p.lead, line1: "46 Maple Dr" }) } },
    { name: "Casey Nguyen", stage: "quoted", source: "referral", extra: { email: `casey.nguyen@${domain}`, phone: "614-555-0303", property_type: "house", ...leadAddress, line1: "47 Maple Dr", normalized_address: normalizeAddress({ ...p.lead, line1: "47 Maple Dr" }) } },
    { name: "Robin Ellis", stage: "lost", source: "door_to_door", extra: { phone: "614-555-0304", lost_reason: "Chose another company", ...leadAddress, line1: "48 Maple Dr", normalized_address: normalizeAddress({ ...p.lead, line1: "48 Maple Dr" }) } },
    { name: "Maria Lopez", stage: "won", source: "referral", extra: { email: `maria.lopez@${domain}`, phone: "614-555-0100", property_type: "house", account_id: homeowner, property_id: home, ...leadAddress, line1: p.home.line1, city: p.home.city, postal_code: p.home.postalCode, normalized_address: normalizeAddress(p.home) } },
  ];
  const leadIds: Record<string, string> = {};
  for (const l of leadRows) {
    const [existing] = await sql<{ id: string }[]>`select id from public.leads where tenant_id = ${tenantId} and name = ${l.name}`;
    if (existing) {
      leadIds[l.name] = existing.id;
      continue;
    }
    // Insert in an open stage, then move, so the stage trigger's rules apply as they would in the app.
    const [row] = await sql<{ id: string }[]>`
      insert into public.leads ${sql({ tenant_id: tenantId, source_id: source(l.source), stage: "new", name: l.name, owner_id: ownerUserId, ...l.extra, lost_reason: null })} returning id`;
    if (l.stage !== "new") {
      await sql`update public.leads set stage = ${l.stage}, lost_reason = ${(l.extra.lost_reason as string | undefined) ?? null} where id = ${row.id}`;
    }
    leadIds[l.name] = row.id;
  }

  // A quote with two options on the quoted lead.
  const quotedLead = leadIds["Casey Nguyen"];
  const [existingQuote] = await sql<{ id: string }[]>`select id from public.quotes where tenant_id = ${tenantId} and lead_id = ${quotedLead}`;
  if (!existingQuote) {
    const [quote] = await sql<{ id: string }[]>`
      insert into public.quotes (tenant_id, lead_id, status, valid_until, notes)
      values (${tenantId}, ${quotedLead}, 'draft', current_date + 30, 'Quarterly general pest plan') returning id`;
    const [good] = await sql<{ id: string }[]>`
      insert into public.quote_options (tenant_id, quote_id, position, name, description) values (${tenantId}, ${quote.id}, 1, 'Quarterly plan', 'Initial service, then four visits a year') returning id`;
    const [better] = await sql<{ id: string }[]>`
      insert into public.quote_options (tenant_id, quote_id, position, name, description, recommended) values (${tenantId}, ${quote.id}, 2, 'Quarterly plan with mosquito season', 'Adds a six-round mosquito and tick program', true) returning id`;
    await sql`insert into public.quote_lines (tenant_id, option_id, position, description, kind, quantity, unit_price_cents) values
      (${tenantId}, ${good.id}, 1, 'Initial service and inspection', 'initial', 1, 22500),
      (${tenantId}, ${good.id}, 2, 'Quarterly visit', 'recurring', 4, 12500),
      (${tenantId}, ${better.id}, 1, 'Initial service and inspection', 'initial', 1, 22500),
      (${tenantId}, ${better.id}, 2, 'Quarterly visit', 'recurring', 4, 12500),
      (${tenantId}, ${better.id}, 3, 'Mosquito and tick round', 'recurring', 6, 8900)`;
    await sql`update public.quotes set status = 'sent' where id = ${quote.id}`;
  }
}
