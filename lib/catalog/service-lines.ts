// The catalog vocabulary: service lines, job kinds, treatment areas and the templates owners start from.
// State rule packs key their licensing, notice and blackout rules on these values, so they are stable identifiers.

export const SERVICE_LINES = ["general_pest", "rodent", "termite", "mosquito", "bed_bug", "wildlife"] as const;
export type ServiceLine = (typeof SERVICE_LINES)[number];

export const SERVICE_LINE_LABELS: Record<ServiceLine, string> = {
  general_pest: "General pest",
  rodent: "Rodent",
  termite: "Termite",
  mosquito: "Mosquito and tick",
  bed_bug: "Bed bug",
  wildlife: "Wildlife",
};

export const JOB_KINDS = [
  "recurring_treatment",
  "one_time_treatment",
  "inspection",
  "wdi_report",
  "device_service",
  "termite_treatment",
  "termite_monitoring",
  "bed_bug_treatment",
  "trapping",
  "exclusion",
  "bat_exclusion",
  "repair",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_KIND_LABELS: Record<JobKind, string> = {
  recurring_treatment: "Recurring treatment",
  one_time_treatment: "One-time treatment",
  inspection: "Inspection",
  wdi_report: "Wood-destroying insect report",
  device_service: "Device service",
  termite_treatment: "Termite treatment",
  termite_monitoring: "Termite monitoring",
  bed_bug_treatment: "Bed bug treatment",
  trapping: "Trapping",
  exclusion: "Exclusion",
  bat_exclusion: "Bat exclusion",
  repair: "Repair",
};

/** Job kinds that apply pesticide and therefore need at least one treatment area. Mirrors the database check. */
export const PESTICIDE_JOB_KINDS: readonly JobKind[] = [
  "recurring_treatment",
  "one_time_treatment",
  "device_service",
  "termite_treatment",
  "termite_monitoring",
  "bed_bug_treatment",
];

export const TREATMENT_AREAS = ["interior", "perimeter", "yard", "wood", "devices"] as const;
export type TreatmentArea = (typeof TREATMENT_AREAS)[number];

export const TREATMENT_AREA_LABELS: Record<TreatmentArea, string> = {
  interior: "Interior",
  perimeter: "Perimeter",
  yard: "Yard",
  wood: "Wood",
  devices: "Devices",
};

export const PRICING_METHODS = ["price_book", "bid"] as const;
export type PricingMethod = (typeof PRICING_METHODS)[number];

export const PRICING_METHOD_LABELS: Record<PricingMethod, string> = {
  price_book: "Price book",
  bid: "Bid from labor and materials",
};

/** True when the treatment areas satisfy the job kind: pesticide work needs at least one area. */
export function areasValidForKind(jobKind: JobKind, areas: readonly string[]): boolean {
  if (!areas.every((a) => (TREATMENT_AREAS as readonly string[]).includes(a))) return false;
  return !PESTICIDE_JOB_KINDS.includes(jobKind) || areas.length > 0;
}

export type ServiceTypeTemplate = {
  key: string;
  name: string;
  serviceLine: ServiceLine;
  jobKind: JobKind;
  treatmentAreas: TreatmentArea[];
  /** The device kinds a visit of this type checks (spec 14); none for most types. */
  deviceKinds?: string[];
  pricingMethod: PricingMethod;
  defaultDurationMinutes: number;
  description: string;
};

/** Common offerings an owner can start from. Prices and state rules are never part of a template. */
export const SERVICE_TYPE_TEMPLATES: readonly ServiceTypeTemplate[] = [
  {
    key: "general_pest_plan",
    name: "General pest plan",
    serviceLine: "general_pest",
    jobKind: "recurring_treatment",
    treatmentAreas: ["interior", "perimeter"],
    pricingMethod: "price_book",
    defaultDurationMinutes: 45,
    description: "Recurring interior and perimeter treatment with free re-services between visits.",
  },
  {
    key: "general_pest_one_time",
    name: "One-time pest treatment",
    serviceLine: "general_pest",
    jobKind: "one_time_treatment",
    treatmentAreas: ["interior", "perimeter"],
    pricingMethod: "price_book",
    defaultDurationMinutes: 60,
    description: "A single treatment for a current problem, no plan.",
  },
  {
    key: "rodent_program",
    name: "Rodent control program",
    serviceLine: "rodent",
    jobKind: "recurring_treatment",
    treatmentAreas: ["interior", "perimeter", "devices"],
    pricingMethod: "price_book",
    defaultDurationMinutes: 60,
    description: "Recurring rodent control with bait stations and traps checked each visit.",
  },
  {
    key: "commercial_device_service",
    name: "Commercial device service",
    serviceLine: "rodent",
    jobKind: "device_service",
    treatmentAreas: ["devices"],
    deviceKinds: ["bait_station", "rodent_trap", "multi_catch", "glue_board", "insect_light_trap"],
    pricingMethod: "price_book",
    defaultDurationMinutes: 90,
    description: "Scheduled service of barcoded stations and insect light traps at a commercial site.",
  },
  {
    key: "mosquito_tick_season",
    name: "Mosquito and tick season",
    serviceLine: "mosquito",
    jobKind: "recurring_treatment",
    treatmentAreas: ["yard"],
    pricingMethod: "price_book",
    defaultDurationMinutes: 30,
    description: "Yard treatments in numbered rounds across the season.",
  },
  {
    key: "termite_inspection",
    name: "Termite inspection",
    serviceLine: "termite",
    jobKind: "inspection",
    treatmentAreas: [],
    pricingMethod: "bid",
    defaultDurationMinutes: 60,
    description: "Inspection for termite activity and conducive conditions.",
  },
  {
    key: "wdi_report",
    name: "Wood-destroying insect report",
    serviceLine: "termite",
    jobKind: "wdi_report",
    treatmentAreas: [],
    pricingMethod: "bid",
    defaultDurationMinutes: 90,
    description: "Inspection report for a real estate transaction.",
  },
  {
    key: "termite_treatment",
    name: "Termite treatment",
    serviceLine: "termite",
    jobKind: "termite_treatment",
    treatmentAreas: ["perimeter", "wood"],
    pricingMethod: "bid",
    defaultDurationMinutes: 240,
    description: "Liquid or bait treatment of an active infestation, quoted from the inspection.",
  },
  {
    key: "termite_monitoring",
    name: "Termite monitoring",
    serviceLine: "termite",
    jobKind: "termite_monitoring",
    treatmentAreas: ["devices"],
    pricingMethod: "price_book",
    defaultDurationMinutes: 45,
    description: "Yearly warranty or bait station monitoring after a treatment.",
  },
  {
    key: "bed_bug_treatment",
    name: "Bed bug treatment",
    serviceLine: "bed_bug",
    jobKind: "bed_bug_treatment",
    treatmentAreas: ["interior"],
    pricingMethod: "bid",
    defaultDurationMinutes: 120,
    description: "Multi-visit treatment with a customer preparation checklist, quoted per job.",
  },
  {
    key: "wildlife_trapping",
    name: "Wildlife trapping",
    serviceLine: "wildlife",
    jobKind: "trapping",
    treatmentAreas: [],
    pricingMethod: "bid",
    defaultDurationMinutes: 60,
    description: "Trap set and checks for nuisance wildlife.",
  },
  {
    key: "exclusion",
    name: "Exclusion work",
    serviceLine: "wildlife",
    jobKind: "exclusion",
    treatmentAreas: [],
    pricingMethod: "bid",
    defaultDurationMinutes: 180,
    description: "Sealing entry points after removal.",
  },
  {
    key: "bat_exclusion",
    name: "Bat exclusion",
    serviceLine: "wildlife",
    jobKind: "bat_exclusion",
    treatmentAreas: [],
    pricingMethod: "bid",
    defaultDurationMinutes: 240,
    description: "One-way doors and sealing, subject to the state's seasonal blackout.",
  },
  {
    key: "repair",
    name: "Repair",
    serviceLine: "wildlife",
    jobKind: "repair",
    treatmentAreas: [],
    pricingMethod: "bid",
    defaultDurationMinutes: 120,
    description: "Repairs to damage from pests or wildlife.",
  },
];

export function templateByKey(key: string): ServiceTypeTemplate | undefined {
  return SERVICE_TYPE_TEMPLATES.find((t) => t.key === key);
}
