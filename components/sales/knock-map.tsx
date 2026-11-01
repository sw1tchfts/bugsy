// The knocks in a territory as dots placed by their coordinates (spec 17). Each dot carries its outcome's letter as
// text, so the map never relies on color alone; a sale is the accent, everything else ink. No map tiles: it shows
// where the rep has been relative to each other, which is what a rep at the curb needs.
import { OUTCOME_LABELS, OUTCOME_TAGS, type Outcome } from "@/lib/sales/territory";

type Dot = { id: string; lat: number | null; lng: number | null; outcome: string; address: string };

export function KnockMap({ knocks }: { knocks: Dot[] }) {
  const placed = knocks.filter((k) => k.lat !== null && k.lng !== null) as (Dot & { lat: number; lng: number })[];
  if (placed.length === 0) return <p className="text-sm text-stone-600">No knocks with a location yet.</p>;
  const w = 600;
  const h = 360;
  const pad = 24;
  const lats = placed.map((k) => k.lat);
  const lngs = placed.map((k) => k.lng);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const span = (a: number, b: number) => (b - a === 0 ? 1 : b - a);
  const x = (lng: number) => pad + ((lng - minLng) / span(minLng, maxLng)) * (w - 2 * pad);
  const y = (lat: number) => h - pad - ((lat - minLat) / span(minLat, maxLat)) * (h - 2 * pad);
  const used = [...new Set(placed.map((k) => k.outcome))] as Outcome[];
  return (
    <figure className="grid gap-1">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full rounded border border-stone-300 bg-white" role="img" aria-label={`${placed.length} knocks`} data-testid="knock-map">
        {placed.map((k) => {
          const sold = k.outcome === "sold";
          return (
            <g key={k.id}>
              <title>{`${k.address}: ${OUTCOME_LABELS[k.outcome as Outcome] ?? k.outcome}`}</title>
              <circle cx={x(k.lng)} cy={y(k.lat)} r={10} fill={sold ? "#2a78d6" : "#44403c"} stroke="#ffffff" strokeWidth={2} />
              <text x={x(k.lng)} y={y(k.lat) + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#ffffff">
                {OUTCOME_TAGS[k.outcome as Outcome] ?? "?"}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 text-xs text-stone-600">
        {used.map((o) => (
          <span key={o}>
            {OUTCOME_TAGS[o]} {OUTCOME_LABELS[o].toLowerCase()}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
