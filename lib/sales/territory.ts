// Territories and door knocks (spec 17 rules 1 and 2), pure.

export const OUTCOMES = ["not_home", "not_interested", "come_back", "sold", "do_not_knock"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABELS: Record<Outcome, string> = {
  not_home: "Not home",
  not_interested: "Not interested",
  come_back: "Come back",
  sold: "Sold",
  do_not_knock: "Do not knock",
};
/** The letter each outcome carries on the knock map, so the map never relies on color alone. */
export const OUTCOME_TAGS: Record<Outcome, string> = { not_home: "N", not_interested: "X", come_back: "C", sold: "S", do_not_knock: "D" };

export type TerritoryLike = { zip_codes: readonly string[]; streets: readonly string[] };

/** The street part of an address line, normalized: "123 N. Main St." and "125 north main street" are the same street. */
export function streetOf(line: string): string {
  const words = line
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const start = words.findIndex((w) => !/^\d+[a-z]?$/.test(w));
  const rest = start < 0 ? [] : words.slice(start);
  const map: Record<string, string> = { n: "north", s: "south", e: "east", w: "west", st: "street", ave: "avenue", av: "avenue", rd: "road", dr: "drive", ln: "lane", ct: "court", blvd: "boulevard", pl: "place", ter: "terrace", hwy: "highway", pkwy: "parkway", cir: "circle" };
  return rest.map((w) => map[w] ?? w).join(" ");
}

/** An address is in a territory when its ZIP is listed, or its street is (a territory with neither lists covers nothing). */
export function inTerritory(address: { line1: string; postal_code: string | null }, t: TerritoryLike): boolean {
  const zip = (address.postal_code ?? "").slice(0, 5);
  if (zip && t.zip_codes.some((z) => z.slice(0, 5) === zip)) return true;
  const street = streetOf(address.line1);
  return street !== "" && t.streets.some((s) => streetOf(s) === street);
}

export type KnockLike = { normalized_address: string; outcome: string; knocked_at: string | Date; cleared_at?: string | Date | null };

/** Rule 1: the address is on the do-not-knock list when its latest uncleared do-not-knock stands. */
export function doNotKnock(knocks: readonly KnockLike[], normalizedAddress: string): boolean {
  return knocks.some((k) => k.normalized_address === normalizedAddress && k.outcome === "do_not_knock" && !k.cleared_at);
}

/** The latest knock at each address. */
export function latestByAddress<T extends KnockLike>(knocks: readonly T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const k of knocks) {
    const had = out.get(k.normalized_address);
    if (!had || new Date(had.knocked_at).getTime() < new Date(k.knocked_at).getTime()) out.set(k.normalized_address, k);
  }
  return out;
}

export function knockStats(knocks: readonly KnockLike[]): Record<Outcome, number> & { doors: number; close_rate: number | null } {
  const counts = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
  for (const k of knocks) if ((OUTCOMES as readonly string[]).includes(k.outcome)) counts[k.outcome as Outcome] += 1;
  const doors = new Set(knocks.map((k) => k.normalized_address)).size;
  const answered = knocks.length - counts.not_home;
  return { ...counts, doors, close_rate: answered > 0 ? counts.sold / answered : null };
}
