// State rule pack registry. Each state's pesticide rules live as data in lib/compliance/rules/<state>.ts and are applied
// for the state of the property being treated. Product code reads rule values only from packs; nothing is hardcoded
// elsewhere. No state is researched yet, so PACKS is empty: every lookup answers "no pack" and the product applies the
// conservative default from the pesticide-compliance skill until a state is added per that skill's steps.

import type { JobKind, ServiceLine, TreatmentArea } from "@/lib/catalog/service-lines";

/** Every rule value carries where it came from and when it took effect. */
export type RuleValue<T> = { value: T; source: string; effectiveOn: string };

export type Taxability = "taxable" | "exempt";

/**
 * The keys a pack may define, from the pesticide-compliance skill's starter list. Spec 03 reads the certification and
 * tax keys; later specs type their own keys here as they land. A key a state does not define means the rule does not
 * apply there; a value a state has not confirmed is left out, never guessed.
 */
/** A month-day range such as a bat exclusion blackout; `from` after `to` wraps the year end. */
export type MonthDayRange = { from: string; to: string };

export type StateRules = {
  "certification.categoriesByServiceLine"?: RuleValue<Partial<Record<ServiceLine, string[]>>>;
  "tax.taxabilityByServiceLine"?: RuleValue<Partial<Record<ServiceLine, Taxability>>>;
  "tax.taxabilityByTreatmentArea"?: RuleValue<Partial<Record<TreatmentArea, Taxability>>>;
  /** Days a registered trainee may work before certification. */
  "trainee.maxDays"?: RuleValue<number>;
  /** on_site: the supervising applicator is on the crew; available: reachable, not necessarily present. */
  "trainee.supervision"?: RuleValue<"on_site" | "available">;
  /** Which work needs advance notice to registry addresses. */
  "registry.triggers"?: RuleValue<{ treatmentAreas?: TreatmentArea[]; jobKinds?: JobKind[] }>;
  "registry.advanceNoticeHours"?: RuleValue<number>;
  [key: string]: RuleValue<unknown> | undefined;
};

/** The blackout ranges a pack defines for a job kind (`blackout.<jobKind>`), or none. */
export function blackoutRanges(pack: StatePack | undefined, jobKind: JobKind): MonthDayRange[] {
  const rule = pack?.rules[`blackout.${jobKind}`];
  const value = rule?.value;
  return Array.isArray(value) ? (value as MonthDayRange[]) : [];
}

export type StatePack = {
  /** Two-letter state code. */
  stateCode: string;
  /** Pack version, stored on every rule row and locked record that was checked against it. */
  version: string;
  effectiveOn: string;
  rules: StateRules;
};

/** Researched state packs, keyed by state code. Empty until a state is added. */
export const PACKS: Readonly<Record<string, StatePack>> = {};

export function getStatePack(stateCode: string, packs: Readonly<Record<string, StatePack>> = PACKS): StatePack | undefined {
  return packs[stateCode.trim().toUpperCase()];
}
