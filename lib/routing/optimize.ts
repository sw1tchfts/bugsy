// Route optimization (spec 19 rules 2 to 5), pure. A pest route is 8 to 20 stops: nearest neighbor then local search
// (2-opt and moving one stop) inside each arrival window group gives a good order instantly; assignment and fill-ins
// insert a visit where it adds the least, without reordering the rest of the day.
import { type Point, driveMinutes, hasPoint, miles } from "./geo";

export type Window = "any" | "morning" | "afternoon" | "evening";

export type Stop = {
  id: string;
  lat: number | null;
  lng: number | null;
  window: Window;
  duration_minutes: number;
  /** En route, on site or done: keeps its place (rule 2). */
  started: boolean;
  position: number;
  /** When the technician actually arrived and left, in minutes after midnight in the company's zone (rule 3). */
  arrived_min?: number | null;
  departed_min?: number | null;
};

export type Settings = { mph: number; day_start: string; morning_ends: string; afternoon_ends: string };

export const DEFAULT_SETTINGS: Settings = { mph: 25, day_start: "08:00", morning_ends: "12:00", afternoon_ends: "17:00" };

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};
const fmt = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;

/** The order of groups (rule 2): morning, then any and afternoon together, then evening. */
const GROUP: Record<Window, number> = { morning: 0, any: 1, afternoon: 1, evening: 2 };

/** When a stop's window opens and closes, in minutes after midnight (null: no bound). */
function bounds(w: Window, s: Settings): { opens: number | null; closes: number | null } {
  if (w === "morning") return { opens: null, closes: toMin(s.morning_ends) };
  if (w === "afternoon") return { opens: toMin(s.morning_ends), closes: toMin(s.afternoon_ends) };
  if (w === "evening") return { opens: toMin(s.afternoon_ends), closes: null };
  return { opens: null, closes: null };
}

const pointOf = (s: Pick<Stop, "lat" | "lng">): Point | null => (hasPoint(s) ? { lat: s.lat as number, lng: s.lng as number } : null);

/** Unrounded miles of a path from the start through the stops (and back to the start when `home` is true). */
function pathLength(start: Point | null, stops: readonly Pick<Stop, "lat" | "lng">[], to: Point | null): number {
  let total = 0;
  let prev: Point | null = start;
  for (const s of stops) {
    const p = pointOf(s);
    if (!p) continue;
    if (prev) total += miles(prev, p);
    prev = p;
  }
  if (prev && to) total += miles(prev, to);
  return total;
}

/** Miles of a path from the start through the points and back (points without coordinates add nothing). */
export function routeMiles(start: Point | null, stops: readonly Pick<Stop, "lat" | "lng">[]): number {
  const first = stops.map(pointOf).find(Boolean) ?? null;
  return Math.round(pathLength(start ?? first, stops, start) * 10) / 10;
}

export type Eta = { id: string; arrive: string; depart: string; arrive_min: number; drive_minutes: number; wait_minutes: number; missed: boolean; no_location: boolean };

type Walk = { etas: Eta[]; clock: number; at: Point | null; wait: number; late: number };

/**
 * Walks a day in order: drive at the company speed, wait for a window that has not opened yet, work the service
 * type's minutes. A stop the technician already reached uses its real arrival and departure (rule 3), so the stops after
 * it start from there. A window the arrival is after the close of is missed.
 */
function walk(start: Point | null, stops: readonly Stop[], settings: Settings, clock0: number): Walk {
  let clock = clock0;
  let at = start;
  let wait = 0;
  let late = 0;
  const etas: Eta[] = [];
  for (const s of stops) {
    const here = pointOf(s);
    const { opens, closes } = bounds(s.window, settings);
    let drive = 0;
    let waited = 0;
    let arrive: number;
    if (s.arrived_min !== null && s.arrived_min !== undefined) {
      arrive = s.arrived_min;
    } else {
      drive = at && here ? driveMinutes(miles(at, here), settings.mph) : 0;
      arrive = clock + drive;
      if (opens !== null && arrive < opens) {
        waited = opens - arrive;
        arrive = opens;
      }
    }
    const depart = s.departed_min ?? arrive + s.duration_minutes;
    const missed = closes !== null && arrive >= closes;
    if (missed) late += 1;
    wait += waited;
    etas.push({ id: s.id, arrive: fmt(arrive), depart: fmt(depart), arrive_min: arrive, drive_minutes: drive, wait_minutes: waited, missed, no_location: !here });
    clock = depart;
    if (here) at = here;
  }
  return { etas, clock, at, wait, late };
}

