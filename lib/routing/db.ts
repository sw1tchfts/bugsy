// Routing's database work (spec 19), on the caller's connection: a technician's day with coordinates, the previews and
// their application through the dispatch check, fill-ins, positions, and the on-the-way estimate.
import type postgres from "postgres";
import { addDays } from "@/lib/dates";
import { type CrewSpec, loadVisit, runCheck, scheduleVisit } from "@/lib/dispatch/db";
import { type Point, driveMinutes, hasPoint, miles } from "./geo";
import { type Eta, type FillIn, type Placement, type Settings, type Stop, type Window, assignDay, estimates, optimizeDay, rankFillIns, routeMiles } from "./optimize";

type Sql = postgres.Sql | postgres.TransactionSql;

const fail = (message: string, code = "23514"): never => {
  throw Object.assign(new Error(message), { code });
};

export type RouteSettings = Settings & { fill_in_miles: number; position_days: number };

export async function routeSettings(tx: Sql, tenantId: string): Promise<RouteSettings> {
  const [r] = await tx<{ mph: string; day_start: string; morning_ends: string; afternoon_ends: string; fill_in_miles: string; position_days: number }[]>`
    select average_speed_mph::text as mph, to_char(day_starts_at, 'HH24:MI') as day_start, to_char(morning_ends_at, 'HH24:MI') as morning_ends,
           to_char(afternoon_ends_at, 'HH24:MI') as afternoon_ends, fill_in_miles::text, position_days
    from public.route_settings where tenant_id = ${tenantId}`;
  return r
    ? { mph: Number(r.mph), day_start: r.day_start, morning_ends: r.morning_ends, afternoon_ends: r.afternoon_ends, fill_in_miles: Number(r.fill_in_miles), position_days: r.position_days }
    : { mph: 25, day_start: "08:00", morning_ends: "12:00", afternoon_ends: "17:00", fill_in_miles: 5, position_days: 30 };
}

export type DayStop = Stop & { visit_id: string; account_name: string; address: string; status: string };

/** A technician's day as the board holds it, with coordinates and durations, and where it starts. */
export async function loadDay(tx: Sql, tenantId: string, technicianId: string, date: string): Promise<{ start: Point | null; stops: DayStop[] }> {
  const rows = await tx<{ id: string; lat: number | null; lng: number | null; arrival_window: Window; minutes: number; status: string; route_position: number | null; account_name: string; address: string; branch_lat: number | null; branch_lng: number | null }[]>`
    select v.id, p.lat, p.lng, v.arrival_window, st.default_duration_minutes as minutes, v.status, v.route_position, a.name as account_name, p.normalized_address as address,
           b.lat as branch_lat, b.lng as branch_lng
    from public.visits v join public.properties p on p.id = v.property_id join public.accounts a on a.id = v.account_id
      join public.service_types st on st.id = v.service_type_id left join public.branches b on b.id = v.branch_id
    where v.tenant_id = ${tenantId} and v.technician_id = ${technicianId} and v.scheduled_for = ${date} and v.status in ('scheduled', 'en_route', 'in_progress', 'completed')
    order by v.route_position nulls last, v.sequence`;
  const startRow = rows.find((r) => r.branch_lat !== null && r.branch_lng !== null);
  let start: Point | null = startRow ? { lat: startRow.branch_lat as number, lng: startRow.branch_lng as number } : null;
  if (!start) {
    const [b] = await tx<{ lat: number | null; lng: number | null }[]>`
      select b.lat, b.lng from public.memberships m join public.branches b on b.id = any(m.branch_ids) where m.tenant_id = ${tenantId} and m.user_id = ${technicianId} and b.lat is not null limit 1`;
    start = b && hasPoint(b) ? { lat: b.lat as number, lng: b.lng as number } : null;
  }
  return {
    start,
    stops: rows.map((r, i) => ({
      id: r.id,
      visit_id: r.id,
      lat: r.lat === null ? null : Number(r.lat),
      lng: r.lng === null ? null : Number(r.lng),
      window: r.arrival_window,
      duration_minutes: r.minutes,
      started: r.status !== "scheduled",
      position: r.route_position ?? i + 1,
      account_name: r.account_name,
      address: r.address,
      status: r.status,
    })),
  };
}

const fingerprint = (stops: readonly { id: string; position: number }[]) =>
  [...stops].sort((a, b) => a.position - b.position).map((s) => `${s.id}:${s.position}`).join(",");

export type OptimizePreview = { technician_id: string; date: string; before: DayStop[]; after: DayStop[]; miles_before: number; miles_after: number; etas: Eta[]; fingerprint: string };

/** Rules 2 and 3: the shorter order with its arrivals; nothing is written. */
export async function previewOptimize(tx: Sql, tenantId: string, technicianId: string, date: string): Promise<OptimizePreview> {
  const settings = await routeSettings(tx, tenantId);
  const day = await loadDay(tx, tenantId, technicianId, date);
  const after = optimizeDay(day.start, day.stops) as DayStop[];
  return {
    technician_id: technicianId,
    date,
    before: day.stops,
    after,
    miles_before: routeMiles(day.start, [...day.stops].sort((a, b) => a.position - b.position)),
    miles_after: routeMiles(day.start, after),
    etas: estimates(day.start, after, settings),
    fingerprint: fingerprint(day.stops),
  };
}

