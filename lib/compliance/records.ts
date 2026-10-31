// The completion gate: what an application record must hold before a visit can be completed. Pure, shared by the
// device (immediate feedback) and the sync endpoint (the decision). The floor is the federal restricted-use record
// rule (40 CFR 171.303: product and EPA number, amount, site and its size, location, date, applicator name and
// certification); a state pack adds keys through `records.requiredFields`. Nothing here names a state.
import { type JobKind, PESTICIDE_JOB_KINDS } from "@/lib/catalog/service-lines";
import type { StatePack } from "@/lib/compliance/rules";

export const FEDERAL_RECORD_FIELDS = [
  "arrived_at",
  "departed_at",
  "property.address",
  "property.state",
  "service_type",
  "products",
  "product.amount",
  "product.site",
  "product.target_pests",
  "areas_treated",
  "applicator.name",
  "applicator.cert_number",
  "date",
] as const;

export const NON_PESTICIDE_RECORD_FIELDS = ["arrived_at", "departed_at", "note_or_photo"] as const;

export type Gap = { key: string };

export type RecordVisit = {
  job_kind: JobKind;
  arrived_at: string | null;
  departed_at: string | null;
  scheduled_for: string | null;
  areas_treated: readonly string[];
  target_pests: readonly string[];
  conditions: Record<string, unknown> | null;
  property_address: string | null;
  property_state: string | null;
  service_type_name: string | null;
};

export type RecordProduct = {
  product_name: string;
  epa_reg_no: string | null;
  amount: number | string | null;
  amount_unit: string | null;
  site_treated: string | null;
  target_pests: readonly string[];
};

export type RecordCrewMember = {
  role: string;
  name: string;
  credential: { cert_number: string | null; trainee: boolean } | null;
};

export function isPesticideVisit(jobKind: JobKind): boolean {
  return PESTICIDE_JOB_KINDS.includes(jobKind);
}

/** The field keys a completed visit must satisfy: the floor for its kind of work plus what the pack adds. */
export function requiredRecordFields(jobKind: JobKind, pack: StatePack | undefined): string[] {
  const base: readonly string[] = isPesticideVisit(jobKind) ? FEDERAL_RECORD_FIELDS : NON_PESTICIDE_RECORD_FIELDS;
  const extra = isPesticideVisit(jobKind) ? (pack?.rules["records.requiredFields"]?.value ?? []) : [];
  return [...new Set([...base, ...extra])];
}

function present(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return !Number.isNaN(value);
  return true;
}

/** Reads a dotted key such as "conditions.wind_mph" off the visit. */
function lookup(visit: RecordVisit, key: string): unknown {
  const [head, ...rest] = key.split(".");
  let current: unknown = (visit as unknown as Record<string, unknown>)[head];
  for (const part of rest) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Everything still missing for the record. Each gap carries a key the app translates ("gap.products"); extra pack
 * keys use "gap.field" with the key as a variable.
 */
export function recordGaps(visit: RecordVisit, products: readonly RecordProduct[], crew: readonly RecordCrewMember[], required: readonly string[], hasNoteOrPhoto: boolean): Gap[] {
  const gaps: Gap[] = [];
  const lead = crew.find((c) => c.role === "lead") ?? crew.find((c) => c.role === "applicator");
  const pesticide = isPesticideVisit(visit.job_kind);
  for (const key of required) {
    switch (key) {
      case "arrived_at":
        if (!visit.arrived_at) gaps.push({ key });
        break;
      case "departed_at":
        // Departure is written by the completion itself; it is a gap only when the visit is already complete without one.
        break;
      case "date":
        if (!visit.scheduled_for && !visit.arrived_at) gaps.push({ key });
        break;
      case "property.address":
        if (!present(visit.property_address)) gaps.push({ key });
        break;
      case "property.state":
        if (!present(visit.property_state)) gaps.push({ key });
        break;
      case "service_type":
        if (!present(visit.service_type_name)) gaps.push({ key });
        break;
      case "products":
        if (pesticide && products.length === 0) gaps.push({ key });
        break;
      case "product.amount":
        if (products.some((p) => !present(p.amount) || Number(p.amount) <= 0 || !present(p.amount_unit))) gaps.push({ key });
        break;
      case "product.site":
        if (products.some((p) => !present(p.site_treated))) gaps.push({ key });
        break;
      case "product.target_pests":
        if (products.some((p) => p.target_pests.length === 0) && visit.target_pests.length === 0) gaps.push({ key });
        break;
      case "areas_treated":
        if (pesticide && visit.areas_treated.length === 0) gaps.push({ key });
        break;
      case "applicator.name":
        if (!lead || !present(lead.name)) gaps.push({ key });
        break;
      case "applicator.cert_number":
        if (pesticide && (!lead?.credential || !present(lead.credential.cert_number))) gaps.push({ key });
        break;
      case "note_or_photo":
        if (!hasNoteOrPhoto) gaps.push({ key });
        break;
      default:
        if (!present(lookup(visit, key))) gaps.push({ key });
    }
  }
  return gaps;
}
