// The completion gate: what an application record must hold before a visit can be completed. Pure, shared by the
// device (immediate feedback) and the sync endpoint (the decision). The floor is the federal restricted-use record
// rule (40 CFR 171.303: product and EPA number, amount, site and its size, location, date, applicator name and
// certification); a state pack adds keys through `records.requiredFields`. Nothing here names a state.
import { type JobKind, PESTICIDE_JOB_KINDS } from "@/lib/catalog/service-lines";
import type { StatePack } from "@/lib/compliance/rules";
import { addMonths, dateInZone, endOfDayInZone } from "@/lib/dates";
import type { RouteVisit } from "@/lib/tech/route-types";

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

// ---------------------------------------------------------------------------
// The application record (spec 07): a snapshot of the visit at lock time, never recomputed afterwards.
// ---------------------------------------------------------------------------

export type RecordSnapshot = {
  visit_id: string;
  business_date: string;
  time_zone: string;
  arrived_at: string | null;
  departed_at: string | null;
  account: { name: string };
  property: { address: string; city: string | null; state: string };
  service_type: { name: string; job_kind: JobKind };
  products: {
    product_name: string;
    epa_reg_no: string;
    amount: string;
    amount_unit: string;
    carrier_amount: string | null;
    carrier_unit: string | null;
    site_treated: string;
    location_description: string | null;
    target_pests: string[];
    label_check: { status: string; reason: string } | null;
    applied_by: { user_id: string; name: string; cert_number: string | null };
  }[];
  crew: { user_id: string; name: string; role: string; cert_number: string | null; categories: string[]; trainee: boolean; cert_expires_on: string | null }[];
  areas_treated: string[];
  target_pests: string[];
  conditions: Record<string, unknown> | null;
  notes: { kind: string; content: string; recorded_at: string }[];
  photo_count: number;
  signature: { signer_name: string; signed_at: string } | null;
  pack_version: string | null;
  required_fields: string[];
};

export type RecordBuild = { snapshot: RecordSnapshot; business_date: string; required: string[]; missing: string[]; complete: boolean };

/** Builds the record from the route visit as it stands now. Pure: the caller decides when to store and lock it. */
export function buildRecordSnapshot(visit: RouteVisit, pack: StatePack | undefined, timeZone: string): RecordBuild {
  const c = visit.captured;
  const departed = c.departed_at ?? c.completed_at ?? null;
  const business_date = departed ? dateInZone(departed, timeZone) : (visit.scheduled_for ?? visit.due_end);
  const required = requiredRecordFields(visit.job_kind, pack);
  const nameOf = (userId: string) => visit.crew.find((m) => m.user_id === userId);
  const products: RecordProduct[] = c.products.map((p) => ({
    product_name: p.product_name,
    epa_reg_no: p.epa_reg_no,
    amount: p.amount,
    amount_unit: p.amount_unit,
    site_treated: p.site_treated,
    target_pests: p.target_pests,
  }));
  const crew: RecordCrewMember[] = visit.crew.map((m) => ({
    role: m.role,
    name: m.name,
    credential: m.credential ? { cert_number: m.credential.cert_number, trainee: m.credential.trainee } : null,
  }));
  const missing = recordGaps(
    {
      job_kind: visit.job_kind,
      arrived_at: c.arrived_at,
      departed_at: departed,
      scheduled_for: visit.scheduled_for,
      areas_treated: c.areas_treated,
      target_pests: c.target_pests,
      conditions: c.conditions as Record<string, unknown> | null,
      property_address: visit.property.address,
      property_state: visit.property.state,
      service_type_name: visit.service_type.name,
    },
    products,
    crew,
    required,
    c.notes.length > 0 || c.photos.length > 0,
  ).map((g) => g.key);
  // A completed visit with no departure is a record gap even though the device gate never lists it.
  if (required.includes("departed_at") && !departed && !missing.includes("departed_at")) missing.push("departed_at");
  const snapshot: RecordSnapshot = {
    visit_id: visit.id,
    business_date,
    time_zone: timeZone,
    arrived_at: c.arrived_at,
    departed_at: departed,
    account: { name: visit.account.name },
    property: { address: visit.property.address, city: visit.property.city, state: visit.property.state },
    service_type: { name: visit.service_type.name, job_kind: visit.job_kind },
    products: c.products.map((p) => ({
      product_name: p.product_name,
      epa_reg_no: p.epa_reg_no,
      amount: p.amount,
      amount_unit: p.amount_unit,
      carrier_amount: p.carrier_amount,
      carrier_unit: p.carrier_unit,
      site_treated: p.site_treated,
      location_description: p.location_description,
      target_pests: p.target_pests,
      label_check: p.label_check,
      applied_by: { user_id: p.applied_by, name: nameOf(p.applied_by)?.name ?? "", cert_number: nameOf(p.applied_by)?.credential?.cert_number ?? null },
    })),
    crew: visit.crew.map((m) => ({
      user_id: m.user_id,
      name: m.name,
      role: m.role,
      cert_number: m.credential?.cert_number ?? null,
      categories: m.credential?.categories ?? [],
      trainee: m.credential?.trainee ?? false,
      cert_expires_on: m.credential?.cert_expires_on ?? null,
    })),
    areas_treated: c.areas_treated,
    target_pests: c.target_pests,
    conditions: (c.conditions as Record<string, unknown> | null) ?? null,
    notes: c.notes.map((n) => ({ kind: n.kind, content: n.content, recorded_at: n.recorded_at })),
    photo_count: c.photos.length,
    signature: c.signature ? { signer_name: c.signature.signer_name, signed_at: c.signature.signed_at } : null,
    pack_version: pack?.version ?? null,
    required_fields: required,
  };
  return { snapshot, business_date, required, missing, complete: missing.length === 0 };
}

/** When the record must be complete: the pack's `records.completeBy`, else the end of the business day (conservative). */
export function lockDueAt(departedAt: string | null, businessDate: string, timeZone: string, pack: StatePack | undefined): string {
  const rule = pack?.rules["records.completeBy"]?.value;
  if (rule && rule.kind === "hours_after_departure" && departedAt) {
    return new Date(new Date(departedAt).getTime() + rule.hours * 3_600_000).toISOString();
  }
  return endOfDayInZone(businessDate, timeZone);
}

/** The pack's retention period from the business date; null (keep) when the pack has none. */
export function retentionUntil(businessDate: string, pack: StatePack | undefined): string | null {
  const years = pack?.rules["records.retentionYears"]?.value;
  return typeof years === "number" && years > 0 ? addMonths(businessDate, years * 12) : null;
}

export type Amendment = { changed_fields: Record<string, { from: unknown; to: unknown }> };

/** The current reading of a locked record: the snapshot with every amendment applied in order, by dotted field key. */
export function applyAmendments<T extends Record<string, unknown>>(snapshot: T, amendments: readonly Amendment[]): T {
  const result = JSON.parse(JSON.stringify(snapshot)) as T;
  for (const amendment of amendments) {
    for (const [key, change] of Object.entries(amendment.changed_fields)) setPath(result, key, change.to);
  }
  return result;
}

/** Reads a dotted field key off a snapshot, with numeric segments as array indexes ("products.0.amount"). */
export function readPath(snapshot: Record<string, unknown>, key: string): unknown {
  let current: unknown = snapshot;
  for (const part of key.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setPath(target: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split(".");
  let current: Record<string, unknown> = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (next === null || typeof next !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}
