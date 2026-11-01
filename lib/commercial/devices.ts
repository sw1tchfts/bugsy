// Commercial device programs (spec 14), pure: the kinds, what counts as activity, hot devices, the device gate and the
// monthly trend. The tech app, the sync, the office pages and the binder all use these.

export const DEVICE_KINDS = ["bait_station", "rodent_trap", "multi_catch", "glue_board", "insect_light_trap", "pheromone_trap", "termite_station"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export const KIND_LABELS: Record<DeviceKind, string> = {
  bait_station: "Rodent bait station",
  rodent_trap: "Rodent trap",
  multi_catch: "Multi-catch trap",
  glue_board: "Glue board",
  insect_light_trap: "Insect light trap",
  pheromone_trap: "Pheromone monitor",
  termite_station: "Termite station",
};

/** The short tag printed on a map marker beside the device number. */
export const KIND_TAGS: Record<DeviceKind, string> = { bait_station: "BS", rodent_trap: "RT", multi_catch: "MC", glue_board: "GB", insect_light_trap: "ILT", pheromone_trap: "PM", termite_station: "TS" };

export const ZONES = ["interior", "exterior", "perimeter"] as const;
export type Zone = (typeof ZONES)[number];

export const CHECK_STATUSES = ["checked", "inaccessible", "missing", "damaged"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const ACTIVITY = ["none", "low", "medium", "high"] as const;
export type Activity = (typeof ACTIVITY)[number];

export const ACTIONS = ["cleaned", "rebaited", "replaced", "repaired", "relocated", "glue_board_replaced", "bulb_replaced"] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_LABELS: Record<Action, string> = {
  cleaned: "Cleaned",
  rebaited: "Rebaited",
  replaced: "Replaced",
  repaired: "Repaired",
  relocated: "Relocated",
  glue_board_replaced: "Glue board replaced",
  bulb_replaced: "Bulb replaced",
};

export const SIGHTING_SOURCES = ["customer", "office", "technician"] as const;
export const REC_CATEGORIES = ["sanitation", "exclusion", "structural", "storage", "moisture", "landscaping", "other"] as const;
export const REC_PRIORITIES = ["low", "medium", "high"] as const;
export const REC_STATUSES = ["open", "in_progress", "closed"] as const;

export function isDeviceKind(v: unknown): v is DeviceKind {
  return typeof v === "string" && (DEVICE_KINDS as readonly string[]).includes(v);
}

export type CheckLike = { device_id: string; checked_at: string | Date; status: string; activity: string | null; count: number | null; bait_consumed_pct: number | null };

/** Rule 5: activity seen, something caught, or bait eaten. */
export function hasActivity(c: Pick<CheckLike, "status" | "activity" | "count" | "bait_consumed_pct">): boolean {
  if (c.status !== "checked") return false;
  return (c.activity !== null && c.activity !== "none") || (c.count ?? 0) > 0 || (c.bait_consumed_pct ?? 0) > 0;
}

const ms = (v: string | Date) => (v instanceof Date ? v.getTime() : Date.parse(v));

/** Rule 5: devices with activity on at least `threshold` of their last `window` checks. */
export function hotDevices(checks: readonly CheckLike[], window = 3, threshold = 2): Set<string> {
  const byDevice = new Map<string, CheckLike[]>();
  for (const c of checks) byDevice.set(c.device_id, [...(byDevice.get(c.device_id) ?? []), c]);
  const hot = new Set<string>();
  for (const [id, list] of byDevice) {
    const recent = [...list].sort((a, b) => ms(b.checked_at) - ms(a.checked_at)).slice(0, window);
    if (recent.filter(hasActivity).length >= threshold) hot.add(id);
  }
  return hot;
}

export type GateDevice = { id: string; kind: string; status: string };

/** Rule 4: the active devices of the visit's kinds with no check at this visit yet. */
export function uncheckedDevices<T extends GateDevice>(devices: readonly T[], checked: ReadonlySet<string>, kinds: readonly string[]): T[] {
  if (kinds.length === 0) return [];
  return devices.filter((d) => d.status === "active" && kinds.includes(d.kind) && !checked.has(d.id));
}

/** A check needs a note unless the device was checked (rule 4). */
export function checkProblems(c: { status: string; notes: string | null; count: number | null; bait_consumed_pct: number | null }): string[] {
  const problems: string[] = [];
  if (!(CHECK_STATUSES as readonly string[]).includes(c.status)) problems.push("Pick what you found.");
  if (c.status !== "checked" && !(c.notes ?? "").trim()) problems.push("Say why the device was not checked.");
  if (c.count !== null && (!Number.isInteger(c.count) || c.count < 0)) problems.push("A count is a whole number.");
  if (c.bait_consumed_pct !== null && (c.bait_consumed_pct < 0 || c.bait_consumed_pct > 100)) problems.push("Bait eaten is 0 to 100 percent.");
  return problems;
}

/** Rule 3: a map position is a pair of fractions, or no position at all. */
export function validPosition(x: number | null, y: number | null): boolean {
  if (x === null && y === null) return true;
  return x !== null && y !== null && Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1;
}

export type TrendInput = { month: string; kind: string } & Pick<CheckLike, "status" | "activity" | "count" | "bait_consumed_pct">;
export type TrendRow = { month: string; kind: string; checked: number; active: number; rate: number | null; captures: number };

/** Rule 6: per month and kind, devices checked, devices with activity, the activity rate and the captures. */
export function trend(checks: readonly TrendInput[]): TrendRow[] {
  const rows = new Map<string, TrendRow>();
  for (const c of checks) {
    const key = `${c.month}|${c.kind}`;
    const row = rows.get(key) ?? { month: c.month, kind: c.kind, checked: 0, active: 0, rate: null, captures: 0 };
    if (c.status === "checked") row.checked += 1;
    if (hasActivity(c)) row.active += 1;
    row.captures += c.status === "checked" ? (c.count ?? 0) : 0;
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, rate: r.checked ? r.active / r.checked : null }))
    .sort((a, b) => a.month.localeCompare(b.month) || a.kind.localeCompare(b.kind));
}
