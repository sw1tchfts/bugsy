// Routing's database work (spec 19), on the caller's connection: a technician's day with coordinates, suggestions
// recorded as runs and applied through the dispatch check when the day is still what was previewed, fill-ins,
// positions, and the on-the-way estimate.
import type postgres from "postgres";
import { addDays, dateInZone } from "@/lib/dates";
import { type CrewSpec, loadCrew, loadVisit, runCheck, scheduleVisit, withLead } from "@/lib/dispatch/db";
import type { CheckResult } from "@/lib/dispatch/checks";
import { type Point, driveMinutes, hasPoint, miles } from "./geo";
import { type Eta, type FillIn, type Placement, type Settings, type Stop, type Window, assignDay, bestInsertion, estimates, insertStop, optimizeDay, rankFillIns, routeBox, routeMiles, toMin } from "./optimize";

type Sql = postgres.Sql | postgres.TransactionSql;

const fail = (message: string, code = "23514"): never => {
  throw Object.assign(new Error(message), { code });
};

const CHANGED = "The day changed; preview again.";

export type RouteSettings = Settings & { fill_in_miles: number; position_days: number; max_stops: number };

export async function routeSettings(tx: Sql, tenantId: string): Promise<RouteSettings> {
  const [r] = await tx<{ mph: string; day_start: string; morning_ends: string; afternoon_ends: string; fill_in_miles: string; position_days: number }[]>`
    select average_speed_mph::text as mph, to_char(day_starts_at, 'HH24:MI') as day_start, to_char(morning_ends_at, 'HH24:MI') as morning_ends,
           to_char(afternoon_ends_at, 'HH24:MI') as afternoon_ends, fill_in_miles::text, position_days
    from public.route_settings where tenant_id = ${tenantId}`;
  // The company's stop limit per technician day (spec 16) is the dispatch check's max stops (rule 4).
  const [p] = await tx<{ max_stops_per_day: number }[]>`select max_stops_per_day from public.portal_settings where tenant_id = ${tenantId}`;
  const max_stops = p?.max_stops_per_day ?? 18;
  return r
    ? { mph: Number(r.mph), day_start: r.day_start, morning_ends: r.morning_ends, afternoon_ends: r.afternoon_ends, fill_in_miles: Number(r.fill_in_miles), position_days: r.position_days, max_stops }
    : { mph: 25, day_start: "08:00", morning_ends: "12:00", afternoon_ends: "17:00", fill_in_miles: 5, position_days: 30, max_stops };
}

export type DayStop = Stop & { visit_id: string; account_name: string; address: string; status: string };

type StopRow = { id: string; lat: number | null; lng: number | null; arrival_window: Window; minutes: number; account_name: string; address: string };

const toStop = (r: StopRow, position: number): DayStop => ({
  id: r.id,
  visit_id: r.id,
  lat: r.lat === null ? null : Number(r.lat),
  lng: r.lng === null ? null : Number(r.lng),
  window: r.arrival_window,
  duration_minutes: r.minutes,
  started: false,
  position,
  account_name: r.account_name,
  address: r.address,
  status: "planned",
});

/** Visits as stops, for placing them on a day. */
async function visitStops(tx: Sql, tenantId: string, ids: readonly string[]): Promise<Map<string, DayStop>> {
  if (ids.length === 0) return new Map();
  const rows = await tx<StopRow[]>`
    select v.id, p.lat, p.lng, v.arrival_window, st.default_duration_minutes as minutes, a.name as account_name, p.normalized_address as address
    from public.visits v join public.properties p on p.id = v.property_id join public.accounts a on a.id = v.account_id join public.service_types st on st.id = v.service_type_id
    where v.tenant_id = ${tenantId} and v.id = any(${ids as string[]}::uuid[])`;
  return new Map(rows.map((r) => [r.id, toStop(r, 999)]));
}

