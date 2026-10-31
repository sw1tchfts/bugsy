import type { ServiceLine, TreatmentArea } from "@/lib/catalog/service-lines";
import { PACKS, type StatePack, getStatePack } from "@/lib/compliance/rules";

export type TaxClass = "taxable" | "exempt" | "unknown";

export type StateDefaults = {
  /** Certification categories the state requires for this service line; empty when unknown. */
  certCategories: string[];
  /** The resolved taxability for this service type in this state; unknown without a pack or a confirmed value. */
  taxClass: TaxClass;
  /** The pack version the defaults came from, or null when no pack covers the state. */
  packVersion: string | null;
};

const NO_PACK: StateDefaults = { certCategories: [], taxClass: "unknown", packVersion: null };

/**
 * What a state's rule pack says a service type needs there. Taxability by treatment area overrides taxability by
 * service line: when any treated area is taxable in that state the service is taxable (the conservative answer
 * where, for example, yard spraying is taxed as landscaping while structural work is not); when every mapped area is
 * exempt the service is exempt; otherwise the service line's answer stands.
 */
export function stateDefaults(
  stateCode: string,
  serviceLine: ServiceLine,
  treatmentAreas: readonly TreatmentArea[],
  packs: Readonly<Record<string, StatePack>> = PACKS,
): StateDefaults {
  const pack = getStatePack(stateCode, packs);
  if (!pack) return { ...NO_PACK, certCategories: [] };

  const certCategories = [...(pack.rules["certification.categoriesByServiceLine"]?.value[serviceLine] ?? [])].sort();
  const byLine = pack.rules["tax.taxabilityByServiceLine"]?.value[serviceLine];
  const byArea = pack.rules["tax.taxabilityByTreatmentArea"]?.value ?? {};
  const areaAnswers = treatmentAreas.map((a) => byArea[a]).filter((v): v is "taxable" | "exempt" => v !== undefined);

  let taxClass: TaxClass = byLine ?? "unknown";
  if (areaAnswers.includes("taxable")) taxClass = "taxable";
  else if (areaAnswers.length > 0 && areaAnswers.every((v) => v === "exempt")) taxClass = "exempt";

  return { certCategories, taxClass, packVersion: pack.version };
}