async function writePositions(tx: Sql, tenantId: string, order: readonly { id: string }[]): Promise<void> {
  for (const [i, s] of order.entries()) await tx`update public.visits set route_position = ${i + 1} where id = ${s.id} and tenant_id = ${tenantId} and status = 'scheduled'`;
}

/** Rule 6: applies the preview's order when the day is still what was previewed. */
export async function applyOptimize(tx: Sql, tenantId: string, technicianId: string, date: string, seen: string): Promise<{ miles_before: number; miles_after: number }> {
  const preview = await previewOptimize(tx, tenantId, technicianId, date);
  if (preview.fingerprint !== seen) fail("The day changed; preview again.");
  await writePositions(tx, tenantId, preview.after);
  await tx`
    insert into public.route_runs (tenant_id, kind, technician_id, date, before, after, miles_before, miles_after, applied_at)
    values (${tenantId}, 'optimize', ${technicianId}, ${date}, ${tx.json(preview.before.map((s) => s.id))}, ${tx.json(preview.after.map((s) => s.id))},
            ${preview.miles_before}, ${preview.miles_after}, now())`;
  return { miles_before: preview.miles_before, miles_after: preview.miles_after };
}

/** Technicians for assignment: people who do visits but do not run dispatch or own the company. */
export async function fieldTechnicians(tx: Sql, tenantId: string, branchId: string | null): Promise<{ user_id: string; name: string }[]> {
  return tx<{ user_id: string; name: string }[]>`
    select m.user_id, coalesce(m.display_name, 'Technician') as name from public.memberships m join public.roles r on r.id = m.role_id
    where m.tenant_id = ${tenantId} and 'visits.write' = any(r.permissions) and not ('dispatch.write' = any(r.permissions)) and not ('*' = any(r.permissions))
      and (${branchId}::uuid is null or m.branch_ids is null or ${branchId}::uuid = any(m.branch_ids))
    order by 2`;
}

export type AssignPreview = { date: string; branch_id: string; placements: (Placement & { technician_name: string; account_name: string })[]; unplaced: { visit_id: string; account_name: string; reason: string }[] };

