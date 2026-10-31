// Spec 05 seed: display names, applicator credentials in the tenant's state, confirmed state rules where no pack is
// researched, and a few stops on this week's board. Called from seed.ts after agreements.
import type postgres from "postgres";
import { addMonths, todayInZone } from "../lib/dates";
import { scheduleVisit } from "../lib/dispatch/db";
import { isWeekend, weekDays, weekOf } from "../lib/dispatch/week";
import { ROLE_KEYS, type SeedTenant, seedUserEmail } from "./seed-data";

type Sql = postgres.Sql;

/** Display names per role: one set per demo company. */
const NAMES: Record<(typeof ROLE_KEYS)[number], [string, string]> = {
  owner: ["Dana Whitfield", "Morgan Hale"],
  office: ["Jordan Ellis", "Priya Shah"],
  dispatcher: ["Casey Morgan", "Luis Ortega"],
  technician: ["Sam Rivera", "Taylor Brooks"],
  sales_rep: ["Alex Kim", "Jamie Fox"],
  compliance_manager: ["Lee Thompson", "Avery Nguyen"],
  bookkeeper: ["Robin Diaz", "Chris Patel"],
};

export async function seedDispatch(sql: Sql, tenant: SeedTenant, tenantId: string, tenantIndex: number): Promise<void> {
  const today = todayInZone(tenant.timezone);
  const state = tenant.branches[0].stateCode;
  const year = Number(today.slice(0, 4));

  const userId = async (key: (typeof ROLE_KEYS)[number]) => (await sql<{ id: string }[]>`select id from auth.users where email = ${seedUserEmail(tenant, key)}`)[0].id;
  for (const key of ROLE_KEYS) {
    await sql`update public.memberships set display_name = ${NAMES[key][tenantIndex % 2]} where tenant_id = ${tenantId} and user_id = ${await userId(key)} and display_name is null`;
  }

  const technician = await userId("technician");
  const manager = await userId("compliance_manager");
  const credentials = [
    { user: technician, cert: `${state}-APP-1042`, categories: ["7A", "7F"], certExpires: addMonths(today, 14), license: `${state}-LIC-88`, supervisor: manager },
    { user: manager, cert: `${state}-APP-0007`, categories: ["7A", "7B", "7F", "10"], certExpires: addMonths(today, 20), license: `${state}-LIC-12`, supervisor: null },
  ];
  for (const c of credentials) {
    await sql`
      insert into public.applicator_credentials (tenant_id, user_id, state_code, cert_number, categories, cert_expires_on, license_number, license_expires_on, license_year, supervisor_id, notes)
      values (${tenantId}, ${c.user}, ${state}, ${c.cert}, ${c.categories}, ${c.certExpires}, ${c.license}, ${`${year + 1}-12-31`}, ${year + 1}, ${c.supervisor}, 'Demo credential; categories are placeholders until the state pack is researched.')
      on conflict (tenant_id, user_id, state_code) where archived_at is null do nothing`;
  }

  // No pack is researched for any state yet: the demo licensed manager has confirmed the seeded service types' rules.
  await sql`
    update public.service_type_state_rules set confirmed_at = now(), confirmed_by = ${manager}
    where tenant_id = ${tenantId} and pack_version is null and confirmed_at is null`;

  // Three due visits on this week's board for the technician, on the next weekday.
  const week = weekDays(weekOf(today));
  const target = week.find((d) => d >= today && !isWeekend(d)) ?? today;
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from public.visits where tenant_id = ${tenantId} and scheduled_for between ${week[0]} and ${week[6]} and status = 'scheduled'`;
  if (n === 0) {
    const due = await sql<{ id: string; due_start: string; due_end: string }[]>`
      select id, due_start, due_end from public.visits where tenant_id = ${tenantId} and status = 'planned' and due_start <= ${week[6]} order by due_end, sequence limit 3`;
    for (const [i, v] of due.entries()) {
      const date = v.due_start > target ? v.due_start : target;
      const result = await scheduleVisit(sql, tenantId, v.id, technician, date, today);
      if (!result.ok) console.warn(`seed: could not schedule visit ${v.id}: ${result.blockers.map((b) => b.message).join(" ")}`);
      else if (i === 0) await sql`update public.visits set arrival_window = 'morning' where id = ${v.id}`;
    }
  }
}
