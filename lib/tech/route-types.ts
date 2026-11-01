// The route payload the device caches, and the changes it queues. Shared by the API routes and the client app.
import type { JobKind, TreatmentArea } from "@/lib/catalog/service-lines";
import type { LabelRate } from "@/lib/catalog/label-rates";
import type { ArrivalWindow, CrewRole } from "@/lib/dispatch/checks";
import type { Conditions } from "@/lib/weather/provider";

export type RouteProduct = {
  id: string;
  name: string;
  manufacturer: string | null;
  epa_reg_no: string;
  restricted_use: boolean;
  signal_word: string;
  label_rates: LabelRate[];
  unit: string;
  upc: string | null;
};

export type RouteCrewMember = {
  user_id: string;
  name: string;
  role: CrewRole;
  credential: { cert_number: string | null; categories: string[]; trainee: boolean; cert_expires_on: string | null } | null;
};

export type CapturedProduct = {
  id: string;
  product_id: string;
  product_name: string;
  epa_reg_no: string;
  applied_by: string;
  site_treated: string;
  location_description: string | null;
  amount: string;
  amount_unit: string;
  carrier_amount: string | null;
  carrier_unit: string | null;
  target_pests: string[];
  label_check: { status: string; reason: string } | null;
  recorded_at: string;
};

export type CapturedDeviceCheck = {
  id: string;
  device_id: string;
  status: string;
  activity: string | null;
  count: number | null;
  bait_consumed_pct: number | null;
  pest: string | null;
  actions: string[];
  notes: string | null;
  checked_at: string;
};

export type RouteDevice = {
  id: string;
  number: string;
  barcode: string | null;
  kind: string;
  zone: string;
  location: string;
  map_id: string | null;
  x: number | null;
  y: number | null;
  status: string;
  last: { checked_at: string; status: string; activity: string | null; count: number | null; bait_consumed_pct: number | null } | null;
};

export type RouteMap = { id: string; name: string; file_id: string; width: number; height: number };

/** A commercial program stop (spec 14): the device kinds this visit checks and the site's devices, maps and open items. */
export type RouteSite = {
  kinds: string[];
  devices: RouteDevice[];
  maps: RouteMap[];
  sightings: { id: string; seen_at: string; location: string; pest: string; notes: string | null }[];
  recommendations: { id: string; category: string; description: string; status: string; due_on: string | null }[];
};

export type CapturedCapture = { id: string; species: string; count: number; disposition: string; location: string | null; notes: string | null; created_at: string };
export type CapturedMaterial = { id: string; description: string; quantity: string; unit: string; unit_price_cents: number; billable: boolean; created_at: string };
export type CapturedPrepCheck = { ready: boolean; missing: string[]; notes: string | null; checked_at: string };

/** Specialty work at the stop (spec 15): the bed bug prep checklist and its check, wildlife captures with the job's
 *  authorization, and the materials used (any visit). */
export type RouteSpecialty = {
  step_label: string | null;
  prep_checklist: string[];
  prep_check: CapturedPrepCheck | null;
  wildlife: boolean;
  authorized: boolean;
  captures: CapturedCapture[];
  materials: CapturedMaterial[];
};

export type CapturedNote = { id: string; kind: string; content: string; recorded_at: string };
export type CapturedPhoto = { id: string; file_id: string; kind: string; caption: string | null; taken_at: string };
export type CapturedSignature = { signer_name: string; signed_at: string; file_id: string } | null;

export type RouteVisit = {
  id: string;
  sequence: number;
  status: string;
  kind: string;
  job_kind: JobKind;
  treatment_areas: TreatmentArea[];
  due_start: string;
  due_end: string;
  scheduled_for: string | null;
  route_position: number | null;
  arrival_window: ArrivalWindow;
  interior_only: boolean;
  reservice_reason: string | null;
  dispatch_notes: string | null;
  price_cents: number;
  billing_mode: string | null;
  agreement_number: number | null;
  account: { id: string; name: string; phone: string | null };
  property: { id: string; address: string; city: string | null; state: string; lat: number | null; lng: number | null; access_notes: string | null };
  service_type: { id: string; name: string };
  crew: RouteCrewMember[];
  state_rule: { required_cert_categories: string[]; pack_version: string | null; confirmed_at: string | null } | null;
  required_fields: string[];
  site: RouteSite | null;
  specialty?: RouteSpecialty;
  captured: {
    arrived_at: string | null;
    departed_at: string | null;
    completed_at: string | null;
    conditions: Conditions | null;
    areas_treated: string[];
    target_pests: string[];
    products: CapturedProduct[];
    notes: CapturedNote[];
    photos: CapturedPhoto[];
    signature: CapturedSignature;
    device_checks: CapturedDeviceCheck[];
  };
};

