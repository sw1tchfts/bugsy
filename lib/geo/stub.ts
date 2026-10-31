import { type AddressInput, normalizeAddress } from "@/lib/geo/normalize";
import type { GeoProvider } from "@/lib/geo/provider";

/** No network: normalizes the text and leaves the pin for later. Used in development and tests. */
export const stubProvider: GeoProvider = {
  name: "stub",
  async normalize(address: AddressInput) {
    return {
      normalizedAddress: normalizeAddress(address),
      line1: address.line1.trim(),
      line2: address.line2?.trim() || null,
      city: address.city.trim(),
      stateCode: address.stateCode.trim().toUpperCase(),
      postalCode: address.postalCode.trim(),
      county: null,
      lat: null,
      lng: null,
      status: "pending",
    };
  },
};
