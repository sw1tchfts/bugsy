import { type AddressInput, normalizeAddress } from "@/lib/geo/normalize";
import type { GeoProvider, GeoResult } from "@/lib/geo/provider";

type ValidationResponse = {
  result?: {
    address?: {
      postalAddress?: { addressLines?: string[]; locality?: string; administrativeArea?: string; postalCode?: string };
      addressComponents?: { componentType?: string; componentName?: { text?: string } }[];
    };
    geocode?: { location?: { latitude?: number; longitude?: number } };
    verdict?: { addressComplete?: boolean; hasUnconfirmedComponents?: boolean };
  };
};

/** Google Address Validation API; county comes from the administrative_area_level_2 component. */
export function googleProvider(apiKey: string): GeoProvider {
  return {
    name: "google",
    async normalize(address: AddressInput): Promise<GeoResult> {
      const fallback: GeoResult = {
        normalizedAddress: normalizeAddress(address),
        line1: address.line1.trim(),
        line2: address.line2?.trim() || null,
        city: address.city.trim(),
        stateCode: address.stateCode.trim().toUpperCase(),
        postalCode: address.postalCode.trim(),
        county: null,
        lat: null,
        lng: null,
        status: "failed",
      };
      try {
        const res = await fetch(`https://addressvalidation.googleapis.com/v1:validateAddress?key=${encodeURIComponent(apiKey)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            address: {
              regionCode: "US",
              addressLines: [address.line1, address.line2].filter(Boolean),
              locality: address.city,
              administrativeArea: address.stateCode,
              postalCode: address.postalCode,
            },
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return fallback;
        const data = (await res.json()) as ValidationResponse;
        const result = data.result;
        const postal = result?.address?.postalAddress;
        const location = result?.geocode?.location;
        if (!postal?.addressLines?.length || !location) return fallback;
        const county = result?.address?.addressComponents?.find((c) => c.componentType === "administrative_area_level_2")?.componentName?.text ?? null;
        const normalized = {
          line1: postal.addressLines[0],
          line2: postal.addressLines[1] ?? null,
          city: postal.locality ?? address.city,
          stateCode: (postal.administrativeArea ?? address.stateCode).toUpperCase(),
          postalCode: postal.postalCode ?? address.postalCode,
        };
        return {
          ...normalized,
          normalizedAddress: normalizeAddress(normalized),
          county: county?.replace(/ County$/i, "") ?? null,
          lat: location.latitude ?? null,
          lng: location.longitude ?? null,
          status: result?.verdict?.addressComplete === false ? "failed" : "ok",
        };
      } catch {
        return fallback;
      }
    },
  };
}
