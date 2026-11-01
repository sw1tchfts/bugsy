// Route optimization (spec 19 rules 2 to 5), pure. A pest route is 8 to 20 stops: nearest neighbor then 2-opt inside each
// arrival window group gives a good order instantly; assignment is cheapest insertion with a balance penalty.
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
};

export type Settings = { mph: number; day_start: string; morning_ends: string; afternoon_ends: string };

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};
const fmt = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;

/** The order of groups (rule 2): morning, then any and afternoon together, then evening. */
const GROUP: Record<Window, number> = { morning: 0, any: 1, afternoon: 1, evening: 2 };

/** Miles of a path from the start through the points and back (points without coordinates add nothing). */
export function routeMiles(start: Point | null, stops: readonly Pick<Stop, "lat" | "lng">[]): number {
  const pts = stops.filter(hasPoint) as Point[];
  if (pts.length === 0) return 0;
  let total = 0;
  let prev: Point | null = start ?? pts[0];
  for (const p of pts) {
    if (prev) total += miles(prev, p);
    prev = p;
  }
  if (start && prev) total += miles(prev, start);
  return Math.round(total * 10) / 10;
}

function nearestNeighbor(from: Point | null, stops: Stop[]): Stop[] {
  const left = stops.filter(hasPoint);
  const none = stops.filter((s) => !hasPoint(s));
  const out: Stop[] = [];
  let at = from ?? (left[0] ? { lat: left[0].lat as number, lng: left[0].lng as number } : null);
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i += 1) if (at && miles(at, left[i] as Point) < miles(at, left[best] as Point)) best = i;
    const [next] = left.splice(best, 1);
    out.push(next);
    at = next as Point;
  }
  return [...out, ...none];
}

/** Path length from `from` through the group and on to `to` (the next group's first stop, or home). */
function pathMiles(from: Point | null, group: Stop[], to: Point | null): number {
  const pts = group.filter(hasPoint) as unknown as Point[];
  let total = 0;
  let prev = from;
  for (const p of pts) {
    if (prev) total += miles(prev, p);
    prev = p;
  }
  if (prev && to) total += miles(prev, to);
  return total;
}

function twoOpt(from: Point | null, group: Stop[], to: Point | null): Stop[] {
  const placed = group.filter(hasPoint);
  const none = group.filter((s) => !hasPoint(s));
  let best = placed;
  let bestLen = pathMiles(from, best, to);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i += 1) {
      for (let k = i + 1; k < best.length; k += 1) {
        const candidate = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        const len = pathMiles(from, candidate, to);
        if (len + 1e-9 < bestLen) {
          best = candidate;
          bestLen = len;
          improved = true;
        }
      }
    }
  }
  return [...best, ...none];
}

/** Rule 2: started stops keep their places; the rest are ordered by window group, each group made short. */
export function optimizeDay(start: Point | null, stops: readonly Stop[]): Stop[] {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const lastStarted = sorted.reduce((i, s, idx) => (s.started ? idx : i), -1);
  const fixed = sorted.slice(0, lastStarted + 1);
  const free = sorted.slice(lastStarted + 1).filter((s) => !s.started);
  const from = [...fixed].reverse().find(hasPoint) ?? start;
  const groups = [0, 1, 2].map((g) => free.filter((s) => GROUP[s.window] === g));
  const out: Stop[] = [...fixed];
  let at: Point | null = from ? { lat: (from as Point).lat, lng: (from as Point).lng } : null;
  groups.forEach((g, gi) => {
    if (g.length === 0) return;
    const nextGroup = groups.slice(gi + 1).find((x) => x.length);
    const toHint = nextGroup ? (nextGroup.find(hasPoint) as Point | undefined) ?? start : start;
    const ordered = twoOpt(at, nearestNeighbor(at, g), toHint ?? null);
    out.push(...ordered);
    const last = [...ordered].reverse().find(hasPoint);
    if (last) at = last as Point;
  });
  return out.map((s, i) => ({ ...s, position: i + 1 }));
}

export type Eta = { id: string; arrive: string; depart: string; drive_minutes: number; missed: boolean; no_location: boolean };

/** Rule 3: arrival estimates from the day start (or a given start time), with windows the estimate misses flagged. */
export function estimates(start: Point | null, stops: readonly Stop[], settings: Settings, startAt?: number): Eta[] {
  let clock = startAt ?? toMin(settings.day_start);
  let at: Point | null = start;
  const out: Eta[] = [];
  for (const s of stops) {
    const here = hasPoint(s) ? ({ lat: s.lat, lng: s.lng } as Point) : null;
    const drive = at && here ? driveMinutes(miles(at, here), settings.mph) : 0;
    clock += drive;
    const arrive = clock;
    const missed =
      (s.window === "morning" && arrive >= toMin(settings.morning_ends)) ||
      (s.window === "afternoon" && (arrive < toMin(settings.morning_ends) - 60 || arrive >= toMin(settings.afternoon_ends))) ||
      (s.window === "evening" && arrive < toMin(settings.afternoon_ends) - 60);
    clock += s.duration_minutes;
    out.push({ id: s.id, arrive: fmt(arrive), depart: fmt(clock), drive_minutes: drive, missed, no_location: !here });
    if (here) at = here;
  }
  return out;
}

