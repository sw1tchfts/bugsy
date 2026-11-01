import "server-only";
// Spec 19 Data: a branch's route start, geocoded from its address when no coordinates are typed.
import { geoProvider } from "@/lib/geo/provider";
import type { Point } from "./geo";

/** Reads "street, city, ST 12345" loosely; the state comes from the branch's own state field. */
export async function branchPoint(address: string, stateCode: string): Promise<Point | null> {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const postalCode = address.match(/\b\d{5}(?:-\d{4})?\b/)?.[0] ?? "";
  const city = (parts[1] ?? "").replace(/\b[A-Z]{2}\b\s*\d{5}(?:-\d{4})?$/, "").replace(/\d{5}(?:-\d{4})?$/, "").trim();
  const r = await geoProvider().normalize({ line1: parts[0], city, stateCode, postalCode });
  return r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng } : null;
}