/** Rule 3: arrival estimates from the day start (or a given start time), with windows the estimate misses flagged. */
export function estimates(start: Point | null, stops: readonly Stop[], settings: Settings, startAt?: number): Eta[] {
  return walk(start, stops, settings, startAt ?? toMin(settings.day_start)).etas;
}

/** A missed window outweighs any driving. */
const LATE_MILES = 1000;

/**
 * Miles, plus the time the order takes (driving, waiting for windows and working) at what driving that long would
 * cost: an order that waits for a window it could have filled finishes later, while driving more before a wait that
 * cannot be avoided only adds miles.
 */
function cost(from: Point | null, clock: number, order: readonly Stop[], to: Point | null, settings: Settings): number {
  const w = walk(from, order, settings, clock);
  return pathLength(from, order, to) + ((w.clock - clock) * settings.mph) / 60 + w.late * LATE_MILES;
}

function nearestNeighbor(from: Point | null, stops: readonly Stop[]): Stop[] {
  const left = [...stops];
  const out: Stop[] = [];
  let at = from ?? (left[0] ? pointOf(left[0]) : null);
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i += 1) if (at && miles(at, pointOf(left[i]) as Point) < miles(at, pointOf(left[best]) as Point)) best = i;
    const [next] = left.splice(best, 1);
    out.push(next);
    at = pointOf(next);
  }
  return out;
}

/** 2-opt and single-stop moves until neither helps. */
function improve(from: Point | null, clock: number, seed: Stop[], to: Point | null, settings: Settings): { order: Stop[]; cost: number } {
  let best = seed;
  let bestCost = cost(from, clock, best, to, settings);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i += 1) {
      for (let k = i + 1; k < best.length; k += 1) {
        const candidate = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        const c = cost(from, clock, candidate, to, settings);
        if (c + 1e-9 < bestCost) {
          best = candidate;
          bestCost = c;
          improved = true;
        }
      }
    }
    for (let i = 0; i < best.length; i += 1) {
      for (let j = 0; j < best.length; j += 1) {
        if (i === j) continue;
        const rest = [...best.slice(0, i), ...best.slice(i + 1)];
        const candidate = [...rest.slice(0, j), best[i], ...rest.slice(j)];
        const c = cost(from, clock, candidate, to, settings);
        if (c + 1e-9 < bestCost) {
          best = candidate;
          bestCost = c;
          improved = true;
        }
      }
    }
  }
  return { order: best, cost: bestCost };
}

/**
 * The best order of one window group from where and when the previous group ends. "Any" stops fill where they save the
 * most, but an afternoon stop is never reached before its window opens: an order that would arrive early pays for the
 * wait, so the search fills the morning with "any" stops instead.
 */
function orderGroup(from: Point | null, clock: number, group: readonly Stop[], to: Point | null, settings: Settings): Stop[] {
  const placed = group.filter(hasPoint);
  const none = group.filter((s) => !hasPoint(s));
  if (placed.length <= 1) return [...placed, ...none];
  const seeds = [nearestNeighbor(from, placed)];
  const any = placed.filter((s) => s.window === "any");
  const later = placed.filter((s) => s.window !== "any");
  if (any.length && later.length) {
    const first = nearestNeighbor(from, any);
    const lastAny = pointOf(first[first.length - 1]);
    seeds.push([...first, ...nearestNeighbor(lastAny, later)]);
  }
  const results = seeds.map((s) => improve(from, clock, s, to, settings));
  results.sort((a, b) => a.cost - b.cost);
  return [...results[0].order, ...none];
}

