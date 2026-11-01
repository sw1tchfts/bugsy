// Row validation for each template (spec 10 rules 2 and 3): the same checks the app's forms make, as a typed value or
// field errors. Pure; references between files are resolved by lib/import/db.ts.
import { BILLING_MODES, CADENCES, type PlanInput, planIssues } from "@/lib/agreements/cadence";
import type { AgreementColumns } from "@/lib/agreements/forms";
import { type Coerced, type Row, bool, date, email, int, money, months, oneOf, state } from "./parse";

export const ACCOUNT_TYPES = ["residential", "commercial", "property_manager"] as const;
export const PROPERTY_TYPES = ["house", "townhouse", "condo", "apartment_building", "office", "retail", "restaurant", "warehouse", "food_plant", "school", "healthcare", "other"] as const;
export const CONTACT_ROLES = ["billing", "primary", "resident", "site_contact", "property_manager"] as const;
export const CHANNELS = ["email", "sms", "phone", "mail"] as const;

export type FieldError = { column: string | null; message: string };
export type Checked<T> = { value: T; errors: [] } | { value: null; errors: FieldError[] };

/** Collects coercions; `take` records a failure against its column and answers a fallback so checking continues. */
function collector() {
  const errors: FieldError[] = [];
  const take = <T,>(column: string, result: Coerced<T>, fallback: T): T => {
    if (result.ok) return result.value;
    errors.push({ column, message: result.message });
    return fallback;
  };
  const need = (column: string, value: string | null | undefined): string => {
    const v = (value ?? "").trim();
    if (!v) errors.push({ column, message: "is required" });
    return v;
  };
  return { errors, take, need };
}

function done<T>(value: T, errors: FieldError[]): Checked<T> {
  return errors.length ? { value: null, errors } : { value, errors: [] };
}

const text = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

/** The plan input for an agreement's columns, as the agreement form builds it (lib/agreements/forms.ts is server-only). */
export function planInputOf(columns: AgreementColumns, renewals = 0): PlanInput {
  return {
    cadence: columns.cadence,
    cadence_rule: columns.cadence_rule,
    starts_on: columns.starts_on,
    term_months: columns.term_months,
    first_visit_on: columns.first_visit_on,
    season_start: columns.season_start,
    season_end: columns.season_end,
    skip_months: columns.skip_months,
    interior_only_months: columns.interior_only_months,
    window_days: columns.window_days,
    initial_price_cents: columns.initial_price_cents,
    recurring_price_cents: columns.recurring_price_cents,
    renewals,
  };
}

export type AccountRow = {
  external_id: string;
  name: string;
  type: (typeof ACCOUNT_TYPES)[number];
  email: string | null;
  phone: string | null;
  terms_days: number;
  po_required: boolean;
  billing_line1: string | null;
  billing_city: string | null;
  billing_state_code: string | null;
  billing_postal_code: string | null;
  notes: string | null;
};

export function validateAccount(row: Row): Checked<AccountRow> {
  const v = row.values;
  const { errors, take, need } = collector();
  const value: AccountRow = {
    external_id: need("external_id", v.external_id),
    name: need("name", v.name),
    type: take("type", oneOf(v.type ?? "", ACCOUNT_TYPES, "residential"), "residential") ?? "residential",
    email: take("email", email(v.email ?? ""), null),
    phone: text(v.phone),
    terms_days: take("terms_days", int(v.terms_days ?? "", { min: 0, max: 120 }), 0) ?? 0,
    po_required: take("po_required", bool(v.po_required ?? "", false), false),
    billing_line1: text(v.billing_line1),
    billing_city: text(v.billing_city),
    billing_state_code: take("billing_state", state(v.billing_state ?? ""), null),
    billing_postal_code: text(v.billing_postal_code),
    notes: text(v.notes),
  };
  return done(value, errors);
}

export type PropertyRow = {
  external_id: string;
  account_external_id: string;
  name: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state_code: string;
  postal_code: string;
  property_type: (typeof PROPERTY_TYPES)[number];
  size_sqft: number | null;
  lot_sqft: number | null;
  unit_count: number | null;
  access_notes: string | null;
};

