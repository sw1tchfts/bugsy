// Distances for routing (spec 19 rule 1), pure: great-circle miles and drive minutes at the company's speed. One
// module, so a road-routing provider can replace it (spec 20).

export type Point = { lat: number; lng: number };

const EARTH_MILES = 3958.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function miles(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Drive time at the average speed, rounded up to the minute. */
export function driveMinutes(distanceMiles: number, mph: number): number {
  if (!(mph > 0) || distanceMiles <= 0) return 0;
  return Math.ceil((distanceMiles / mph) * 60 - 1e-9);
}

export const hasPoint = (p: { lat: number | null; lng: number | null } | null | undefined): p is Point =>
  !!p && typeof p.lat === "number" && typeof p.lng === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lng);