export type Tech = { id: string; start: Point | null; stops: Stop[] };
export type Candidate = Stop & { visit_id: string };
export type Placement = { visit_id: string; technician_id: string; position: number; added_miles: number };

/** Added miles of putting a point between two route points (or at the end). */
function insertionCost(start: Point | null, route: readonly Stop[], p: Point): { cost: number; index: number } {
  const pts = [start, ...route.filter(hasPoint).map((s) => ({ lat: s.lat as number, lng: s.lng as number })), start];
  let best = { cost: Number.POSITIVE_INFINITY, index: route.length };
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const cost = a && b ? miles(a, p) + miles(p, b) - miles(a, b) : a ? miles(a, p) : b ? miles(p, b) : 0;
    if (cost < best.cost) best = { cost, index: i };
  }
  return best;
}

/**
 * Rule 4: each due visit goes where it adds the fewest miles plus a penalty for a technician already over the average
 * minutes, among the technicians `allowed` says may take it (the dispatch check). Returns placements and the visits no
 * one could take.
 */
export function assignDay(
  techs: readonly Tech[],
  candidates: readonly Candidate[],
  allowed: (visitId: string, technicianId: string) => boolean,
  settings: Settings,
  penaltyMilesPerHour = 4,
): { placements: Placement[]; unplaced: string[] } {
  const routes = new Map(techs.map((t) => [t.id, [...t.stops]]));
  const minutes = (id: string) => (routes.get(id) ?? []).reduce((s, x) => s + x.duration_minutes, 0);
  const placements: Placement[] = [];
  const unplaced: string[] = [];
  // Hardest first: the visits the fewest technicians may take.
  const order = [...candidates].sort((a, b) => techs.filter((t) => allowed(a.visit_id, t.id)).length - techs.filter((t) => allowed(b.visit_id, t.id)).length);
  for (const c of order) {
    const avg = techs.length ? techs.reduce((s, t) => s + minutes(t.id), 0) / techs.length : 0;
    let best: { tech: string; cost: number; added: number } | null = null;
    for (const t of techs) {
      if (!allowed(c.visit_id, t.id)) continue;
      const route = routes.get(t.id) ?? [];
      const ins = hasPoint(c) ? insertionCost(t.start, route, { lat: c.lat as number, lng: c.lng as number }) : { cost: 0, index: route.length };
      const over = Math.max(0, minutes(t.id) + c.duration_minutes - avg) / 60;
      const cost = ins.cost + over * penaltyMilesPerHour;
      if (!best || cost < best.cost - 1e-9) best = { tech: t.id, cost, added: ins.cost };
    }
    if (!best) {
      unplaced.push(c.visit_id);
      continue;
    }
    const route = routes.get(best.tech) as Stop[];
    route.push(c);
    placements.push({ visit_id: c.visit_id, technician_id: best.tech, position: route.length, added_miles: Math.round(best.added * 10) / 10 });
  }
  // The final order of each touched day is the optimizer's.
  for (const t of techs) {
    const ordered = optimizeDay(t.start, routes.get(t.id) ?? []);
    for (const p of placements.filter((x) => x.technician_id === t.id)) p.position = ordered.findIndex((s) => s.id === p.visit_id) + 1;
  }
  void settings;
  return { placements, unplaced };
}

export type FillIn = { visit_id: string; detour_miles: number | null; kind: "due" | "pull_forward" };

/** Rule 5: due visits first, then pull-forwards within the radius, each by the detour it adds to the day. */
export function rankFillIns(start: Point | null, day: readonly Stop[], options: readonly (Candidate & { kind: "due" | "pull_forward" })[], radiusMiles: number): FillIn[] {
  const route = day.filter(hasPoint);
  const near = (p: Point) => [start, ...route.map((s) => ({ lat: s.lat as number, lng: s.lng as number }))].filter(Boolean).some((q) => miles(q as Point, p) <= radiusMiles);
  return options
    .map((o) => {
      if (!hasPoint(o)) return { visit_id: o.visit_id, detour_miles: null, kind: o.kind, ok: o.kind === "due" };
      const p = { lat: o.lat as number, lng: o.lng as number };
      return { visit_id: o.visit_id, detour_miles: Math.round(insertionCost(start, day, p).cost * 10) / 10, kind: o.kind, ok: o.kind === "due" || near(p) };
    })
    .filter((x) => x.ok)
    .sort((a, b) => (a.kind === b.kind ? (a.detour_miles ?? 1e9) - (b.detour_miles ?? 1e9) : a.kind === "due" ? -1 : 1))
    .map(({ visit_id, detour_miles, kind }) => ({ visit_id, detour_miles, kind }));
}
