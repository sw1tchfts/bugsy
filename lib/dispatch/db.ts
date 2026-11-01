// Dispatch operations against the database: load what the check needs, then write only when the check passes.
// Typed structurally so the office actions (under RLS) and the seed (superuser) share it.
import type postgres from "postgres";
import { loadSettings } from "@/lib/billing/db";
import type { JobKind, TreatmentArea } from "@/lib/catalog/service-lines";
import { getStatePack } from "@/lib/compliance/rules";
import { type ArrivalWindow, type CheckResult, type CrewMember, type CrewRole, type Credential, type StateRuleInput, checkAssignment } from "@/lib/dispatch/checks";

type Sql = postgres.Sql | postgres.TransactionSql;

export type DispatchVisit = {
  id: string;
  agreement_id: string | null;
  account_id: string;
  property_id: string;
  service_type_id: string;
  branch_id: string | null;
  kind: string;
  status: string;
  due_start: string;
  due_end: string;
  scheduled_for: string | null;
  technician_id: string | null;
  route_position: number | null;
  arrival_window: ArrivalWindow;
  job_kind: JobKind;
  treatment_areas: TreatmentArea[];
  property_state: string;
  registry_matches: unknown;
  /** Dates for which a registry advance notice is already sent (spec 07). */
  registry_notice_dates: string[];
  branch_license: { expires_on: string | null } | null;
  account_past_due_since: string | null;
  /** Wildlife work (spec 15 rule 3): whether the job's landowner authorization is on file. */
  authorization_on_file: boolean;
};

export type Technician = { user_id: string; name: string; branch_ids: string[] | null };
export type CrewSpec = { user_id: string; role: CrewRole };

export async function loadVisit(tx: Sql, tenantId: string, visitId: string): Promise<DispatchVisit | null> {
  const [row] = await tx<DispatchVisit[]>`
    select v.id, v.agreement_id, v.account_id, v.property_id, v.service_type_id, v.branch_id, v.kind, v.status, v.due_start, v.due_end, v.scheduled_for,
           v.technician_id, v.route_position, v.arrival_window, st.job_kind, st.treatment_areas, p.state_code as property_state, p.registry_matches,
           coalesce((select array_agg(distinct n.for_scheduled_for::text) from public.notices n
                     where n.tenant_id = v.tenant_id and n.visit_id = v.id and n.kind = 'registry_advance' and n.status = 'sent' and n.for_scheduled_for is not null), '{}') as registry_notice_dates,
           case when b.id is null then null else jsonb_build_object('expires_on', b.license_expires_on::text) end as branch_license,
           ac.past_due_since::text as account_past_due_since,
           exists (select 1 from public.job_authorizations ja where ja.tenant_id = v.tenant_id and ja.agreement_id = v.agreement_id) as authorization_on_file
    from public.visits v join public.service_types st on st.id = v.service_type_id join public.properties p on p.id = v.property_id
      join public.accounts ac on ac.id = v.account_id
      left join public.branches b on b.id = v.branch_id
    where v.id = ${visitId} and v.tenant_id = ${tenantId}`;
  return row ?? null;
}

/** Members whose role lets them complete visits: the people who can be on the board. */
export async function listTechnicians(tx: Sql, tenantId: string): Promise<Technician[]> {
  return tx<Technician[]>`
    select m.user_id, coalesce(m.display_name, d.email, 'Member') as name, m.branch_ids
    from public.memberships m
      join public.roles r on r.id = m.role_id
      left join app.member_directory(${tenantId}) d on d.user_id = m.user_id
    where m.tenant_id = ${tenantId} and ('*' = any(r.permissions) or 'visits.write' = any(r.permissions))
    order by name`;
}

export async function listMembers(tx: Sql, tenantId: string): Promise<Technician[]> {
  return tx<Technician[]>`
    select m.user_id, coalesce(m.display_name, d.email, 'Member') as name, m.branch_ids
    from public.memberships m left join app.member_directory(${tenantId}) d on d.user_id = m.user_id
    where m.tenant_id = ${tenantId} order by name`;
}

export async function credentialFor(tx: Sql, tenantId: string, userId: string, stateCode: string): Promise<Credential | null> {
  const [row] = await tx<Credential[]>`
    select cert_number, categories, cert_expires_on, license_expires_on, trainee_registered_on, supervisor_id
    from public.applicator_credentials where tenant_id = ${tenantId} and user_id = ${userId} and state_code = ${stateCode} and archived_at is null`;
  return row ?? null;
}

