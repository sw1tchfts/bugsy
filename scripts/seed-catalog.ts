// Spec 03 seed: service types with state rules, a price book, the demo product master and enabled products per tenant.
// Called from seed.ts. Product values are demo data for local development; verify against the current label before
// relying on any of them.
import type postgres from "postgres";
import { EPA_EXEMPT } from "../lib/catalog/epa";
import { type ServiceTypeTemplate, templateByKey } from "../lib/catalog/service-lines";
import { ensureStateRules } from "../lib/catalog/state-rules";
import type { SeedTenant } from "./seed-data";

type Sql = postgres.Sql;

type MasterProduct = {
  name: string;
  manufacturer: string;
  epa_reg_no: string;
  active_ingredients: string[];
  signal_word: "caution" | "warning" | "danger" | "none";
  restricted_use: boolean;
  rei_hours: number | null;
  formulation: string;
  label_rates: unknown[];
};

const PPLS = (regNo: string) => `https://ordspub.epa.gov/ords/pesticides/f?p=PPLS:102:::NO::P102_REG_NUM:${regNo}`;

export const DEMO_MASTER_PRODUCTS: MasterProduct[] = [
  {
    name: "Termidor SC",
    manufacturer: "BASF",
    epa_reg_no: "7969-210",
    active_ingredients: ["fipronil 9.1%"],
    signal_word: "caution",
    restricted_use: false,
    rei_hours: null,
    formulation: "Suspension concentrate",
    label_rates: [{ site: "perimeter", target_pests: ["termites", "ants"], min_rate: 0.8, max_rate: 1.6, rate_unit: "fl_oz/gal", dilution_min: 0.06, dilution_max: 0.125 }],
  },
  {
    name: "Demand CS",
    manufacturer: "Syngenta",
    epa_reg_no: "100-1066",
    active_ingredients: ["lambda-cyhalothrin 9.7%"],
    signal_word: "caution",
    restricted_use: false,
    rei_hours: null,
    formulation: "Microencapsulated",
    label_rates: [{ site: "perimeter", target_pests: ["ants", "spiders", "cockroaches"], min_rate: 0.2, max_rate: 0.8, rate_unit: "fl_oz/gal" }],
  },
  {
    name: "Suspend SC",
    manufacturer: "Envu",
    epa_reg_no: "432-763",
    active_ingredients: ["deltamethrin 4.75%"],
    signal_word: "caution",
    restricted_use: false,
    rei_hours: null,
    formulation: "Suspension concentrate",
    label_rates: [{ site: "any", target_pests: ["general pests"], min_rate: 0.25, max_rate: 1.5, rate_unit: "fl_oz/gal" }],
  },
  {
    name: "Talstar P",
    manufacturer: "FMC",
    epa_reg_no: "279-3206",
    active_ingredients: ["bifenthrin 7.9%"],
    signal_word: "caution",
    restricted_use: false,
    rei_hours: null,
    formulation: "Flowable",
    label_rates: [{ site: "perimeter", target_pests: ["ants", "mosquitoes", "ticks"], min_rate: 0.5, max_rate: 1, rate_unit: "fl_oz/gal" }],
  },
  {
    name: "Tempo SC Ultra",
    manufacturer: "Envu",
    epa_reg_no: "432-1363",
    active_ingredients: ["beta-cyfluthrin 11.8%"],
    signal_word: "caution",
    restricted_use: false,
    rei_hours: null,
    formulation: "Suspension concentrate",
    label_rates: [{ site: "any", target_pests: ["general pests"], min_rate: 0.27, max_rate: 0.54, rate_unit: "fl_oz/gal" }],
  },
  {
    name: "Advion Cockroach Gel Bait",
    manufacturer: "Syngenta",
    epa_reg_no: "100-1484",
    active_ingredients: ["indoxacarb 0.6%"],
    signal_word: "caution",
    restricted_use: false,
    rei_hours: null,
    formulation: "Gel bait",
    label_rates: [],
  },
  {
    name: "Contrac Blox",
    manufacturer: "Bell Laboratories",
    epa_reg_no: "12455-79",
    active_ingredients: ["bromadiolone 0.005%"],
    signal_word: "caution",
    restricted_use: false,
    rei_hours: null,
    formulation: "Block bait",
    label_rates: [],
  },
  {
    name: "Premise 2",
    manufacturer: "Envu",
    epa_reg_no: "432-1331",
    active_ingredients: ["imidacloprid 21.4%"],
    signal_word: "caution",
    restricted_use: false,
    rei_hours: null,
    formulation: "Suspension concentrate",
    label_rates: [],
  },
  {
    name: "Vikane",
    manufacturer: "Douglas Products",
    epa_reg_no: "62719-4",
    active_ingredients: ["sulfuryl fluoride 99.8%"],
    signal_word: "danger",
    restricted_use: true,
    rei_hours: null,
    formulation: "Gas fumigant",
    label_rates: [],
  },
];

