// A technician's day drawn to scale (spec 19): the branch, the stops in order joined by the path, and where each
// technician last was. Plain SVG with labels in text, so it needs no map tiles and never relies on color alone.

export type RouteMapStop = { id: string; lat: number; lng: number; label: string };
export type RouteMapPosition = { id: string; lat: number; lng: number; label: string; age: string };

export function RouteMap({ start, stops, positions }: { start: { lat: number; lng: number } | null; stops: RouteMapStop[]; positions: RouteMapPosition[] }) {
  const pts = [...(start ? [start] : []), ...stops, ...positions];
  if (pts.length === 0) return <p className="text-sm text-stone-600">Nothing on this day has a location yet.</p>;
  const w = 640;
  const h = 320;
  const pad = 28;
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const span = (a: number, b: number) => (b - a < 1e-6 ? 1e-6 : b - a);
  const x = (lng: number) => pad + ((lng - minLng) / span(minLng, maxLng)) * (w - 2 * pad);
  const y = (lat: number) => h - pad - ((lat - minLat) / span(minLat, maxLat)) * (h - 2 * pad);
  const path = [...(start ? [start] : []), ...stops, ...(start ? [start] : [])].map((p, i) => `${i === 0 ? "M" : "L"}${x(p.lng).toFixed(1)},${y(p.lat).toFixed(1)}`).join(" ");
  return (
    <figure className="grid gap-1">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full rounded border border-stone-300 bg-white" role="img" aria-label={`${stops.length} stops`} data-testid="route-map">
        <path d={path} fill="none" stroke="#a8a29e" strokeWidth={2} />
        {start ? (
          <g>
            <rect x={x(start.lng) - 9} y={y(start.lat) - 9} width={18} height={18} fill="#44403c" stroke="#ffffff" strokeWidth={2} />
            <text x={x(start.lng)} y={y(start.lat) + 4} textAnchor="middle" fontSize={10} fontWeight={700} fill="#ffffff">
              B
            </text>
          </g>
        ) : null}
        {stops.map((s, i) => (
          <g key={s.id}>
            <title>{s.label}</title>
            <circle cx={x(s.lng)} cy={y(s.lat)} r={10} fill="#44403c" stroke="#ffffff" strokeWidth={2} />
            <text x={x(s.lng)} y={y(s.lat) + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#ffffff">
              {i + 1}
            </text>
          </g>
        ))}
        {positions.map((p) => (
          <g key={p.id} data-testid="route-map-position">
            <title>{`${p.label}, ${p.age}`}</title>
            <polygon points={`${x(p.lng)},${y(p.lat) - 11} ${x(p.lng) + 10},${y(p.lat) + 8} ${x(p.lng) - 10},${y(p.lat) + 8}`} fill="#2a78d6" stroke="#ffffff" strokeWidth={2} />
            <text x={x(p.lng) + 13} y={y(p.lat) + 4} fontSize={11} fill="#1c1917">
              {p.label} ({p.age})
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="text-xs text-stone-600">B is the branch; numbers are stops in order; triangles are technicians where they last were.</figcaption>
    </figure>
  );
}