/** A technician's day as the board holds it, with coordinates, durations and real arrival times, and where it starts. */
export async function loadDay(tx: Sql, tenantId: string, technicianId: string, date: string): Promise<{ start: Point | null; stops: DayStop[] }> {
  const rows = await tx<(StopRow & { status: string; route_position: number | null; arrived: string | null; departed: string | null; branch_lat: number | null; branch_lng: number | null })[]>`
    with z as (select timezone as tz from public.tenants where id = ${tenantId})
    select v.id, p.lat, p.lng, v.arrival_window, st.default_duration_minutes as minutes, v.status, v.route_position, a.name as account_name, p.normalized_address as address,
           b.lat as branch_lat, b.lng as branch_lng,
           case when (v.arrived_at at time zone z.tz)::date = ${date}::date then to_char(v.arrived_at at time zone z.tz, 'HH24:MI') end as arrived,
           case when (v.departed_at at time zone z.tz)::date = ${date}::date then to_char(v.departed_at at time zone z.tz, 'HH24:MI') end as departed
    from public.visits v cross join z join public.properties p on p.id = v.property_id join public.accounts a on a.id = v.account_id
      join public.service_types st on st.id = v.service_type_id left join public.branches b on b.id = v.branch_id
    where v.tenant_id = ${tenantId} and v.technician_id = ${technicianId} and v.scheduled_for = ${date} and v.status in ('scheduled', 'en_route', 'in_progress', 'completed')
    order by v.route_position nulls last, v.sequence`;
  const startRow = rows.find((r) => r.branch_lat !== null && r.branch_lng !== null);
  let start: Point | null = startRow ? { lat: Number(startRow.branch_lat), lng: Number(startRow.branch_lng) } : null;
  if (!start) {
    const [b] = await tx<{ lat: number | null; lng: number | null }[]>`
      select b.lat, b.lng from public.memberships m join public.branches b on b.id = any(m.branch_ids) where m.tenant_id = ${tenantId} and m.user_id = ${technicianId} and b.lat is not null limit 1`;
    start = b && hasPoint(b) ? { lat: Number(b.lat), lng: Number(b.lng) } : null;
  }
  return {
    start,
    stops: rows.map((r, i) => ({
      ...toStop(r, r.route_position ?? i + 1),
      started: r.status !== "scheduled",
      status: r.status,
      arrived_min: r.arrived ? toMin(r.arrived) : null,
      departed_min: r.departed ? toMin(r.departed) : null,
    })),
  };
}

/**
 * Rule 6: what a preview saw of the technicians' days (each stop's place, state and window) and of the visits it
 * placed; with `lock`, the rows are locked first so a second apply waits and then sees the change.
 */
async function dayPrint(tx: Sql, tenantId: string, technicianIds: readonly string[], date: string, visitIds: readonly string[], lock: boolean): Promise<string> {
  const techs = technicianIds as string[];
  const visits = visitIds as string[];
  if (lock) {
    await tx`select id from public.visits where tenant_id = ${tenantId} and scheduled_for = ${date} and technician_id = any(${techs}::uuid[])
             and status in ('scheduled', 'en_route', 'in_progress') order by id for update`;
    if (visits.length) await tx`select id from public.visits where tenant_id = ${tenantId} and id = any(${visits}::uuid[]) order by id for update`;
  }
  const day = await tx<{ id: string; technician_id: string; position: number; status: string; arrival_window: string }[]>`
    select id, technician_id, coalesce(route_position, 0) as position, status, arrival_window from public.visits
    where tenant_id = ${tenantId} and scheduled_for = ${date} and technician_id = any(${techs}::uuid[]) and status in ('scheduled', 'en_route', 'in_progress', 'completed')
    order by id`;
  const placed = visits.length
    ? await tx<{ id: string; technician_id: string | null; status: string; scheduled_for: string | null }[]>`
        select id, technician_id, status, scheduled_for::text from public.visits where tenant_id = ${tenantId} and id = any(${visits}::uuid[]) order by id`
    : [];
  return [
    day.map((r) => `${r.id}:${r.technician_id}:${r.position}:${r.status}:${r.arrival_window}`).join(","),
    placed.map((r) => `${r.id}:${r.technician_id ?? ""}:${r.status}:${r.scheduled_for ?? ""}`).join(","),
  ].join("|");
}

