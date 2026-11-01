// Spec 14 seed: per company, the commercial device service type and one mapped restaurant site (Corner Bistro) with ten devices, six
// months of checks entered from paper (one multi-catch trap hot), an open sighting, one overdue and one closed
// recommendation, and the pest program document. Idempotent. Called from seed.ts.
import type postgres from "postgres";
import { ensureStateRules } from "../lib/catalog/state-rules";
import { floorPlan } from "../lib/commercial/image";
import { addMonths, todayInZone } from "../lib/dates";
import { putFile } from "../lib/files";
import type { SeedTenant } from "./seed-data";
import { seedUserEmail } from "./seed-data";

type Sql = postgres.Sql;

const DEVICES: { n: string; kind: string; zone: string; location: string; x: number; y: number }[] = [
  { n: "1", kind: "bait_station", zone: "exterior", location: "Northwest corner, by the dumpster pad", x: 0.04, y: 0.08 },
  { n: "2", kind: "bait_station", zone: "exterior", location: "Northeast corner, grease bin", x: 0.96, y: 0.08 },
  { n: "3", kind: "bait_station", zone: "exterior", location: "Southeast corner, rear dock", x: 0.96, y: 0.92 },
  { n: "4", kind: "bait_station", zone: "exterior", location: "Southwest corner, patio fence", x: 0.04, y: 0.92 },
  { n: "5", kind: "multi_catch", zone: "interior", location: "Dry storage, behind the rice shelf", x: 0.22, y: 0.28 },
  { n: "6", kind: "multi_catch", zone: "interior", location: "Kitchen, under the dish machine", x: 0.42, y: 0.72 },
  { n: "7", kind: "multi_catch", zone: "interior", location: "Walk-in cooler, left of the door", x: 0.72, y: 0.3 },
  { n: "8", kind: "multi_catch", zone: "interior", location: "Bar back, under the ice well", x: 0.8, y: 0.74 },
  { n: "9", kind: "insect_light_trap", zone: "interior", location: "Kitchen, above the back door", x: 0.35, y: 0.12 },
  { n: "10", kind: "insect_light_trap", zone: "interior", location: "Receiving, by the dock door", x: 0.66, y: 0.88 },
];

// A small valid PDF, the pest program on file for the seed site.
const PROGRAM_PDF = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";