export async function stateRuleFor(tx: Sql, tenantId: string, serviceTypeId: string, stateCode: string): Promise<StateRuleInput> {
  const [row] = await tx<{ required_cert_categories: string[]; pack_version: string | null; confirmed_at: string | null }[]>`
    select required_cert_categories, pack_version, confirmed_at from public.service_type_state_rules
    where tenant_id = ${tenantId} and service_type_id = ${serviceTypeId} and state_code = ${stateCode}`;
  return row ?? null;
}

export async function loadCrew(tx: Sql, tenantId: string, visitId: string): Promise<CrewSpec[]> {
  return tx<CrewSpec[]>`select user_id, role from public.visit_crew where tenant_id = ${tenantId} and visit_id = ${visitId} order by case role when 'lead' then 0 else 1 end`;
}

async function buildCrew(tx: Sql, tenantId: string, stateCode: string, spec: readonly CrewSpec[]): Promise<CrewMember[]> {
  const members = await listMembers(tx, tenantId);
  const crew: CrewMember[] = [];
  for (const s of spec) {
    const member = members.find((m) => m.user_id === s.user_id);
    crew.push({
      user_id: s.user_id,
      name: member?.name ?? "Unknown member",
      role: s.role,
      credential: await credentialFor(tx, tenantId, s.user_id, stateCode),
      branch_ids: member?.branch_ids ?? null,
    });
  }
  return crew;
}

/** Runs the dispatch check for a visit on a date with a crew, with the lead's other stops that day for the order warning. */
export async function runCheck(tx: Sql, tenantId: string, visit: DispatchVisit, date: string, spec: readonly CrewSpec[], today: string, position: number | null = null): Promise<CheckResult> {
  const lead = spec.find((s) => s.role === "lead");
  const others = lead
    ? await tx<{ id: string; arrival_window: ArrivalWindow; route_position: number }[]>`
        select id, arrival_window, coalesce(route_position, 999) as route_position from public.visits
        where tenant_id = ${tenantId} and technician_id = ${lead.user_id} and scheduled_for = ${date} and id <> ${visit.id}
          and status in ('scheduled', 'en_route', 'in_progress')`
    : [];
  const myPosition = position ?? Math.max(0, ...others.map((o) => o.route_position)) + 1;
  const billing = visit.account_past_due_since ? await loadSettings(tx, tenantId) : null;
  return checkAssignment({
    visit: { ...visit, scheduled_for: date, registry_notice_sent: visit.registry_notice_dates.includes(date), pause_when_past_due: billing?.pause_when_past_due ?? false },
    stateRule: await stateRuleFor(tx, tenantId, visit.service_type_id, visit.property_state),
    crew: await buildCrew(tx, tenantId, visit.property_state, spec),
    pack: getStatePack(visit.property_state),
    today,
    dayStops: [...others, { id: visit.id, arrival_window: visit.arrival_window, route_position: myPosition }],
    visitId: visit.id,
    serviceTypeId: visit.service_type_id,
  });
}

const CLEAR: CheckResult = { ok: true, blockers: [], warnings: [] };

export function withLead(spec: readonly CrewSpec[], technicianId: string): CrewSpec[] {
  return [{ user_id: technicianId, role: "lead" as const }, ...spec.filter((s) => s.user_id !== technicianId && s.role !== "lead")];
}

async function writeCrew(tx: Sql, tenantId: string, visitId: string, spec: readonly CrewSpec[]): Promise<void> {
  await tx`delete from public.visit_crew where tenant_id = ${tenantId} and visit_id = ${visitId}`;
  for (const s of spec) {
    await tx`insert into public.visit_crew (tenant_id, visit_id, user_id, role) values (${tenantId}, ${visitId}, ${s.user_id}, ${s.role})`;
  }
}

async function nextPosition(tx: Sql, tenantId: string, technicianId: string, date: string): Promise<number> {
  const [{ next }] = await tx<{ next: number }[]>`
    select coalesce(max(route_position), 0) + 1 as next from public.visits
    where tenant_id = ${tenantId} and technician_id = ${technicianId} and scheduled_for = ${date} and status in ('scheduled', 'en_route', 'in_progress')`;
  return next;
}

