// Materials used at a visit (spec 15 rule 5), pure: what a billable material line costs.

export type MaterialRow = { description: string; quantity: string | number; unit: string; unit_price_cents: number | string; billable: boolean };

/** Quantity (to three decimals) times the unit price, half up to the cent, without floating point drift. */
export function materialCents(quantity: string | number, unitPriceCents: number | string): number {
  const milli = Math.round(Number(quantity) * 1000);
  const price = Number(unitPriceCents);
  return Math.floor((milli * price + 500) / 1000);
}

export function materialLines(rows: readonly MaterialRow[]): { description: string; amount_cents: number }[] {
  return rows
    .filter((r) => r.billable && Number(r.unit_price_cents) > 0)
    .map((r) => ({ description: `${r.description} (${Number(r.quantity)} ${r.unit})`, amount_cents: materialCents(r.quantity, r.unit_price_cents) }))
    .filter((l) => l.amount_cents > 0);
}

export const DISPOSITIONS = ["relocated", "released_on_site", "euthanized", "transferred", "escaped", "dead_on_arrival"] as const;
export const RELATIONSHIPS = ["owner", "owner_agent", "tenant_with_consent", "property_manager"] as const;
export const WILDLIFE_JOB_KINDS = ["trapping", "exclusion", "bat_exclusion", "repair"] as const;

export const DISPOSITION_LABELS: Record<(typeof DISPOSITIONS)[number], string> = {
  relocated: "Relocated",
  released_on_site: "Released on site",
  euthanized: "Euthanized",
  transferred: "Transferred (rehabber, agency)",
  escaped: "Escaped",
  dead_on_arrival: "Dead in trap",
};
export const RELATIONSHIP_LABELS: Record<(typeof RELATIONSHIPS)[number], string> = {
  owner: "Owner",
  owner_agent: "Owner's agent",
  tenant_with_consent: "Tenant with the owner's consent",
  property_manager: "Property manager",
};