export function validateProperty(row: Row): Checked<PropertyRow> {
  const v = row.values;
  const { errors, take, need } = collector();
  const stateCode = need("state", v.state) ? take("state", state(v.state ?? ""), null) : null;
  const propertyType = need("property_type", v.property_type) ? take("property_type", oneOf(v.property_type ?? "", PROPERTY_TYPES, null), null) : null;
  const value = {
    external_id: need("external_id", v.external_id),
    account_external_id: need("account_external_id", v.account_external_id),
    name: text(v.name),
    line1: need("line1", v.line1),
    line2: text(v.line2),
    city: need("city", v.city),
    state_code: stateCode ?? "",
    postal_code: need("postal_code", v.postal_code),
    property_type: propertyType ?? "other",
    size_sqft: take("size_sqft", int(v.size_sqft ?? "", { min: 1, max: 10_000_000 }), null),
    lot_sqft: take("lot_sqft", int(v.lot_sqft ?? "", { min: 1, max: 100_000_000 }), null),
    unit_count: take("unit_count", int(v.unit_count ?? "", { min: 0, max: 100_000 }), null),
    access_notes: text(v.access_notes),
  } satisfies PropertyRow;
  return done(value, errors);
}

export type ContactRow = {
  external_id: string | null;
  account_external_id: string | null;
  property_external_id: string | null;
  name: string;
  role: (typeof CONTACT_ROLES)[number];
  email: string | null;
  phone: string | null;
  sms_opt_in: boolean;
  preferred_channel: (typeof CHANNELS)[number] | null;
  notice_consent_on: string | null;
  notice_consent_note: string | null;
};

export function validateContact(row: Row): Checked<ContactRow> {
  const v = row.values;
  const { errors, take, need } = collector();
  const role = need("role", v.role) ? take("role", oneOf(v.role ?? "", CONTACT_ROLES, null), null) : null;
  const value: ContactRow = {
    external_id: text(v.external_id),
    account_external_id: text(v.account_external_id),
    property_external_id: text(v.property_external_id),
    name: need("name", v.name),
    role: role ?? "primary",
    email: take("email", email(v.email ?? ""), null),
    phone: text(v.phone),
    sms_opt_in: take("sms_opt_in", bool(v.sms_opt_in ?? "", false), false),
    preferred_channel: take("preferred_channel", oneOf(v.preferred_channel ?? "", CHANNELS, null), null),
    notice_consent_on: take("notice_consent_on", date(v.notice_consent_on ?? ""), null),
    notice_consent_note: text(v.notice_consent_note),
  };
  if (!value.account_external_id && !value.property_external_id) errors.push({ column: "account_external_id", message: "a contact needs an account or a property" });
  if (value.role === "resident" && !value.property_external_id) errors.push({ column: "property_external_id", message: "a resident contact needs a property" });
  // Consent is recorded with the day and how, or not at all (spec 02 rule 7).
  if (Boolean(value.notice_consent_on) !== Boolean(value.notice_consent_note)) errors.push({ column: "notice_consent_on", message: "electronic notice consent needs both the day and how it was captured" });
  return done(value, errors);
}

export type AgreementRow = {
  external_id: string;
  account_external_id: string;
  property_external_id: string;
  service_type: string;
  columns: AgreementColumns;
  last_service_on: string | null;
  billed_to_date_cents: number | null;
};

