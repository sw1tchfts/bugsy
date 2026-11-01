"use client";

// Where the rep is standing when they knock (spec 17): the phone's location, when the rep allows it, rides along with
// the knock so the territory map shows the door even before the address is geocoded. Nothing is sent without consent.
import { useEffect, useState } from "react";

export function DoorLocation() {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [state, setState] = useState<"asking" | "on" | "off">("asking");
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      // No location on this device: say so after the first paint, which matched the server's.
      const t = setTimeout(() => setState("off"), 0);
      return () => clearTimeout(t);
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPos({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) });
        setState("on");
      },
      () => setState("off"),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return (
    <>
      <input type="hidden" name="here_lat" value={pos?.lat ?? ""} />
      <input type="hidden" name="here_lng" value={pos?.lng ?? ""} />
      <p className="text-xs text-stone-500" data-testid="door-location">
        {state === "on" ? "Your location is saved with the knock." : state === "asking" ? "Finding your location..." : "Location is off; the address places the knock."}
      </p>
    </>
  );
}
