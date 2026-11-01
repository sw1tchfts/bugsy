// Spec 19 seed: branch coordinates, the company's routing settings, and a demo day three weekdays out for the
// company's first technician: four stops placed in a zigzag (the optimizer has miles to save) on a property manager's
// buildings, two visits due that day with no technician (one in a state the technician is not certified in), and a
// position from the phone for each technician. Idempotent.
import type postgres from "postgres";
import { normalizeAddress } from "../lib/geo/normalize";
import { addDays, todayInZone } from "../lib/dates";
import type { SeedTenant } from "./seed-data";

type Sql = postgres.Sql;

const BRANCH_POINTS: Record<string, { lat: number; lng: number }> = {
  "Main office": { lat: 39.9612, lng: -82.9988 },
  "East branch": { lat: 39.97, lng: -82.91 },
  "Lakeshore HQ": { lat: 41.885, lng: -87.62 },
  "North branch": { lat: 42.1275, lng: -87.829 },
};

/** The demo day: a weekday three or more days out (rule 5's pull-forward window covers it). */
export function routingDemoDay(today: string): string {
  let d = addDays(today, 3);
  while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = addDays(d, 1);
  return d;
}

export async function seedRouting(sql: Sql, tenant: SeedTenant, tenantId: string): Promise<void> {
  for (const [name, p] of Object.entries(BRANCH_POINTS)) await sql`update public.branches set lat = ${p.lat}, lng = ${p.lng} where tenant_id = ${tenantId} and name = ${name} and lat is null`;
  await sql`insert into public.route_settings (tenant_id) values (${tenantId}) on conflict (tenant_id) do nothing`;
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from public.visits where tenant_id = ${tenantId} and dispatch_notes like 'seed:route%'`;
  if (n) return;
  const [tech] = await sql<{ user_id: string }[]>`
    select m.user_id from public.memberships m join public.roles r on r.id = m.role_id where m.tenant_id = ${tenantId} and r.key = 'technician' order by m.created_at limit 1`;
  const [branch] = await sql<{ id: string; lat: number; lng: number; state_code: string }[]>`
    select id, lat, lng, state_code from public.branches where tenant_id = ${tenantId} and lat is not null order by created_at limit 1`;
  const [account] = await sql<{ id: string }[]>`select id from public.accounts where tenant_id = ${tenantId} and name = 'Oakwood Properties'`;
  const [service] = await sql<{ id: string }[]>`select id from public.service_types where tenant_id = ${tenantId} and name = 'General pest plan'`;
  if (!tech || !branch || !account || !service) return;
  const day = routingDemoDay(todayInZone(tenant.timezone));
  const city = tenant.branches[0].address.split(",")[1]?.trim() ?? "Columbus";
  const zip = tenant.branches[0].address.match(/\d{5}/)?.[0] ?? "43215";
  const place = async (label: string, dLat: number, dLng: number, state = branch.state_code) => {
    const line1 = `${100 + Math.round(Math.abs(dLng) * 1000)} ${label} Ave`;
    const [p] = await sql<{ id: string }[]>`
      insert into public.properties (tenant_id, account_id, name, property_type, line1, city, state_code, postal_code, normalized_address, lat, lng, geocode_status)
      values (${tenantId}, ${account.id}, ${`${label} building`}, 'apartment_building', ${line1}, ${city}, ${state}, ${zip},
              ${normalizeAddress({ line1, city, stateCode: state, postalCode: zip })}, ${branch.lat + dLat}, ${branch.lng + dLng}, 'manual')
      returning id`;
    return p.id;
  };
  // A zigzag along an east-west line: far east, far west, near east, near west.
  const zig = [
    { label: "Eastgate", dLng: 0.09, window: "morning" },
    { label: "Westgate", dLng: -0.08, window: "any" },
    { label: "Eastview", dLng: 0.04, window: "any" },
    { label: "Westview", dLng: -0.035, window: "afternoon" },
  ];
  for (const [i, z] of zig.entries()) {
    const property = await place(z.label, 0.003 * i, z.dLng);
    await sql`
      insert into public.visits (tenant_id, account_id, property_id, service_type_id, branch_id, kind, status, due_start, due_end, scheduled_for, technician_id, route_position, arrival_window, dispatch_notes)
      values (${tenantId}, ${account.id}, ${property}, ${service.id}, ${branch.id}, 'inspection', 'planned', ${addDays(day, -3)}, ${addDays(day, 3)}, null, null, null, ${z.window}, ${`seed:route ${i + 1}`})`;
    await sql`update public.visits set status = 'scheduled', scheduled_for = ${day}, technician_id = ${tech.user_id}, route_position = ${i + 1}
              where tenant_id = ${tenantId} and dispatch_notes = ${`seed:route ${i + 1}`}`;
    await sql`insert into public.visit_crew (tenant_id, visit_id, user_id, role) select ${tenantId}, id, ${tech.user_id}, 'lead' from public.visits where tenant_id = ${tenantId} and dispatch_notes = ${`seed:route ${i + 1}`}`;
  }
  // Last week's optimized day, as the record of a run the dispatcher applied.
  await sql`insert into public.route_runs (tenant_id, kind, technician_id, date, before, after, miles_before, miles_after, applied_at)
            values (${tenantId}, 'optimize', ${tech.user_id}, ${addDays(day, -7)}, '[]'::jsonb, '[]'::jsonb, 24.6, 17.9, now() - interval '7 days')`;
  // Where the technician was last seen, near the branch.
  await sql`insert into public.technician_positions (tenant_id, user_id, lat, lng, accuracy_m, recorded_at)
            values (${tenantId}, ${tech.user_id}, ${branch.lat + 0.004}, ${branch.lng + 0.006}, 12, now() - interval '20 minutes')`;
  // Due that day, no technician: one near the route, one in a neighboring state.
  const near = await place("Midtown", 0.01, 0.02);
  const away = await place("Stateline", 0.02, -0.05, branch.state_code === "OH" ? "IN" : "WI");
  for (const [property, note] of [[near, "seed:route due"], [away, "seed:route other state"]] as const) {
    await sql`
      insert into public.visits (tenant_id, account_id, property_id, service_type_id, branch_id, kind, status, due_start, due_end, arrival_window, dispatch_notes)
      values (${tenantId}, ${account.id}, ${property}, ${service.id}, ${branch.id}, 'inspection', 'planned', ${addDays(day, -2)}, ${addDays(day, 4)}, 'any', ${note})`;
  }
}