export type RoutePayload = {
  date: string;
  loaded_at: string;
  tenant: { id: string; name: string; timezone: string };
  technician: { user_id: string; name: string; locale: string };
  visits: RouteVisit[];
  products: RouteProduct[];
  /** Spec 18: the person's open time entry, and their truck's stock, cached for offline use. */
  clock: { open_since: string | null };
  truck: { name: string; items: { product_id: string; product_name: string; unit: string; on_hand: number; flag: "low" | "negative" | null }[] } | null;
};

/** Clock changes are not about a stop; they travel under this reserved id. */
export const CLOCK_VISIT = "00000000-0000-0000-0000-000000000000";

export type ChangeKind =
  | "en_route"
  | "arrive"
  | "conditions"
  | "areas_pests"
  | "product"
  | "note"
  | "photo"
  | "signature"
  | "complete"
  | "payment"
  | "device_check"
  | "device_add"
  | "device_move"
  | "device_remove"
  | "recommendation"
  | "prep_check"
  | "capture"
  | "material";

export type DeviceCheckPayload = {
  device_id: string;
  status: string;
  activity: string | null;
  count: number | null;
  bait_consumed_pct: number | null;
  pest: string | null;
  actions: string[];
  notes: string | null;
  checked_at: string;
};

export type ProductPayload = {
  product_id: string;
  applied_by: string;
  site_treated: string;
  location_description: string | null;
  amount: string;
  amount_unit: string;
  carrier_amount: string | null;
  carrier_unit: string | null;
  target_pests: string[];
  label_check: { status: string; reason: string } | null;
  recorded_at: string;
};

export type ChangePayload =
  | { kind: "en_route"; at: string }
  | { kind: "arrive"; at: string }
  | { kind: "conditions"; conditions: Conditions }
  | { kind: "areas_pests"; areas_treated: string[]; target_pests: string[] }
  | ({ kind: "product" } & ProductPayload)
  | { kind: "note"; note_kind: string; content: string; recorded_at: string }
  | { kind: "photo"; photo_kind: string; caption: string | null; taken_at: string; data_url: string }
  | { kind: "signature"; signer_name: string; signed_at: string; data_url: string }
  | { kind: "complete"; at: string }
  | { kind: "payment"; method: "cash" | "check"; amount_cents: number; reference: string | null; received_at: string }
  | ({ kind: "device_check" } & DeviceCheckPayload)
  | { kind: "device_add"; device_id: string; number: string; barcode: string | null; device_kind: string; zone: string; location: string; map_id: string | null; x: number | null; y: number | null; at: string }
  | { kind: "device_move"; device_id: string; zone: string; location: string; map_id: string | null; x: number | null; y: number | null; at: string }
  | { kind: "device_remove"; device_id: string; reason: string; at: string }
  | { kind: "recommendation"; category: string; description: string; responsibility: string; priority: string; at: string }
  | { kind: "prep_check"; ready: boolean; missing: string[]; notes: string | null; at: string }
  | { kind: "capture"; species: string; count: number; disposition: string; location: string | null; notes: string | null; at: string }
  | { kind: "material"; description: string; quantity: string; unit: string; unit_price_cents: number; billable: boolean; at: string }
  | { kind: "clock"; direction: "in" | "out"; at: string };

export type QueuedChange = {
  id: string;
  visit_id: string;
  created_at: string;
  payload: ChangePayload;
  status: "pending" | "synced" | "rejected";
  error: string | null;
  gaps: string[] | null;
};

/** `skipped`: not looked at because an earlier change for the same visit in the batch was rejected; it stays pending. */
export type SyncResult = { id: string; result: "applied" | "rejected" | "duplicate" | "skipped"; error?: string; gaps?: string[] };