type PriceBand = { name: string; add_on?: boolean; size_basis?: "none" | "size_sqft" | "lot_sqft"; size_min?: number; size_max?: number | null; initial: number; recurring: number; one_time?: number; position: number };

/** The templates each demo tenant sells, with the price book for those priced from the book. Prices are in cents. */
const SEED_SERVICE_TYPES: { template: string; prices: PriceBand[] }[] = [
  {
    template: "general_pest_plan",
    prices: [
      { name: "Quarterly plan", size_basis: "size_sqft", size_min: 0, size_max: 2000, initial: 19900, recurring: 9900, position: 1 },
      { name: "Quarterly plan", size_basis: "size_sqft", size_min: 2000, size_max: 3500, initial: 24900, recurring: 11900, position: 2 },
      { name: "Quarterly plan", size_basis: "size_sqft", size_min: 3500, size_max: null, initial: 29900, recurring: 13900, position: 3 },
      { name: "Detached garage", add_on: true, initial: 2500, recurring: 1500, position: 4 },
      { name: "Crawl space", add_on: true, initial: 4000, recurring: 2000, position: 5 },
    ],
  },
  {
    template: "general_pest_one_time",
    prices: [{ name: "One-time treatment", initial: 0, recurring: 0, one_time: 22500, position: 1 }],
  },
  {
    template: "rodent_program",
    prices: [
      { name: "Rodent program", size_basis: "size_sqft", size_min: 0, size_max: 3000, initial: 32500, recurring: 8900, position: 1 },
      { name: "Rodent program", size_basis: "size_sqft", size_min: 3000, size_max: null, initial: 39500, recurring: 10900, position: 2 },
    ],
  },
  {
    template: "mosquito_tick_season",
    prices: [
      { name: "Season program", size_basis: "lot_sqft", size_min: 0, size_max: 10000, initial: 8900, recurring: 8900, position: 1 },
      { name: "Season program", size_basis: "lot_sqft", size_min: 10000, size_max: 22000, initial: 11900, recurring: 11900, position: 2 },
      { name: "Season program", size_basis: "lot_sqft", size_min: 22000, size_max: null, initial: 14900, recurring: 14900, position: 3 },
    ],
  },
  { template: "termite_inspection", prices: [] },
  { template: "bed_bug_treatment", prices: [] },
];