async function writePositions(tx: Sql, tenantId: string, order: readonly { id: string }[]): Promise<void> {
  for (const [i, s] of order.entries()) await tx`update public.visits set route_position = ${i + 1} where id = ${s.id} and tenant_id = ${tenantId} and status = 'scheduled'`;
}

// ---------------------------------------------------------------------------
// Runs: what a suggestion proposed and whether it was taken
// ---------------------------------------------------------------------------

export type RunStop = { id: string; account_name: string; address: string; window: Window; started: boolean; lat: number | null; lng: number | null } & Pick<Eta, "arrive" | "depart" | "missed" | "no_location" | "wait_minutes">;
export type AssignPlacement = Placement & { technician_name: string; account_name: string };
export type Unplaced = { visit_id: string; account_name: string; reason: string };

export type RouteRun =
  | { id: string; kind: "optimize"; technician_id: string; branch_id: string | null; date: string; before: { fingerprint: string; stops: string[] }; after: { stops: RunStop[] }; miles_before: number; miles_after: number; applied_at: Date | null }
  | { id: string; kind: "assign"; technician_id: null; branch_id: string; date: string; before: { fingerprint: string; technicians: string[] }; after: { placements: AssignPlacement[]; unplaced: Unplaced[]; taken?: string[] }; miles_before: number; miles_after: number; applied_at: Date | null };

export async function loadRun(tx: Sql, tenantId: string, runId: string): Promise<RouteRun | null> {
  const [r] = await tx<(RouteRun & { miles_before: string; miles_after: string })[]>`
    select id, kind, technician_id, branch_id, date::text, before, after, miles_before::text, miles_after::text, applied_at
    from public.route_runs where tenant_id = ${tenantId} and id = ${runId} and kind in ('optimize', 'assign')`;
  return r ? ({ ...r, miles_before: Number(r.miles_before), miles_after: Number(r.miles_after) } as RouteRun) : null;
}

/** Rules 2, 3 and 6: the shorter order with its arrivals, recorded as a run; the day itself is not touched. */
export async function proposeOptimize(tx: Sql, tenantId: string, technicianId: string, date: string): Promise<string> {
  const settings = await routeSettings(tx, tenantId);
  const day = await loadDay(tx, tenantId, technicianId, date);
  const before = [...day.stops].sort((a, b) => a.position - b.position);
  const after = optimizeDay(day.start, day.stops, settings) as DayStop[];
  const etas = estimates(day.start, after, settings);
  const stops: RunStop[] = after.map((s, i) => ({
    id: s.id, account_name: s.account_name, address: s.address, window: s.window, started: s.started, lat: s.lat, lng: s.lng,
    arrive: etas[i].arrive, depart: etas[i].depart, missed: etas[i].missed, no_location: etas[i].no_location, wait_minutes: etas[i].wait_minutes,
  }));
  const fingerprint = await dayPrint(tx, tenantId, [technicianId], date, [], false);
  const [run] = await tx<{ id: string }[]>`
    insert into public.route_runs (tenant_id, kind, technician_id, date, before, after, miles_before, miles_after)
    values (${tenantId}, 'optimize', ${technicianId}, ${date}, ${tx.json({ fingerprint, stops: before.map((s) => s.id) })}, ${tx.json({ stops } as unknown as postgres.JSONValue)},
            ${routeMiles(day.start, before)}, ${routeMiles(day.start, after)})
    returning id`;
  return run.id;
}

async function openRun(tx: Sql, tenantId: string, runId: string, kind: RouteRun["kind"]): Promise<RouteRun> {
  const [locked] = await tx<{ id: string }[]>`select id from public.route_runs where tenant_id = ${tenantId} and id = ${runId} and kind = ${kind} for update`;
  const run = locked ? await loadRun(tx, tenantId, runId) : null;
  if (!run) return fail("That suggestion is gone; preview again.");
  if (run.applied_at) fail("That suggestion was already applied; preview again.");
  return run;
}