export async function seedCommercial(sql: Sql, tenant: SeedTenant, tenantId: string): Promise<void> {
  const today = todayInZone(tenant.timezone);
  const [manager] = await sql<{ id: string }[]>`select id from auth.users where email = ${seedUserEmail(tenant, "compliance_manager")}`;
  const [serviceType] = await sql<{ id: string }[]>`
    insert into public.service_types (tenant_id, service_line, name, description, job_kind, treatment_areas, pricing_method, default_duration_minutes, device_kinds)
    values (${tenantId}, 'rodent', 'Commercial device service', 'Scheduled service of barcoded stations, traps and insect light traps at a commercial site.', 'device_service',
            ${["devices"]}, 'price_book', 90, ${["bait_station", "rodent_trap", "multi_catch", "glue_board", "insect_light_trap"]})
    on conflict (tenant_id, lower(name)) where archived_at is null do update set device_kinds = excluded.device_kinds
    returning id`;
  const states = await sql<{ state_code: string }[]>`select distinct state_code from public.branches where tenant_id = ${tenantId}`;
  await ensureStateRules(sql, tenantId, serviceType.id, states.map((s) => s.state_code));
  if (manager) {
    await sql`update public.service_type_state_rules set confirmed_at = now(), confirmed_by = ${manager.id}
              where tenant_id = ${tenantId} and service_type_id = ${serviceType.id} and pack_version is null and confirmed_at is null`;
  }

  const [property] = await sql<{ id: string }[]>`
    select p.id from public.properties p join public.accounts a on a.id = p.account_id
    where p.tenant_id = ${tenantId} and a.name = 'Corner Bistro' and p.archived_at is null order by p.created_at limit 1`;
  if (!property) return;
  const [existing] = await sql<{ id: string }[]>`select id from public.site_maps where property_id = ${property.id} limit 1`;
  if (existing) return;

  const png = await floorPlan(800, 500);
  const fileId = await putFile(sql, tenantId, { kind: "document", contentType: "image/png", data: png });
  const [map] = await sql<{ id: string }[]>`
    insert into public.site_maps (tenant_id, property_id, name, file_id, width, height) values (${tenantId}, ${property.id}, 'Restaurant, ground floor', ${fileId}, 800, 500) returning id`;
  const prefix = tenant.name.slice(0, 2).toUpperCase();
  const ids = new Map<string, { id: string; kind: string }>();
  for (const d of DEVICES) {
    const [row] = await sql<{ id: string }[]>`
      insert into public.devices (tenant_id, property_id, number, barcode, kind, zone, location, map_id, x, y, installed_on)
      values (${tenantId}, ${property.id}, ${d.n}, ${`${prefix}-${d.n.padStart(4, "0")}`}, ${d.kind}, ${d.zone}, ${d.location}, ${map.id}, ${d.x}, ${d.y}, ${addMonths(today, -7)})
      returning id`;
    ids.set(d.n, { id: row.id, kind: d.kind });
  }

  // Six months of checks from paper service reports, on the 10th. Trap 6 has caught mice the last two months.
  for (let m = 6; m >= 1; m -= 1) {
    const day = `${addMonths(today, -m).slice(0, 7)}-10`;
    for (const d of DEVICES) {
      const device = ids.get(d.n) as { id: string; kind: string };
      const hot = d.n === "6" && m <= 2;
      const ilt = d.kind === "insect_light_trap";
      const count = ilt ? 3 + ((m * 7 + Number(d.n)) % 9) : hot ? 2 : 0;
      const bait = d.kind === "bait_station" ? (d.n === "2" && m === 3 ? 25 : 0) : null;
      const activity = hot ? "medium" : ilt && count > 8 ? "low" : bait ? "low" : "none";
      await sql`
        insert into public.device_checks (tenant_id, device_id, visit_id, checked_at, source, status, activity, count, bait_consumed_pct, pest, actions, notes)
        values (${tenantId}, ${device.id}, null, (${day}::date + time '12:00') at time zone ${tenant.timezone}, 'office', 'checked', ${activity}, ${count}, ${bait},
                ${hot ? "house mouse" : ilt ? "flies" : null}, ${ilt ? ["glue_board_replaced"] : hot ? ["cleaned"] : []}, ${hot ? "Droppings near the trap; caught two." : null})`;
    }
  }

  await sql`
    insert into public.sightings (tenant_id, property_id, seen_at, location, pest, count, reported_by, source, notes)
    values (${tenantId}, ${property.id}, now() - interval '5 days', 'Dry storage, back corner', 'Mouse droppings', null, 'Kitchen manager', 'customer', 'Found at opening on a flour sack.')`;
  await sql`
    insert into public.recommendations (tenant_id, property_id, category, description, responsibility, priority, owner_name, due_on)
    values (${tenantId}, ${property.id}, 'exclusion', 'Seal the gap under the rear dock door (about half an inch at the left corner).', 'customer', 'high', 'Facilities manager', ${addMonths(today, -1)})`;
  await sql`
    insert into public.recommendations (tenant_id, property_id, category, description, responsibility, priority, owner_name, due_on, status, closed_on, closed_note)
    values (${tenantId}, ${property.id}, 'storage', 'Keep cardboard off the dry storage floor; store on shelving six inches up.', 'customer', 'medium', 'Kitchen manager',
            ${addMonths(today, -3)}, 'closed', ${addMonths(today, -2)}, 'Shelving installed; checked at the next visit.')`;
  const pdf = await putFile(sql, tenantId, { kind: "document", contentType: "application/pdf", data: new TextEncoder().encode(PROGRAM_PDF) });
  await sql`
    insert into public.site_documents (tenant_id, property_id, file_id, title, kind, valid_until)
    values (${tenantId}, ${property.id}, ${pdf}, 'Integrated pest management program', 'program', ${addMonths(today, 6)})`;
}