export function validateAgreement(row: Row, cutoverOn: string): Checked<AgreementRow> {
  const v = row.values;
  const { errors, take, need } = collector();
  const cadence = need("cadence", v.cadence) ? take("cadence", oneOf(v.cadence ?? "", CADENCES, null), null) : null;
  const billingMode = need("billing_mode", v.billing_mode) ? take("billing_mode", oneOf(v.billing_mode ?? "", BILLING_MODES, null), null) : null;
  const startsOn = need("starts_on", v.starts_on) ? take("starts_on", date(v.starts_on ?? ""), null) : null;
  const firstVisitOn = take("first_visit_on", date(v.first_visit_on ?? ""), null) ?? startsOn;
  const initial = need("initial_price", v.initial_price) ? take("initial_price", money(v.initial_price ?? ""), null) : null;
  const recurring = need("recurring_price", v.recurring_price) ? take("recurring_price", money(v.recurring_price ?? ""), null) : null;
  if (initial !== null && initial < 0) errors.push({ column: "initial_price", message: "a price cannot be negative" });
  if (recurring !== null && recurring < 0) errors.push({ column: "recurring_price", message: "a price cannot be negative" });
  const cancelFee = take("cancel_fee", money(v.cancel_fee ?? ""), null) ?? 0;
  if (cancelFee < 0) errors.push({ column: "cancel_fee", message: "a cancellation fee cannot be negative" });
  const termMonths = take("term_months", int(v.term_months ?? "", { min: 1, max: 60 }), null) ?? 12;
  const every = take("every", int(v.every ?? "", { min: 1, max: 52 }), null);
  const unit = take("unit", oneOf(v.unit ?? "", ["weeks", "months"] as const, null), null);
  const rounds = take("rounds", int(v.rounds ?? "", { min: 1, max: 52 }), null);
  const seasonStart = take("season_start", date(v.season_start ?? ""), null);
  const seasonEnd = take("season_end", date(v.season_end ?? ""), null);
  const skip = take("skip_months", months(v.skip_months ?? ""), []);
  const lastServiceOn = take("last_service_on", date(v.last_service_on ?? ""), null);
  const billed = take("billed_to_date", money(v.billed_to_date ?? ""), null);
  if (billed !== null && billed < 0) errors.push({ column: "billed_to_date", message: "billed to date cannot be negative" });
  if (lastServiceOn && lastServiceOn >= cutoverOn) errors.push({ column: "last_service_on", message: `the last service before Bugsy must be before the go-live date ${cutoverOn}` });
  if (startsOn && startsOn > cutoverOn && lastServiceOn) errors.push({ column: "last_service_on", message: "an agreement that starts after go-live has no service before it" });

  const columns: AgreementColumns = {
    cadence: cadence ?? "quarterly",
    cadence_rule: cadence === "custom" ? { every: every ?? 0, unit: unit ?? "weeks" } : cadence === "seasonal_rounds" ? { rounds: rounds ?? 0 } : {},
    season_start: cadence === "seasonal_rounds" ? seasonStart : null,
    season_end: cadence === "seasonal_rounds" ? seasonEnd : null,
    skip_months: skip,
    interior_only_months: [],
    initial_price_cents: initial ?? 0,
    recurring_price_cents: recurring ?? 0,
    billing_mode: billingMode ?? "per_visit",
    term_months: termMonths,
    auto_renew: take("auto_renew", bool(v.auto_renew ?? "", true), true),
    cancel_fee_cents: cancelFee,
    starts_on: startsOn ?? cutoverOn,
    first_visit_on: firstVisitOn ?? cutoverOn,
    window_days: cadence === "custom" && unit === "weeks" ? 7 : 30,
    terms_text: null,
    notes: text(v.notes),
    recognition: "per_visit",
  };
  const value: AgreementRow = {
    external_id: need("external_id", v.external_id),
    account_external_id: need("account_external_id", v.account_external_id),
    property_external_id: need("property_external_id", v.property_external_id),
    service_type: need("service_type", v.service_type),
    columns,
    last_service_on: lastServiceOn,
    billed_to_date_cents: billed,
  };
  // The plan itself must make sense, as the agreement form checks it.
  if (errors.length === 0) for (const issue of planIssues(planInputOf(columns))) errors.push({ column: "cadence", message: issue });
  return done(value, errors);
}

export type BalanceRow = { account_external_id: string; amount_cents: number; as_of: string; due_on: string; reference: string | null; memo: string | null };

export function validateBalance(row: Row): Checked<BalanceRow> {
  const v = row.values;
  const { errors, take, need } = collector();
  const amount = need("amount", v.amount) ? take("amount", money(v.amount ?? ""), null) : null;
  const asOf = need("as_of", v.as_of) ? take("as_of", date(v.as_of ?? ""), null) : null;
  const dueOn = take("due_on", date(v.due_on ?? ""), null) ?? asOf;
  if (amount === 0) errors.push({ column: "amount", message: "a zero balance needs no row" });
  if (asOf && dueOn && dueOn < asOf) errors.push({ column: "due_on", message: "the due date cannot be before the as-of date" });
  const value: BalanceRow = {
    account_external_id: need("account_external_id", v.account_external_id),
    amount_cents: amount ?? 0,
    as_of: asOf ?? "",
    due_on: dueOn ?? "",
    reference: text(v.reference),
    memo: text(v.memo),
  };
  return done(value, errors);
}