/** Rule 6: applies the proposed order when the day is still what was previewed, and marks the run taken. */
export async function applyOptimize(tx: Sql, tenantId: string, runId: string): Promise<{ miles_before: number; miles_after: number }> {
  const run = await openRun(tx, tenantId, runId, "optimize");
  if (run.kind !== "optimize") return fail(CHANGED);
  const now = await dayPrint(tx, tenantId, [run.technician_id], run.date, [], true);
  if (now !== run.before.fingerprint) fail(CHANGED);
  await writePositions(tx, tenantId, run.after.stops);
  await tx`update public.route_runs set applied_at = now() where id = ${run.id}`;
  return { miles_before: run.miles_before, miles_after: run.miles_after };
}

/**
 * Technicians for assignment (rule 4: the people who work from the branch): members who do visits, owners included,
 * except people who run dispatch or own the company and hold no applicator credential.
 */
export async function fieldTechnicians(tx: Sql, tenantId: string, branchId: string | null): Promise<{ user_id: string; name: string }[]> {
  return tx<{ user_id: string; name: string }[]>`
    select m.user_id, coalesce(m.display_name, 'Technician') as name from public.memberships m join public.roles r on r.id = m.role_id
    where m.tenant_id = ${tenantId} and ('visits.write' = any(r.permissions) or '*' = any(r.permissions))
      and ((not ('dispatch.write' = any(r.permissions)) and not ('*' = any(r.permissions)))
           or exists (select 1 from public.applicator_credentials c where c.tenant_id = m.tenant_id and c.user_id = m.user_id and c.archived_at is null))
      and (${branchId}::uuid is null or m.branch_ids is null or ${branchId}::uuid = any(m.branch_ids))
    order by 2`;
}

export type AssignPreview = { date: string; branch_id: string; technicians: string[]; placements: AssignPlacement[]; unplaced: Unplaced[]; miles_before: number; miles_after: number };

/** Rule 4: the branch's unassigned visits due that day, placed where the check allows at the least added miles. */
export async function previewAssign(tx: Sql, tenantId: string, branchId: string, date: string, today: string): Promise<AssignPreview> {
  const settings = await routeSettings(tx, tenantId);
  const dueRows = await tx<{ id: string }[]>`
    select v.id from public.visits v
    where v.tenant_id = ${tenantId} and v.status = 'planned' and v.technician_id is null and v.branch_id = ${branchId} and ${date}::date between v.due_start and v.due_end
    order by v.due_end, v.sequence`;
  const stops = await visitStops(tx, tenantId, dueRows.map((r) => r.id));
  const due = dueRows.map((r) => stops.get(r.id)).filter((s): s is DayStop => Boolean(s));
  const techs = await fieldTechnicians(tx, tenantId, branchId);
  const allowed = new Map<string, boolean>();
  const reasons = new Map<string, string>();
  for (const v of due) {
    const visit = await loadVisit(tx, tenantId, v.id);
    if (!visit) continue;
    // The same crew scheduling would check: the visit's own applicators, supervisors and helpers, under this lead.
    const crew = await loadCrew(tx, tenantId, v.id);
    for (const t of techs) {
      const spec: CrewSpec[] = withLead(crew, t.user_id);
      const check = await runCheck(tx, tenantId, visit, date, spec, today);
      allowed.set(`${v.id}:${t.user_id}`, check.ok);
      if (!check.ok && !reasons.has(v.id)) reasons.set(v.id, `${t.name}: ${check.blockers[0]?.message ?? "refused"}`);
    }
  }
  const days = [];
  for (const t of techs) {
    const day = await loadDay(tx, tenantId, t.user_id, date);
    days.push({ id: t.user_id, start: day.start, stops: day.stops });
  }
  const result = assignDay(days, due, (visitId, techId) => allowed.get(`${visitId}:${techId}`) ?? false, settings, 4, settings.max_stops);
  const name = new Map(techs.map((t) => [t.user_id, t.name]));
  const label = (id: string) => {
    const s = stops.get(id);
    return s ? `${s.account_name}, ${s.address}` : "";
  };
  const why = (id: string) =>
    result.blocked[id] === "full"
      ? `Every technician who may take it already has ${settings.max_stops} stops that day.`
      : result.blocked[id] === "window"
        ? "It does not fit its arrival window on any day it could go on."
        : (reasons.get(id) ?? "No technician works from this branch.");
  return {
    date,
    branch_id: branchId,
    technicians: techs.map((t) => t.user_id),
    placements: result.placements.map((p) => ({ ...p, technician_name: name.get(p.technician_id) ?? "Technician", account_name: label(p.visit_id) })),
    unplaced: result.unplaced.map((id) => ({ visit_id: id, account_name: label(id), reason: why(id) })),
    miles_before: result.miles_before,
    miles_after: result.miles_after,
  };
}

