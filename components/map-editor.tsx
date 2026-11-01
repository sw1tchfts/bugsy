"use client";

// The office's map editor (spec 14 rules 3 and 7): pick a floor plan and a device, tap where it is, save. The save is a
// server action; the device's history records the move.
import { useState } from "react";
import { SiteMap } from "@/components/site-map";
import { KIND_TAGS, type DeviceKind } from "@/lib/commercial/devices";

type MapRow = { id: string; name: string; file_id: string; width: number; height: number };
type DeviceRow = { id: string; number: string; kind: string; location: string; map_id: string | null; x: number | null; y: number | null };

export function MapEditor({
  tenantId,
  propertyId,
  maps,
  devices,
  hot,
  canWrite,
  place,
}: {
  tenantId: string;
  propertyId: string;
  maps: MapRow[];
  devices: DeviceRow[];
  hot: string[];
  canWrite: boolean;
  place: (formData: FormData) => Promise<void>;
}) {
  const [mapId, setMapId] = useState(maps[0]?.id ?? "");
  const [deviceId, setDeviceId] = useState("");
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const map = maps.find((m) => m.id === mapId);
  if (!map) return null;
  const hotSet = new Set(hot);
  const unplaced = devices.filter((d) => d.x === null);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        {maps.length > 1 ? (
          <label className="grid gap-1">
            Floor plan
            <select value={mapId} onChange={(e) => setMapId(e.target.value)} className="rounded border border-stone-300 px-2 py-1.5">
              {maps.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {canWrite ? (
          <form action={place} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="tenant_id" value={tenantId} />
            <input type="hidden" name="property_id" value={propertyId} />
            <input type="hidden" name="map_id" value={map.id} />
            <input type="hidden" name="x" value={pos?.x ?? ""} />
            <input type="hidden" name="y" value={pos?.y ?? ""} />
            <label className="grid gap-1">
              Device to place or move
              <select name="device_id" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className="rounded border border-stone-300 px-2 py-1.5" data-testid="place-device">
                <option value="">Choose a device</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {KIND_TAGS[d.kind as DeviceKind] ?? "?"} {d.number}: {d.location}
                    {d.x === null ? " (not on a map)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={!deviceId || !pos} className="rounded bg-emerald-800 px-3 py-1.5 text-white disabled:opacity-40" data-testid="place-save">
              Save position
            </button>
            <span className="text-xs text-stone-600">{deviceId ? (pos ? "Position picked; save it." : "Now tap the plan where it is.") : unplaced.length ? `${unplaced.length} device(s) not on a map.` : ""}</span>
          </form>
        ) : null}
      </div>
      <SiteMap
        src={`/api/files/${map.file_id}`}
        name={map.name}
        width={map.width}
        height={map.height}
        devices={devices.filter((d) => d.map_id === map.id).map((d) => ({ ...d, hot: hotSet.has(d.id) }))}
        selectedId={deviceId || null}
        pending={pos}
        onPick={canWrite && deviceId ? (x, y) => setPos({ x, y }) : undefined}
        testid="site-map"
      />
    </div>
  );
}
