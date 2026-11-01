// The five CSV templates Bugsy publishes for go-live (spec 10 rules 1 and 2). Required columns are the minimum to
// schedule and bill; every other column is optional with the app's defaults.

export const IMPORT_KINDS = ["accounts", "properties", "contacts", "agreements", "balances"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export type TemplateColumn = { name: string; required: boolean; description: string; example: string };
export type Template = { kind: ImportKind; label: string; description: string; columns: TemplateColumn[] };

const col = (name: string, required: boolean, description: string, example: string): TemplateColumn => ({ name, required, description, example });

export const TEMPLATES: Record<ImportKind, Template> = {
  accounts: {
    kind: "accounts",
    label: "Accounts",
    description: "Who pays: one row per customer account.",
    columns: [
      col("external_id", true, "The account's id in the old system; other files refer to it", "A-1001"),
      col("name", true, "Customer or company name", "Green Residence"),
      col("type", false, "residential, commercial or property_manager (default residential)", "residential"),
      col("email", false, "Billing email", "jgreen@example.com"),
      col("phone", false, "Main phone", "(614) 555-0141"),
      col("terms_days", false, "Net payment terms in days (default 0, due on receipt)", "0"),
      col("po_required", false, "yes when every invoice needs a PO number", "no"),
      col("billing_line1", false, "Billing street address, when it is not the service address", ""),
      col("billing_city", false, "Billing city", ""),
      col("billing_state", false, "Billing state, two letters", ""),
      col("billing_postal_code", false, "Billing ZIP code", ""),
      col("notes", false, "Anything the office should know", ""),
    ],
  },
  properties: {
    kind: "properties",
    label: "Properties",
    description: "Where the work happens: one row per service address.",
    columns: [
      col("external_id", true, "The property's id in the old system", "P-2001"),
      col("account_external_id", true, "The account that pays for it", "A-1001"),
      col("name", false, "A short name (Home, Building A)", "Home"),
      col("line1", true, "Street address", "412 Elm St"),
      col("line2", false, "Apartment, suite or unit", ""),
      col("city", true, "City", "Columbus"),
      col("state", true, "State, two letters; decides the compliance rules and tax", "OH"),
      col("postal_code", true, "ZIP code", "43201"),
      col("property_type", true, "house, townhouse, condo, apartment_building, office, retail, restaurant, warehouse, food_plant, school, healthcare or other", "house"),
      col("size_sqft", false, "Living or building area in square feet", "1850"),
      col("lot_sqft", false, "Lot size in square feet", "6500"),
      col("unit_count", false, "Units in a multifamily building", ""),
      col("access_notes", false, "Gate codes, pets, where to park", "Side gate code 4411"),
    ],
  },
  contacts: {
    kind: "contacts",
    label: "Contacts",
    description: "People at an account or a property: billing, primary, residents, site contacts.",
    columns: [
      col("external_id", false, "The contact's id in the old system, when it has one", "C-3001"),
      col("account_external_id", false, "The account the contact belongs to (this or a property is required)", "A-1001"),
      col("property_external_id", false, "The property the contact is at (required for a resident)", ""),
      col("name", true, "Full name", "June Green"),
      col("role", true, "billing, primary, resident, site_contact or property_manager", "primary"),
      col("email", false, "Email", "jgreen@example.com"),
      col("phone", false, "Phone", "(614) 555-0141"),
      col("sms_opt_in", false, "yes when the person agreed to texts", "no"),
      col("preferred_channel", false, "email, sms, phone or mail", "email"),
      col("notice_consent_on", false, "The day the person agreed to receive notices electronically (needs the note too)", ""),
      col("notice_consent_note", false, "How that consent was captured", ""),
    ],
  },
  agreements: {
    kind: "agreements",
    label: "Agreements",
    description: "Active service plans. Mid-term plans bring the last service date and what was billed before go-live.",
    columns: [
      col("external_id", true, "The agreement's id in the old system", "G-1"),
      col("account_external_id", true, "The account that pays", "A-1001"),
      col("property_external_id", true, "The property served", "P-2001"),
      col("service_type", true, "A service type name from the catalog, exactly", "General pest plan"),
      col("cadence", true, "monthly, bimonthly, quarterly, custom or seasonal_rounds", "quarterly"),
      col("billing_mode", true, "per_visit, flat_monthly or annual_prepay", "flat_monthly"),
      col("starts_on", true, "First day of the current term", "2026-01-01"),
      col("term_months", false, "Months in a term (default 12)", "12"),
      col("first_visit_on", false, "Start of the initial visit's window (default the start date)", "2026-01-15"),
      col("initial_price", true, "Price of the initial visit", "180.00"),
      col("recurring_price", true, "Price of each recurring visit", "120.00"),
      col("auto_renew", false, "yes to renew at the end of the term (default yes)", "yes"),
      col("cancel_fee", false, "Early cancellation fee", ""),
      col("every", false, "Custom cadence: the interval", ""),
      col("unit", false, "Custom cadence: weeks or months", ""),
      col("rounds", false, "Seasonal rounds: how many in the season", ""),
      col("season_start", false, "Seasonal rounds: first day of the season", ""),
      col("season_end", false, "Seasonal rounds: last day of the season", ""),
      col("skip_months", false, "Months with no visit, as numbers or names separated by semicolons", ""),
      col("last_service_on", false, "The last visit the old system did; visits due on or before it are marked done", "2026-07-20"),
      col("billed_to_date", false, "What the old system billed on this agreement before go-live (default: the agreement's own schedule)", ""),
      col("notes", false, "Notes for the office", ""),
    ],
  },
  balances: {
    kind: "balances",
    label: "Opening balances",
    description: "What each account owed at go-live, one row per open invoice; a negative amount is a credit.",
    columns: [
      col("account_external_id", true, "The account that owes", "A-1002"),
      col("amount", true, "The open amount; negative for a credit the customer has", "450.00"),
      col("as_of", true, "The day of the old invoice or the balance", "2026-09-30"),
      col("due_on", false, "When it is due (default the as-of day)", "2026-10-30"),
      col("reference", false, "The old invoice number", "INV-88812"),
      col("memo", false, "What it was for", ""),
    ],
  },
};

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The template as CSV: the header and one example row. */
export function templateCsv(kind: ImportKind): string {
  const t = TEMPLATES[kind];
  return `${t.columns.map((c) => c.name).join(",")}\n${t.columns.map((c) => csvCell(c.example)).join(",")}\n`;
}