/** Puts a visit on a technician's day (rule 1). Writes nothing when a blocker fires. */
export async function scheduleVisit(tx: Sql, tenantId: string, visitId: string, technicianId: string, date: string, today: string): Promise<CheckResult> {
  const visit = await loadVisit(tx, tenantId, visitId);
  if (!visit) throw new Error("visit not found");
  if (!["planned", "scheduled"].includes(visit.status)) {
    return { ok: false, blockers: [{ code: "not_schedulable", message: `A ${visit.status.replace("_", " ")} visit cannot be scheduled from the board.` }], warnings: [] };
  }
  const spec = withLead(await loadCrew(tx, tenantId, visitId), technicianId);
  const sameDay = visit.scheduled_for === date && visit.technician_id === technicianId;
  const position = sameDay && visit.route_position ? visit.route_position : await nextPosition(tx, tenantId, technicianId, date);
  const result = await runCheck(tx, tenantId, visit, date, spec, today, position);
  if (!result.ok) return result;
  await tx`
    update public.visits set status = 'scheduled', scheduled_for = ${date}, technician_id = ${technicianId}, route_position = ${position}
    where id = ${visitId} and tenant_id = ${tenantId}`;
  await writeCrew(tx, tenantId, visitId, spec);
  if (visit.scheduled_for && visit.technician_id && !sameDay) await compactDay(tx, tenantId, visit.technician_id, visit.scheduled_for);
  return result;
}

/** Back to the due panel. Only a scheduled visit comes back; started and finished ones are read only here (rule 9). */
export async function unscheduleVisit(tx: Sql, tenantId: string, visitId: string): Promise<void> {
  const visit = await loadVisit(tx, tenantId, visitId);
  if (!visit) throw new Error("visit not found");
  if (visit.status !== "scheduled") throw Object.assign(new Error(`a ${visit.status.replace("_", " ")} visit cannot be unscheduled`), { code: "23514" });
  await tx`update public.visits set status = 'planned' where id = ${visitId} and tenant_id = ${tenantId} and status = 'scheduled'`;
  await tx`delete from public.visit_crew where tenant_id = ${tenantId} and visit_id = ${visitId} and role = 'lead'`;
  if (visit.scheduled_for && visit.technician_id) await compactDay(tx, tenantId, visit.technician_id, visit.scheduled_for);
}

/** Renumbers a technician's day 1..n in the current order. */
export async function compactDay(tx: Sql, tenantId: string, technicianId: string, date: string): Promise<void> {
  const stops = await tx<{ id: string }[]>`
    select id from public.visits where tenant_id = ${tenantId} and technician_id = ${technicianId} and scheduled_for = ${date}
      and status in ('scheduled', 'en_route', 'in_progress') order by route_position nulls last, due_start, sequence`;
  for (const [i, stop] of stops.entries()) {
    await tx`update public.visits set route_position = ${i + 1} where id = ${stop.id} and tenant_id = ${tenantId}`;
  }
}

/** Moves a stop one place up or down within its day, then re-runs the check in the new order (rule 1); a blocker undoes the swap. */
export async function reorderVisit(tx: Sql, tenantId: string, visitId: string, direction: "up" | "down", today: string): Promise<CheckResult> {
  const visit = await loadVisit(tx, tenantId, visitId);
  if (!visit?.scheduled_for || !visit.technician_id) return CLEAR;
  await compactDay(tx, tenantId, visit.technician_id, visit.scheduled_for);
  const stops = await tx<{ id: string; route_position: number }[]>`
    select id, route_position from public.visits where tenant_id = ${tenantId} and technician_id = ${visit.technician_id} and scheduled_for = ${visit.scheduled_for}
      and status in ('scheduled', 'en_route', 'in_progress') order by route_position`;
  const index = stops.findIndex((s) => s.id === visitId);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= stops.length) return CLEAR;
  const a = stops[index];
  const b = stops[swapWith];
  await tx`update public.visits set route_position = ${b.route_position} where id = ${a.id} and tenant_id = ${tenantId}`;
  await tx`update public.visits set route_position = ${a.route_position} where id = ${b.id} and tenant_id = ${tenantId}`;
  const result = await runCheck(tx, tenantId, visit, visit.scheduled_for, await loadCrew(tx, tenantId, visitId), today, b.route_position);
  if (!result.ok) {
    await tx`update public.visits set route_position = ${a.route_position} where id = ${a.id} and tenant_id = ${tenantId}`;
    await tx`update public.visits set route_position = ${b.route_position} where id = ${b.id} and tenant_id = ${tenantId}`;
  }
  return result;
}

