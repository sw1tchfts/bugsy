// Small server-rendered charts for the reports (spec 12), drawn to the data-viz method: one series in the accent
// blue, recessive axis and grid, 4px rounded data ends on the baseline, a 2px gap between bars, a native tooltip on
// every mark, and a table view beside each chart on its page.

const ACCENT = "#2a78d6";
const DEEMPHASIS = "#c3c2b7";
const GRID = "#e1e0d9";
const MUTED = "#898781";

/** The sequential blue ramp, light to dark, for heatmap cells. */
const RAMP = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"];

export type Point = { label: string; value: number | null; display: string };

function barPath(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/** A twelve-point sparkline for a stat tile: the past in gray, the latest point in the accent. */
export function Sparkline({ points, label }: { points: Point[]; label: string }) {
  const w = 120;
  const h = 28;
  const max = Math.max(...points.map((p) => p.value ?? 0), 0.0001);
  const step = w / Math.max(points.length, 1);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="mt-2 block">
      {points.map((p, i) => {
        const bh = p.value === null ? 0 : Math.max(2, (p.value / max) * (h - 2));
        return (
          <path key={p.label} d={barPath(i * step + 1, h - bh, step - 2, bh, 2)} fill={i === points.length - 1 ? ACCENT : DEEMPHASIS}>
            <title>{`${p.label}: ${p.display}`}</title>
          </path>
        );
      })}
    </svg>
  );
}

/** The smallest 1, 2, 2.5 or 5 times a power of ten at or above `v`, so gridlines land on round values. */
function niceCeiling(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

/** A single-series column chart over months with a zero baseline and three recessive gridlines. */
export function MonthBars({ points, label, format }: { points: Point[]; label: string; format: (v: number) => string }) {
  const w = 720;
  const h = 170;
  const left = 44;
  const bottom = 22;
  const top = 8;
  const plotH = h - bottom - top;
  const max = Math.max(...points.map((p) => p.value ?? 0), 0);
  const ceiling = niceCeiling(max * 1.05);
  const step = (w - left) / Math.max(points.length, 1);
  const ticks = [0, 0.5, 1].map((t) => t * ceiling);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="h-auto w-full" data-testid="month-bars">
      {ticks.map((t) => {
        const y = top + plotH - (t / ceiling) * plotH;
        return (
          <g key={t}>
            <line x1={left} x2={w} y1={y} y2={y} stroke={t === 0 ? DEEMPHASIS : GRID} strokeWidth={1} />
            <text x={left - 6} y={y + 4} textAnchor="end" fontSize={10} fill={MUTED}>
              {format(t)}
            </text>
          </g>
        );
      })}
      {points.map((p, i) => {
        const bh = p.value === null ? 0 : (p.value / ceiling) * plotH;
        const x = left + i * step + 1;
        return (
          <g key={p.label}>
            {p.value === null ? null : (
              <path d={barPath(x, top + plotH - bh, step - 2, bh, 4)} fill={ACCENT}>
                <title>{`${p.label}: ${p.display}`}</title>
              </path>
            )}
            <rect x={x} y={top} width={step - 2} height={plotH} fill="transparent">
              <title>{`${p.label}: ${p.display}`}</title>
            </rect>
            <text x={x + (step - 2) / 2} y={h - 6} textAnchor="middle" fontSize={10} fill={MUTED}>
              {p.label.slice(2)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** The background and ink for a heatmap cell holding a share from 0 to 1. */
export function heatStyle(share: number | null): { backgroundColor?: string; color?: string } {
  if (share === null) return {};
  const i = Math.max(0, Math.min(RAMP.length - 1, Math.round(share * (RAMP.length - 1))));
  return { backgroundColor: RAMP[i], color: i >= 7 ? "#ffffff" : "#0b0b0b" };
}
