"use client";

// Termite diagram marks on a site's floor plan (spec 15 rule 8): pick the kind, write a label, tap where it is, save.
import { useState } from "react";
import { SiteMap } from "@/components/site-map";
import { MARK_KINDS, MARK_LABELS } from "@/lib/specialty/marks";

type MapRow = { id: string; name: string; file_id: string; width: number; height: number };
type DeviceRow = { id: string; number: string; kind: string; map_id: string | null; x: number | null; y: number | null };
type MarkRow = { id: string; map_id: string; kind: string; x: number; y: number; label: string };

export function MarkEditor({
  tenantId,
  propertyId,
  maps,
  devices,
  marks,
  canWrite,
  add,
  remove,
}: {
  tenantId: string;
  propertyId: string;
  maps: MapRow[];
  devices: DeviceRow[];
  marks: MarkRow[];
  canWrite: boolean;
  add: (formData: FormData) => Promise<void>;
  remove: (formData: FormData) => Promise<void>;
}) {
  const [mapId, setMapId] = useState(maps[0]?.id ?? "");
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const map = maps.find((m) => m.id === mapId);
  if (!map) return null;
  const here = marks.filter((m) => m.map_id === map.id);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        {maps.length > 1 ? (
          <label className="grid gap-1">
            Floor plan
            <select value={mapId} onChange={(e) => { setMapId(e.target.value); setPos(null); }} className="rounded border border-stone-300 px-2 py-1.5">
              {maps.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {canWrite ? (
          <form action={add} className="flex flex-wrap items-end gap-3" onSubmit={() => setPos(null)}>
            <input type="hidden" name="tenant_id" value={tenantId} />
            <input type="hidden" name="property_id" value={propertyId} />
            <input type="hidden" name="map_id" value={map.id} />
            <input type="hidden" name="x" value={pos?.x ?? ""} />
            <input type="hidden" name="y" value={pos?.y ?? ""} />
            <label className="grid gap-1">
              Mark
              <select name="kind" className="rounded border border-stone-300 px-2 py-1.5" data-testid="mark-kind">
                {MARK_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {MARK_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              Label
              <input name="label" required maxLength={80} className="rounded border border-stone-300 px-2 py-1.5" placeholder="Mud tubes on sill plate" data-testid="mark-label" />
            </label>
            <button type="submit" disabled={!pos} className="rounded bg-emerald-800 px-3 py-1.5 text-white disabled:opacity-40" data-testid="mark-save">
              Save mark
            </button>
            <span className="text-xs text-stone-600">{pos ? "Position picked; save it." : "Tap the plan where it is."}</span>
          </form>
        ) : null}
      </div>
      <SiteMap
        src={`/api/files/${map.file_id}`}
        name={map.name}
        width={map.width}
        height={map.height}
        devices={devices.filter((d) => d.map_id === map.id)}
        marks={here}
        pending={pos}
        onPick={canWrite ? (x, y) => setPos({ x, y }) : undefined}
        pickLabel="tap to place the mark"
        testid="mark-map"
      />
      {here.length ? (
        <ul className="grid gap-1 text-sm">
          {here.map((m) => (
            <li key={m.id} className="flex items-center gap-2" data-testid="mark-row">
              <span>
                {MARK_LABELS[m.kind as keyof typeof MARK_LABELS] ?? m.kind}: {m.label}
              </span>
              {canWrite ? (
                <form action={remove}>
                  <input type="hidden" name="tenant_id" value={tenantId} />
                  <input type="hidden" name="property_id" value={propertyId} />
                  <input type="hidden" name="mark_id" value={m.id} />
                  <button type="submit" className="text-xs text-red-800 underline">
                    Remove
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
