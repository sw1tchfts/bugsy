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
  };
};

export type RoutePayload = {
  date: string;
  loaded_at: string;
  tenant: { id: string; name: string; timezone: string };
  technician: { user_id: string; name: string; locale: string };
  visits: RouteVisit[];
  products: RouteProduct[];
};

export type ChangeKind = "en_route" | "arrive" | "conditions" | "areas_pests" | "product" | "note" | "photo" | "signature" | "complete";

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
  | { kind: "complete"; at: string };

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