/** Rule 4: the branch's unassigned visits due that day, placed where the check allows at the least added miles. */
export async function previewAssign(tx: Sql, tenantId: string, branchId: string, date: string, today: string): Promise<AssignPreview> {
  const settings = await routeSettings(tx, tenantId);
  const due = await tx<{ id: string; lat: number | null; lng: number | null; arrival_window: Window; minutes: number; account_name: string }[]>`
    select v.id, p.lat, p.lng, v.arrival_window, st.default_duration_minutes as minutes, a.name || ', ' || p.normalized_address as account_name
    from public.visits v join public.properties p on p.id = v.property_id join public.accounts a on a.id = v.account_id join public.service_types st on st.id = v.service_type_id
    where v.tenant_id = ${tenantId} and v.status = 'planned' and v.technician_id is null and v.branch_id = ${branchId} and ${date}::date between v.due_start and v.due_end
    order by v.due_end, v.sequence`;
  const techs = await fieldTechnicians(tx, tenantId, branchId);
  const allowed = new Map<string, boolean>();
  const reasons = new Map<string, string>();
  for (const v of due) {
    const visit = await loadVisit(tx, tenantId, v.id);
    if (!visit) continue;
    for (const t of techs) {
      const spec: CrewSpec[] = [{ user_id: t.user_id, role: "lead" }];
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
  const result = assignDay(
    days,
    due.map((v) => ({ id: v.id, visit_id: v.id, lat: v.lat === null ? null : Number(v.lat), lng: v.lng === null ? null : Number(v.lng), window: v.arrival_window, duration_minutes: v.minutes, started: false, position: 999 })),
    (visitId, techId) => allowed.get(`${visitId}:${techId}`) ?? false,
    settings,
  );
  const name = new Map(techs.map((t) => [t.user_id, t.name]));
  const account = new Map(due.map((v) => [v.id, v.account_name]));
  return {
    date,
    branch_id: branchId,
    placements: result.placements.map((p) => ({ ...p, technician_name: name.get(p.technician_id) ?? "Technician", account_name: account.get(p.visit_id) ?? "" })),
    unplaced: result.unplaced.map((id) => ({ visit_id: id, account_name: account.get(id) ?? "", reason: reasons.get(id) ?? "No technician works from this branch." })),
  };
}

/** Rule 6: the chosen placements, each through the dispatch check again, then each touched day in its best order. */
export async function applyAssign(tx: Sql, tenantId: string, branchId: string, date: string, today: string, chosen: readonly { visit_id: string; technician_id: string }[]): Promise<{ scheduled: number; refused: string[] }> {
  const refused: string[] = [];
  const touched = new Set<string>();
  let scheduled = 0;
  for (const c of chosen) {
    const r = await scheduleVisit(tx, tenantId, c.visit_id, c.technician_id, date, today);
    if (r.ok) {
      scheduled += 1;
      touched.add(c.technician_id);
    } else refused.push(r.blockers[0]?.message ?? "refused");
  }
  for (const t of touched) {
    const day = await loadDay(tx, tenantId, t, date);
    await writePositions(tx, tenantId, optimizeDay(day.start, day.stops));
  }
  await tx`insert into public.route_runs (tenant_id, kind, branch_id, date, after, applied_at) values (${tenantId}, 'assign', ${branchId}, ${date}, ${tx.json(chosen as unknown as postgres.JSONValue)}, now())`;
  return { scheduled, refused };
}

export type FillInRow = FillIn & { account_name: string; address: string; due_start: string; due_end: string };

/** Rule 5: what could fill the technician's day, nearest first. */
export async function fillIns(tx: Sql, tenantId: string, technicianId: string, date: string): Promise<FillInRow[]> {
  const settings = await routeSettings(tx, tenantId);
  const day = await loadDay(tx, tenantId, technicianId, date);
  const options = await tx<{ id: string; lat: number | null; lng: number | null; arrival_window: Window; minutes: number; account_name: string; address: string; due_start: string; due_end: string; kind: "due" | "pull_forward" }[]>`
    select v.id, p.lat, p.lng, v.arrival_window, st.default_duration_minutes as minutes, a.name as account_name, p.normalized_address as address, v.due_start::text, v.due_end::text,
           case when ${date}::date between v.due_start and v.due_end then 'due' else 'pull_forward' end as kind
    from public.visits v join public.properties p on p.id = v.property_id join public.accounts a on a.id = v.account_id join public.service_types st on st.id = v.service_type_id
    where v.tenant_id = ${tenantId} and v.status = 'planned' and v.technician_id is null
      and ((${date}::date between v.due_start and v.due_end) or (v.due_start > ${date}::date and v.due_start <= ${addDays(date, 14)}::date))
    limit 300`;
  const ranked = rankFillIns(
    day.start,
    day.stops,
    options.map((o) => ({ id: o.id, visit_id: o.id, lat: o.lat === null ? null : Number(o.lat), lng: o.lng === null ? null : Number(o.lng), window: o.arrival_window, duration_minutes: o.minutes, started: false, position: 999, kind: o.kind })),
    settings.fill_in_miles,
  );
  const byId = new Map(options.map((o) => [o.id, o]));
  return ranked.slice(0, 12).map((r) => {
    const o = byId.get(r.visit_id)!;
    return { ...r, account_name: o.account_name, address: o.address, due_start: o.due_start, due_end: o.due_end };
  });
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

/**
 * Rule 8: when to expect the technician, as a 15-minute range: from their last position if it is under 10 minutes old,
 * else from the day's estimate for the stop; null when neither is known.
 */
export async function arrivalRange(tx: Sql, tenantId: string, visitId: string, now: Date, timeZone: string): Promise<string | null> {
  const [v] = await tx<{ technician_id: string | null; scheduled_for: string | null; lat: number | null; lng: number | null }[]>`
    select v.technician_id, v.scheduled_for::text, p.lat, p.lng from public.visits v join public.properties p on p.id = v.property_id where v.id = ${visitId} and v.tenant_id = ${tenantId}`;
  if (!v?.technician_id) return null;
  const settings = await routeSettings(tx, tenantId);
  const fmt = (d: Date) => d.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  const range = (at: Date) => `${fmt(at)} to ${fmt(new Date(at.getTime() + 15 * 60_000))}`;
  const [pos] = await tx<{ lat: number; lng: number; recorded_at: Date }[]>`
    select lat, lng, recorded_at from public.technician_positions where tenant_id = ${tenantId} and user_id = ${v.technician_id} order by recorded_at desc limit 1`;
  if (pos && now.getTime() - pos.recorded_at.getTime() < 10 * 60_000 && hasPoint(v)) {
    const minutes = driveMinutes(miles({ lat: pos.lat, lng: pos.lng }, { lat: v.lat as number, lng: v.lng as number }), settings.mph);
    return range(new Date(now.getTime() + minutes * 60_000));
  }
  if (!v.scheduled_for) return null;
  const day = await loadDay(tx, tenantId, v.technician_id, v.scheduled_for);
  const eta = estimates(day.start, [...day.stops].sort((a, b) => a.position - b.position), settings).find((e) => e.id === visitId);
  if (!eta) return null;
  // The estimate is a wall-clock time in the company's zone.
  const twelve = (mins: number) => {
    const h = Math.floor(mins / 60) % 24;
    return `${h % 12 === 0 ? 12 : h % 12}:${String(mins % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  };
  const [h, m] = eta.arrive.split(":").map(Number);
  return `${twelve(h * 60 + m)} to ${twelve(h * 60 + m + 15)}`;
}