/** Rule 2: started stops keep their places; the rest are ordered by window group, each group made short. */
export function optimizeDay(start: Point | null, stops: readonly Stop[], settings: Settings = DEFAULT_SETTINGS): Stop[] {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const lastStarted = sorted.reduce((i, s, idx) => (s.started ? idx : i), -1);
  const fixed = sorted.slice(0, lastStarted + 1);
  const free = sorted.slice(lastStarted + 1).filter((s) => !s.started);
  const done = walk(start, fixed, settings, toMin(settings.day_start));
  let clock = done.clock;
  let at: Point | null = fixed.length ? (done.at ?? start) : start;
  const groups = [0, 1, 2].map((g) => free.filter((s) => GROUP[s.window] === g));
  const out: Stop[] = [...fixed];
  groups.forEach((g, gi) => {
    if (g.length === 0) return;
    const nextGroup = groups.slice(gi + 1).find((x) => x.length);
    const toHint = (nextGroup ? (nextGroup.map(pointOf).find(Boolean) ?? null) : null) ?? start;
    const ordered = orderGroup(at, clock, g, toHint, settings);
    out.push(...ordered);
    const w = walk(at, ordered, settings, clock);
    clock = w.clock;
    at = w.at;
  });
  return out.map((s, i) => ({ ...s, position: i + 1 }));
}

export type Insertion = { index: number; added_miles: number; cost: number };

/**
 * Where one visit goes in a day without reordering it (rules 4 and 5): after the started stops, inside its window
 * group, at the least added miles. Null when every place would make a stop miss its window (the edge case: a fixed
 * window is never moved out of it).
 */
export function bestInsertion(start: Point | null, day: readonly Stop[], visit: Stop, settings: Settings = DEFAULT_SETTINGS): Insertion | null {
  const route = [...day].sort((a, b) => a.position - b.position);
  const lastStarted = route.reduce((i, s, idx) => (s.started ? idx : i), -1);
  const clock = toMin(settings.day_start);
  const base = walk(start, route, settings, clock);
  const baseMiles = pathLength(start, route, start);
  const fits = (i: number) => (i === 0 || GROUP[route[i - 1].window] <= GROUP[visit.window]) && (i === route.length || GROUP[route[i].window] >= GROUP[visit.window]);
  const indices = Array.from({ length: route.length - lastStarted }, (_, k) => lastStarted + 1 + k);
  // A day someone ordered by hand may already break the groups; then any place after the started stops will do.
  const allowed = indices.some(fits) ? indices.filter(fits) : indices;
  let best: Insertion | null = null;
  for (const i of allowed) {
    const trial = [...route.slice(0, i), visit, ...route.slice(i)];
    const w = walk(start, trial, settings, clock);
    if (w.late > base.late) continue;
    const added = pathLength(start, trial, start) - baseMiles;
    // The time it adds beyond its own service minutes (driving, and any wait it causes), as in `cost`.
    const c = added + ((w.clock - base.clock - visit.duration_minutes) * settings.mph) / 60;
    if (!best || c < best.cost - 1e-9) best = { index: i, added_miles: Math.round(added * 10) / 10, cost: c };
  }
  return best;
}

/** The day with the visit inserted at the index, positions renumbered. */
export function insertStop<T extends Stop>(day: readonly T[], visit: T, index: number): T[] {
  const route = [...day].sort((a, b) => a.position - b.position);
  return [...route.slice(0, index), visit, ...route.slice(index)].map((s, i) => ({ ...s, position: i + 1 }));
}

export type Tech = { id: string; start: Point | null; stops: Stop[] };
export type Candidate = Stop & { visit_id: string };
export type Placement = { visit_id: string; technician_id: string; position: number; added_miles: number };
/** Why a visit some technician may take found no day: every such day is full, or none has room in its window. */
export type Blocked = "full" | "window";

/**
 * Rule 4: each due visit goes where it adds the fewest miles plus a penalty for a technician already over the average
 * minutes, among the technicians `allowed` says may take it (the dispatch check) whose day is under `maxStops`. Each is
 * inserted into the day without reordering it. Returns placements (in the order they were made), the visits no one
 * could take, and why a visit someone was allowed still went nowhere.
 */