export type DayMove = { moved: string[]; refused: { visitId: string; issues: string[] }[] };

/** Moves a technician's whole day (rule 8). Each visit is re-checked for the new date; the ones that fail stay. */
export async function moveDay(tx: Sql, tenantId: string, technicianId: string, from: string, to: string, today: string, append: boolean): Promise<DayMove> {
  const [{ n: existing }] = await tx<{ n: number }[]>`
    select count(*)::int as n from public.visits where tenant_id = ${tenantId} and technician_id = ${technicianId} and scheduled_for = ${to} and status in ('scheduled', 'en_route', 'in_progress')`;
  if (existing > 0 && !append) {
    throw Object.assign(new Error(`${to} already has ${existing} stop${existing === 1 ? "" : "s"} for this technician; choose to append to that day`), { code: "23514" });
  }
  const stops = await tx<{ id: string }[]>`
    select id from public.visits where tenant_id = ${tenantId} and technician_id = ${technicianId} and scheduled_for = ${from} and status = 'scheduled' order by route_position nulls last`;
  const result: DayMove = { moved: [], refused: [] };
  let position = await nextPosition(tx, tenantId, technicianId, to);
  for (const stop of stops) {
    const visit = await loadVisit(tx, tenantId, stop.id);
    if (!visit) continue;
    const check = await runCheck(tx, tenantId, visit, to, await loadCrew(tx, tenantId, stop.id), today, position);
    if (!check.ok) {
      result.refused.push({ visitId: stop.id, issues: check.blockers.map((b) => b.message) });
      continue;
    }
    await tx`update public.visits set scheduled_for = ${to}, route_position = ${position} where id = ${stop.id} and tenant_id = ${tenantId}`;
    result.moved.push(stop.id);
    position += 1;
  }
  await compactDay(tx, tenantId, technicianId, from);
  return result;
}

/** Replaces the crew; exactly one lead, who becomes the visit's technician. Scheduled visits are re-checked first. */
export async function setCrew(tx: Sql, tenantId: string, visitId: string, spec: readonly CrewSpec[], today: string): Promise<CheckResult> {
  const visit = await loadVisit(tx, tenantId, visitId);
  if (!visit) throw new Error("visit not found");
  if (!["planned", "scheduled"].includes(visit.status)) {
    // The crew of a started or finished visit is part of its legal record (spec 06 rule 6).
    return { ok: false, blockers: [{ code: "not_schedulable", message: `The crew of a ${visit.status.replace("_", " ")} visit cannot be changed.` }], warnings: [] };
  }
  const leads = spec.filter((s) => s.role === "lead");
  if (leads.length !== 1) return { ok: false, blockers: [{ code: "one_lead", message: "A crew has exactly one lead." }], warnings: [] };
  const unique = new Set(spec.map((s) => s.user_id));
  if (unique.size !== spec.length) return { ok: false, blockers: [{ code: "duplicate_member", message: "A person appears once on a crew." }], warnings: [] };
  let result: CheckResult = CLEAR;
  if (visit.scheduled_for && visit.status !== "planned") {
    // A new lead takes the next slot on their own day; the old lead's day closes the gap (rule 1).
    const newLead = leads[0].user_id;
    const leadChanged = newLead !== visit.technician_id;
    const position = leadChanged ? await nextPosition(tx, tenantId, newLead, visit.scheduled_for) : visit.route_position;
    result = await runCheck(tx, tenantId, visit, visit.scheduled_for, spec, today, position);
    if (!result.ok) return result;
    await tx`update public.visits set technician_id = ${newLead}, route_position = ${position} where id = ${visitId} and tenant_id = ${tenantId}`;
    if (leadChanged && visit.technician_id) await compactDay(tx, tenantId, visit.technician_id, visit.scheduled_for);
  }
  await writeCrew(tx, tenantId, visitId, spec);
  return result;
}
