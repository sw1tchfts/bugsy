import "server-only";
import type { AddressInput } from "@/lib/geo/normalize";
import { normalizeEmail } from "@/lib/geo/normalize";
import { type GeoResult, geoProvider } from "@/lib/geo/provider";

export function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function opt(formData: FormData, key: string): string | null {
  return str(formData, key) || null;
}

export function intOrNull(formData: FormData, key: string): number | null {
  const raw = str(formData, key);
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function emailOrNull(formData: FormData, key = "email"): string | null {
  return normalizeEmail(str(formData, key));
}

/** Reads the address fields written by AddressFields; null when every field is empty. */
export function readAddress(formData: FormData, prefix = ""): AddressInput | null {
  const line1 = str(formData, `${prefix}line1`);
  const city = str(formData, `${prefix}city`);
  const stateCode = str(formData, `${prefix}state_code`).toUpperCase();
  const postalCode = str(formData, `${prefix}postal_code`);
  if (!line1 && !city && !stateCode && !postalCode) return null;
  return { line1, line2: opt(formData, `${prefix}line2`), city, stateCode, postalCode };
}

export function addressComplete(address: AddressInput | null): address is AddressInput {
  return !!address && !!address.line1 && !!address.city && /^[A-Z]{2}$/.test(address.stateCode) && !!address.postalCode;
}

/** Normalizes and geocodes through the configured provider; never throws. */
export function geocode(address: AddressInput): Promise<GeoResult> {
  return geoProvider().normalize(address);
}

/** Columns shared by properties and leads, from a geo result. */
export function addressColumns(geo: GeoResult) {
  return {
    line1: geo.line1,
    line2: geo.line2,
    city: geo.city,
    state_code: geo.stateCode,
    postal_code: geo.postalCode,
    normalized_address: geo.normalizedAddress,
    county: geo.county,
    lat: geo.lat,
    lng: geo.lng,
    geocode_status: geo.status,
  };
}

/** Collects the form's string values so a client form can show them again after a validation stop. */
export function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$ACTION")) values[key] = value;
  }
  return values;
}