/** Rules 4 and 6: the assignment preview, recorded as a run. */
export async function proposeAssign(tx: Sql, tenantId: string, branchId: string, date: string, today: string): Promise<string> {
  const p = await previewAssign(tx, tenantId, branchId, date, today);
  const fingerprint = await dayPrint(tx, tenantId, p.technicians, date, [...p.placements.map((x) => x.visit_id), ...p.unplaced.map((x) => x.visit_id)], false);
  const [run] = await tx<{ id: string }[]>`
    insert into public.route_runs (tenant_id, kind, branch_id, date, before, after, miles_before, miles_after)
    values (${tenantId}, 'assign', ${branchId}, ${date}, ${tx.json({ fingerprint, technicians: p.technicians })},
            ${tx.json({ placements: p.placements, unplaced: p.unplaced } as unknown as postgres.JSONValue)}, ${p.miles_before}, ${p.miles_after})
    returning id`;
  return run.id;
}

/**
 * Rule 6: the chosen placements of a run, refused whole when any technician's day or any visit it placed changed since
 * the preview; each goes through the dispatch check again and into its day where it adds the least, without reordering
 * the day.
 */
export async function applyAssign(tx: Sql, tenantId: string, runId: string, today: string, chosen: readonly string[]): Promise<{ scheduled: number; refused: string[] }> {
  const run = await openRun(tx, tenantId, runId, "assign");
  if (run.kind !== "assign") return fail(CHANGED);
  const settings = await routeSettings(tx, tenantId);
  const placed = [...run.after.placements.map((x) => x.visit_id), ...run.after.unplaced.map((x) => x.visit_id)];
  const now = await dayPrint(tx, tenantId, run.before.technicians, run.date, placed, true);
  if (now !== run.before.fingerprint) fail(CHANGED);
  const picks = run.after.placements.filter((p) => chosen.includes(p.visit_id));
  const days = new Map<string, { start: Point | null; stops: DayStop[] }>();
  for (const t of new Set(picks.map((p) => p.technician_id))) days.set(t, await loadDay(tx, tenantId, t, run.date));
  const stops = await visitStops(tx, tenantId, picks.map((p) => p.visit_id));
  const refused: string[] = [];
  let scheduled = 0;
  for (const p of picks) {
    const day = days.get(p.technician_id) as { start: Point | null; stops: DayStop[] };
    if (day.stops.length >= settings.max_stops) {
      refused.push(`${p.account_name}: ${p.technician_name} already has ${settings.max_stops} stops that day.`);
      continue;
    }
    const stop = stops.get(p.visit_id) as DayStop;
    const ins = bestInsertion(day.start, day.stops, stop, settings);
    if (!ins) {
      refused.push(`${p.account_name}: no room in its arrival window on ${p.technician_name}'s day.`);
      continue;
    }
    const r: CheckResult = await scheduleVisit(tx, tenantId, p.visit_id, p.technician_id, run.date, today);
    if (!r.ok) {
      refused.push(`${p.account_name}: ${r.blockers[0]?.message ?? "refused"}`);
      continue;
    }
    scheduled += 1;
    day.stops = insertStop(day.stops, { ...stop, status: "scheduled" }, ins.index);
  }
  for (const day of days.values()) await writePositions(tx, tenantId, day.stops);
  await tx`update public.route_runs set applied_at = now(), after = after || ${tx.json({ taken: picks.map((p) => p.visit_id) })} where id = ${run.id}`;
  return { scheduled, refused };
}

