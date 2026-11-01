"use client";

// A site's floor plan with its devices (spec 14). Each marker carries its kind tag and number as text, so identity never
// rests on color; a hot device adds the critical status ring and a "!" (with a legend line). Tapping the plan reports a
// position as fractions of its width and height, for placing or moving a device.
import type { MouseEvent } from "react";
import { KIND_TAGS, type DeviceKind } from "@/lib/commercial/devices";

const MARK = "#2a78d6";
const CRITICAL = "#d03b3b";
const SELECTED = "#0b0b0b";

export type MapDevice = { id: string; number: string; kind: string; x: number | null; y: number | null; hot?: boolean };

export function SiteMap({
  src,
  name,
  width,
  height,
  devices,
  selectedId,
  pending,
  onPick,
  testid,
}: {
  src: string;
  name: string;
  width: number;
  height: number;
  devices: MapDevice[];
  selectedId?: string | null;
  pending?: { x: number; y: number } | null;
  onPick?: (x: number, y: number) => void;
  testid?: string;
}) {
  function pick(e: MouseEvent<HTMLDivElement>) {
    if (!onPick) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
    onPick(Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000);
  }
  const placed = devices.filter((d) => d.x !== null && d.y !== null);
  const hot = placed.some((d) => d.hot);
  return (
    <figure className="grid gap-1">
      <div
        className={`relative w-full overflow-hidden rounded border border-stone-300 bg-white ${onPick ? "cursor-crosshair" : ""}`}
        style={{ aspectRatio: `${width} / ${height}` }}
        onClick={pick}
        data-testid={testid}
        role={onPick ? "button" : "img"}
        aria-label={onPick ? `${name}: tap to place the device` : `${name} with ${placed.length} device(s)`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="absolute inset-0 h-full w-full object-fill" draggable={false} />
        <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden="true">
          {placed.map((d) => {
            const cx = (d.x as number) * width;
            const cy = (d.y as number) * height;
            const r = Math.max(9, Math.min(width, height) / 45);
            const label = `${KIND_TAGS[d.kind as DeviceKind] ?? "?"} ${d.number}`;
            return (
              <g key={d.id} data-device={d.number}>
                <title>{`${label}${d.hot ? ", hot: activity on 2 of the last 3 checks" : ""}`}</title>
                {d.hot ? <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke={CRITICAL} strokeWidth={3} /> : null}
                <circle cx={cx} cy={cy} r={r} fill={MARK} stroke={d.id === selectedId ? SELECTED : "#ffffff"} strokeWidth={d.id === selectedId ? 3 : 2} />
                <text x={cx} y={cy + r * 0.35} textAnchor="middle" fontSize={r * 0.95} fontWeight={600} fill="#ffffff">
                  {d.hot ? "!" : d.number.slice(0, 3)}
                </text>
                <text x={cx + r + 3} y={cy + r * 0.35} fontSize={r * 0.9} fill="#0b0b0b" stroke="#ffffff" strokeWidth={3} paintOrder="stroke">
                  {label}
                </text>
              </g>
            );
          })}
          {pending ? <circle cx={pending.x * width} cy={pending.y * height} r={10} fill="none" stroke={SELECTED} strokeWidth={3} strokeDasharray="4 3" /> : null}
        </svg>
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
        <span>{name}</span>
        <span className="flex items-center gap-1">
          <svg width="12" height="12" aria-hidden="true">
            <circle cx="6" cy="6" r="5" fill={MARK} />
          </svg>
          device (kind tag and number beside it)
        </span>
        {hot ? (
          <span className="flex items-center gap-1">
            <svg width="14" height="14" aria-hidden="true">
              <circle cx="7" cy="7" r="5.5" fill="none" stroke={CRITICAL} strokeWidth="2" />
            </svg>
            ! hot: activity on 2 of the last 3 checks
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