export function assignDay(
  techs: readonly Tech[],
  candidates: readonly Candidate[],
  allowed: (visitId: string, technicianId: string) => boolean,
  settings: Settings = DEFAULT_SETTINGS,
  penaltyMilesPerHour = 4,
  maxStops = Number.POSITIVE_INFINITY,
): { placements: Placement[]; unplaced: string[]; blocked: Record<string, Blocked>; miles_before: number; miles_after: number } {
  const routes = new Map(techs.map((t) => [t.id, [...t.stops].sort((a, b) => a.position - b.position)]));
  const starts = new Map(techs.map((t) => [t.id, t.start]));
  const minutes = (id: string) => (routes.get(id) ?? []).reduce((s, x) => s + x.duration_minutes, 0);
  const miles_before = Math.round(techs.reduce((s, t) => s + routeMiles(t.start, routes.get(t.id) ?? []), 0) * 10) / 10;
  const placements: Placement[] = [];
  const unplaced: string[] = [];
  const blocked: Record<string, Blocked> = {};
  // Hardest first: the visits the fewest technicians may take.
  const order = [...candidates].sort((a, b) => techs.filter((t) => allowed(a.visit_id, t.id)).length - techs.filter((t) => allowed(b.visit_id, t.id)).length);
  for (const c of order) {
    const avg = techs.length ? techs.reduce((s, t) => s + minutes(t.id), 0) / techs.length : 0;
    let best: { tech: string; cost: number; ins: Insertion } | null = null;
    let full = false;
    let window = false;
    for (const t of techs) {
      if (!allowed(c.visit_id, t.id)) continue;
      const route = routes.get(t.id) ?? [];
      if (route.length >= maxStops) {
        full = true;
        continue;
      }
      const ins = bestInsertion(t.start, route, c, settings);
      if (!ins) {
        window = true;
        continue;
      }
      const over = Math.max(0, minutes(t.id) + c.duration_minutes - avg) / 60;
      const cost = ins.cost + over * penaltyMilesPerHour;
      if (!best || cost < best.cost - 1e-9) best = { tech: t.id, cost, ins };
    }
    if (!best) {
      unplaced.push(c.visit_id);
      if (window) blocked[c.visit_id] = "window";
      else if (full) blocked[c.visit_id] = "full";
      continue;
    }
    routes.set(best.tech, insertStop(routes.get(best.tech) ?? [], c, best.ins.index));
    placements.push({ visit_id: c.visit_id, technician_id: best.tech, position: 0, added_miles: best.ins.added_miles });
  }
  for (const p of placements) p.position = (routes.get(p.technician_id) ?? []).findIndex((s) => s.id === p.visit_id) + 1;
  const miles_after = Math.round(techs.reduce((s, t) => s + routeMiles(starts.get(t.id) ?? null, routes.get(t.id) ?? []), 0) * 10) / 10;
  return { placements, unplaced, blocked, miles_before, miles_after };
}

export type FillIn = { visit_id: string; detour_miles: number | null; kind: "due" | "pull_forward" };

/** Rule 5: due visits first, then pull-forwards within the radius, each by the detour it adds to the day. */
export function rankFillIns(start: Point | null, day: readonly Stop[], options: readonly (Candidate & { kind: "due" | "pull_forward" })[], radiusMiles: number, settings: Settings = DEFAULT_SETTINGS): FillIn[] {
  const route = day.filter(hasPoint);
  const near = (p: Point) => [start, ...route.map(pointOf)].filter(Boolean).some((q) => miles(q as Point, p) <= radiusMiles);
  return options
    .map((o) => {
      const p = pointOf(o);
      const ins = bestInsertion(start, day, o, settings);
      if (!p) return { visit_id: o.visit_id, detour_miles: null, kind: o.kind, ok: o.kind === "due" && ins !== null };
      return { visit_id: o.visit_id, detour_miles: ins ? ins.added_miles : null, kind: o.kind, ok: ins !== null && (o.kind === "due" || near(p)) };
    })
    .filter((x) => x.ok)
    .sort((a, b) => (a.kind === b.kind ? (a.detour_miles ?? 1e9) - (b.detour_miles ?? 1e9) : a.kind === "due" ? -1 : 1))
    .map(({ visit_id, detour_miles, kind }) => ({ visit_id, detour_miles, kind }));
}

/** A box around the route that holds every point within `radiusMiles` of it (a prefilter for the database). */
export function routeBox(start: Point | null, day: readonly Pick<Stop, "lat" | "lng">[], radiusMiles: number): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  const pts = [start, ...day.map(pointOf)].filter(Boolean) as Point[];
  if (pts.length === 0) return null;
  const dLat = radiusMiles / 69;
  const lats = pts.map((p) => p.lat);
  const maxAbsLat = Math.min(85, Math.max(...lats.map(Math.abs)) + dLat);
  const dLng = radiusMiles / (69 * Math.cos((maxAbsLat * Math.PI) / 180));
  return { minLat: Math.min(...lats) - dLat, maxLat: Math.max(...lats) + dLat, minLng: Math.min(...pts.map((p) => p.lng)) - dLng, maxLng: Math.max(...pts.map((p) => p.lng)) + dLng };
}