export type FillInRow = FillIn & { account_name: string; address: string; due_start: string; due_end: string };

/** Rule 5: what could fill the technician's day, nearest first: due visits of their branches, then active customers near the route. */
export async function fillIns(tx: Sql, tenantId: string, technicianId: string, date: string): Promise<FillInRow[]> {
  const settings = await routeSettings(tx, tenantId);
  const day = await loadDay(tx, tenantId, technicianId, date);
  const box = routeBox(day.start, day.stops, settings.fill_in_miles);
  const options = await tx<(StopRow & { due_start: string; due_end: string; kind: "due" | "pull_forward" })[]>`
    select v.id, p.lat, p.lng, v.arrival_window, st.default_duration_minutes as minutes, a.name as account_name, p.normalized_address as address, v.due_start::text, v.due_end::text,
           case when ${date}::date between v.due_start and v.due_end then 'due' else 'pull_forward' end as kind
    from public.visits v join public.properties p on p.id = v.property_id join public.accounts a on a.id = v.account_id join public.service_types st on st.id = v.service_type_id
      left join public.agreements ag on ag.id = v.agreement_id
      join public.memberships m on m.tenant_id = v.tenant_id and m.user_id = ${technicianId}
    where v.tenant_id = ${tenantId} and v.status = 'planned' and v.technician_id is null and a.status = 'active' and (ag.id is null or ag.status = 'active')
      and (m.branch_ids is null or v.branch_id is null or v.branch_id = any(m.branch_ids))
      and ((${date}::date between v.due_start and v.due_end)
           or (v.due_start > ${date}::date and v.due_start <= ${addDays(date, 14)}::date and ${box !== null}
               and p.lat between ${box?.minLat ?? 0} and ${box?.maxLat ?? 0} and p.lng between ${box?.minLng ?? 0} and ${box?.maxLng ?? 0}))
    order by (${date}::date between v.due_start and v.due_end) desc, v.due_end, v.id
    limit 500`;
  const ranked = rankFillIns(
    day.start,
    day.stops,
    options.map((o) => ({ ...toStop(o, 999), kind: o.kind })),
    settings.fill_in_miles,
    settings,
  );
  const byId = new Map(options.map((o) => [o.id, o]));
  return ranked.slice(0, 12).map((r) => {
    const o = byId.get(r.visit_id)!;
    return { ...r, account_name: o.account_name, address: o.address, due_start: o.due_start, due_end: o.due_end };
  });
}

/** Rule 5: a fill-in onto the day through the dispatch check, inserted where it adds the least, recorded as a taken run. */
export async function scheduleFillIn(tx: Sql, tenantId: string, technicianId: string, date: string, visitId: string, today: string): Promise<CheckResult & { position: number | null }> {
  const settings = await routeSettings(tx, tenantId);
  await dayPrint(tx, tenantId, [technicianId], date, [visitId], true);
  const day = await loadDay(tx, tenantId, technicianId, date);
  const stop = (await visitStops(tx, tenantId, [visitId])).get(visitId);
  if (!stop) return fail("That visit is gone.");
  const ins = bestInsertion(day.start, day.stops, stop, settings);
  if (!ins) return { ok: false, blockers: [{ code: "window", message: "It does not fit its arrival window on this day." }], warnings: [], position: null };
  const r = await scheduleVisit(tx, tenantId, visitId, technicianId, date, today);
  if (!r.ok) return { ...r, position: null };
  const before = [...day.stops].sort((a, b) => a.position - b.position);
  const after = insertStop(before, { ...stop, status: "scheduled" }, ins.index);
  await writePositions(tx, tenantId, after);
  await tx`
    insert into public.route_runs (tenant_id, kind, technician_id, date, before, after, miles_before, miles_after, applied_at)
    values (${tenantId}, 'fill_in', ${technicianId}, ${date}, ${tx.json({ stops: before.map((s) => s.id) })}, ${tx.json({ stops: after.map((s) => s.id), visit_id: visitId })},
            ${routeMiles(day.start, before)}, ${routeMiles(day.start, after)}, now())`;
  return { ...r, position: ins.index + 1 };
}