async function upsertServiceType(sql: Sql, tenantId: string, t: ServiceTypeTemplate): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into public.service_types (tenant_id, service_line, name, description, job_kind, treatment_areas, pricing_method, default_duration_minutes)
    values (${tenantId}, ${t.serviceLine}, ${t.name}, ${t.description}, ${t.jobKind}, ${t.treatmentAreas}, ${t.pricingMethod}, ${t.defaultDurationMinutes})
    on conflict (tenant_id, lower(name)) where archived_at is null do update set description = excluded.description
    returning id`;
  return row.id;
}

export async function seedMasterProducts(sql: Sql): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const p of DEMO_MASTER_PRODUCTS) {
    const [row] = await sql<{ id: string }[]>`
      insert into public.products (tenant_id, name, manufacturer, epa_reg_no, active_ingredients, signal_word, restricted_use, rei_hours, formulation, label_url, label_rates, verified_at)
      values (null, ${p.name}, ${p.manufacturer}, ${p.epa_reg_no}, ${p.active_ingredients}, ${p.signal_word}, ${p.restricted_use}, ${p.rei_hours}, ${p.formulation},
              ${PPLS(p.epa_reg_no)}, ${sql.json(p.label_rates)}, now())
      on conflict (epa_reg_no) where tenant_id is null and epa_reg_no <> '25b-exempt' do update set name = excluded.name
      returning id`;
    ids.set(p.epa_reg_no, row.id);
  }
  return ids;
}

export async function seedCatalog(sql: Sql, tenant: SeedTenant, tenantId: string, masterIds: Map<string, string>): Promise<void> {
  const states = [...new Set(tenant.branches.map((b) => b.stateCode))];

  for (const entry of SEED_SERVICE_TYPES) {
    const template = templateByKey(entry.template);
    if (!template) throw new Error(`unknown service type template ${entry.template}`);
    const serviceTypeId = await upsertServiceType(sql, tenantId, template);
    await ensureStateRules(sql, tenantId, serviceTypeId, states);
    for (const band of entry.prices) {
      await sql`
        insert into public.price_book_items (tenant_id, service_type_id, name, add_on, size_basis, size_min, size_max, initial_price_cents, recurring_price_cents, one_time_price_cents, position)
        select ${tenantId}, ${serviceTypeId}, ${band.name}, ${band.add_on ?? false}, ${band.size_basis ?? "none"}, ${band.size_min ?? 0}, ${band.size_max ?? null},
               ${band.initial}, ${band.recurring}, ${band.one_time ?? 0}, ${band.position}
        where not exists (
          select 1 from public.price_book_items p
          where p.tenant_id = ${tenantId} and p.service_type_id = ${serviceTypeId} and p.name = ${band.name}
            and p.size_basis = ${band.size_basis ?? "none"} and p.size_min = ${band.size_min ?? 0} and p.archived_at is null)`;
    }
  }

  // Enabled products with the tenant's unit and cost (cents per unit).
  const enabled: { epa: string; unit: string; cost: number }[] = [
    { epa: "7969-210", unit: "fl_oz", cost: 1150 },
    { epa: "100-1066", unit: "fl_oz", cost: 650 },
    { epa: "279-3206", unit: "fl_oz", cost: 190 },
    { epa: "100-1484", unit: "each", cost: 2900 },
    { epa: "12455-79", unit: "lb", cost: 450 },
  ];
  for (const e of enabled) {
    const productId = masterIds.get(e.epa);
    if (!productId) continue;
    await sql`
      insert into public.tenant_products (tenant_id, product_id, enabled, unit, unit_cost_cents)
      values (${tenantId}, ${productId}, true, ${e.unit}, ${e.cost})
      on conflict (tenant_id, product_id) do nothing`;
  }

  // A product this tenant added that the platform has not approved yet (a 25(b) minimum-risk botanical).
  const [privateProduct] = await sql<{ id: string }[]>`
    insert into public.products (tenant_id, name, manufacturer, epa_reg_no, active_ingredients, signal_word, restricted_use, formulation, label_rates)
    select ${tenantId}, 'Essentria IC3', 'Zoecon', ${EPA_EXEMPT}, ${["rosemary oil 10%", "geraniol 5%", "peppermint oil 2%"]}, 'caution', false, 'Emulsifiable concentrate', '[]'::jsonb
    where not exists (select 1 from public.products where tenant_id = ${tenantId} and name = 'Essentria IC3')
    returning id`;
  const privateId = privateProduct?.id ?? (await sql<{ id: string }[]>`select id from public.products where tenant_id = ${tenantId} and name = 'Essentria IC3'`)[0].id;
  await sql`
    insert into public.tenant_products (tenant_id, product_id, enabled, unit, unit_cost_cents)
    values (${tenantId}, ${privateId}, true, 'fl_oz', 95)
    on conflict (tenant_id, product_id) do nothing`;
}
