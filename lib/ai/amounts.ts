// Unusual amounts (spec 21 rule 5), pure: an application above the label's maximum, or more than three times what the
// company usually uses for the same product, site and unit. A flag for a licensed manager; it changes nothing.

export type AmountRow = { id: string; product_id: string; product_name: string; site: string; unit: string; amount: number; over_label: boolean; applied_at: string };
export type AmountFlag = AmountRow & { reason: "over_label" | "unusual"; median: number | null };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** `history` is the company's applications over the last 180 days; `recent` the ones to review. */
export function unusualAmounts(history: readonly AmountRow[], recent: readonly AmountRow[], factor = 3, minSamples = 5): AmountFlag[] {
  const groups = new Map<string, number[]>();
  for (const h of history) {
    const k = `${h.product_id}|${h.site}|${h.unit}`;
    groups.set(k, [...(groups.get(k) ?? []), h.amount]);
  }
  const out: AmountFlag[] = [];
  for (const r of recent) {
    const xs = groups.get(`${r.product_id}|${r.site}|${r.unit}`) ?? [];
    const m = xs.length >= minSamples ? median(xs) : null;
    if (r.over_label) out.push({ ...r, reason: "over_label", median: m });
    else if (m !== null && m > 0 && r.amount > factor * m) out.push({ ...r, reason: "unusual", median: m });
  }
  return out.sort((a, b) => b.applied_at.localeCompare(a.applied_at));
}