/** Rule 7: one position from the phone; the database checks it is the person's own and while they work. */
export async function recordPosition(tx: Sql, tenantId: string, userId: string, p: { lat: number; lng: number; accuracy_m: number | null; recorded_at: Date }): Promise<void> {
  await tx`insert into public.technician_positions (tenant_id, user_id, lat, lng, accuracy_m, recorded_at) values (${tenantId}, ${userId}, ${p.lat}, ${p.lng}, ${p.accuracy_m}, ${p.recorded_at})`;
}

export type LatestPosition = { user_id: string; name: string; lat: number; lng: number; recorded_at: Date };

export async function latestPositions(tx: Sql, tenantId: string): Promise<LatestPosition[]> {
  return tx<LatestPosition[]>`
    select distinct on (p.user_id) p.user_id, coalesce(m.display_name, 'Technician') as name, p.lat, p.lng, p.recorded_at
    from public.technician_positions p left join public.memberships m on m.tenant_id = p.tenant_id and m.user_id = p.user_id
    where p.tenant_id = ${tenantId} and p.recorded_at > now() - interval '1 day'
    order by p.user_id, p.recorded_at desc`;
}

/** Rule 7: positions older than the company keeps them go (the messaging job runs this). */
export async function purgePositions(tx: Sql, tenantId: string): Promise<number> {
  const settings = await routeSettings(tx, tenantId);
  const r = await tx`delete from public.technician_positions where tenant_id = ${tenantId} and recorded_at < now() - make_interval(days => ${settings.position_days})`;
  return r.count;
}

/** Minutes after midnight of an instant in the zone. */
function minutesInZone(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return n("hour") * 60 + n("minute");
}

const twelve = (mins: number) => {
  const h = Math.floor(mins / 60) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(Math.round(mins % 60)).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/**
 * Rule 8: when to expect the technician, as a 15-minute range: from their last position if it is under 10 minutes old,
 * else from the day's estimate for the stop (which starts from the last stop they reached, and is never earlier than
 * now); null when neither is known.
 */
export async function arrivalRange(tx: Sql, tenantId: string, visitId: string, now: Date, timeZone: string): Promise<string | null> {
  const [v] = await tx<{ technician_id: string | null; scheduled_for: string | null; lat: number | null; lng: number | null }[]>`
    select v.technician_id, v.scheduled_for::text, p.lat, p.lng from public.visits v join public.properties p on p.id = v.property_id where v.id = ${visitId} and v.tenant_id = ${tenantId}`;
  if (!v?.technician_id) return null;
  const settings = await routeSettings(tx, tenantId);
  const [pos] = await tx<{ lat: number; lng: number; recorded_at: Date }[]>`
    select lat, lng, recorded_at from public.technician_positions where tenant_id = ${tenantId} and user_id = ${v.technician_id} order by recorded_at desc limit 1`;
  const nowMin = minutesInZone(now, timeZone);
  if (pos && now.getTime() - pos.recorded_at.getTime() < 10 * 60_000 && hasPoint(v)) {
    const at = nowMin + driveMinutes(miles({ lat: Number(pos.lat), lng: Number(pos.lng) }, { lat: Number(v.lat), lng: Number(v.lng) }), settings.mph);
    return `${twelve(at)} to ${twelve(at + 15)}`;
  }
  if (!v.scheduled_for) return null;
  const day = await loadDay(tx, tenantId, v.technician_id, v.scheduled_for);
  const eta = estimates(day.start, [...day.stops].sort((a, b) => a.position - b.position), settings).find((e) => e.id === visitId);
  if (!eta) return null;
  // The estimate is a wall-clock time in the company's zone; on the day itself it is never in the past.
  const arrive = v.scheduled_for === dateInZone(now, timeZone) ? Math.max(eta.arrive_min, nowMin) : eta.arrive_min;
  return `${twelve(arrive)} to ${twelve(arrive + 15)}`;
}
