"use client";

import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";

export type MapPin = { id: string; lat: number; lng: number; label: string; detail: string; color: string; href: string };

/** The day's stops, colored by technician; unscheduled due visits in grey. Client only; the board never waits for tiles. */
export function DispatchMap({ pins }: { pins: MapPin[] }) {
  const center: [number, number] = pins.length
    ? [pins.reduce((s, p) => s + p.lat, 0) / pins.length, pins.reduce((s, p) => s + p.lng, 0) / pins.length]
    : [39.8283, -98.5795];
  return (
    <MapContainer center={center} zoom={pins.length ? 11 : 4} scrollWheelZoom={false} className="h-80 w-full rounded-md border border-stone-200" style={{ background: "#f5f5f4" }}>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {pins.map((p) => (
        <CircleMarker key={p.id} center={[p.lat, p.lng]} radius={9} pathOptions={{ color: p.color, fillColor: p.color, fillOpacity: 0.85, weight: 2 }}>
          <Popup>
            <a href={p.href} className="font-medium underline">
              {p.label}
            </a>
            <br />
            {p.detail}
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
