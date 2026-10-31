import "server-only";
import { googleProvider } from "@/lib/geo/google";
import type { AddressInput } from "@/lib/geo/normalize";
import { stubProvider } from "@/lib/geo/stub";

export type GeocodeStatus = "pending" | "ok" | "failed" | "manual";

export type GeoResult = {
  normalizedAddress: string;
  line1: string;
  line2: string | null;
  city: string;
  stateCode: string;
  postalCode: string;
  county: string | null;
  lat: number | null;
  lng: number | null;
  status: GeocodeStatus;
};

export interface GeoProvider {
  readonly name: string;
  /** Validates and geocodes an address. Must not throw: a failure comes back as status "failed". */
  normalize(address: AddressInput): Promise<GeoResult>;
}

/** The configured provider: Google when a key is set, otherwise the deterministic stub. */
export function geoProvider(): GeoProvider {
  return process.env.GOOGLE_MAPS_API_KEY ? googleProvider(process.env.GOOGLE_MAPS_API_KEY) : stubProvider;
}
