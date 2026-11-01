// The rule pack console's view of the packs (spec 13 rule 12), pure: each pack's rules with their sources, and which
// served states have no pack. Packs themselves stay code in lib/compliance/rules/ (pesticide-compliance skill).
import type { RuleValue, StatePack } from "@/lib/compliance/rules";

export type PackRule = { key: string; value: string; source: string; effectiveOn: string };
export type Coverage = { state_code: string; companies: number; properties: number; pack: { version: string; effectiveOn: string } | null };

export function packRules(pack: StatePack): PackRule[] {
  return Object.entries(pack.rules)
    .filter((e): e is [string, RuleValue<unknown>] => Boolean(e[1]))
    .map(([key, r]) => ({ key, value: JSON.stringify(r.value), source: r.source, effectiveOn: r.effectiveOn }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function coverage(served: readonly { state_code: string; companies: number; properties: number }[], packs: Readonly<Record<string, StatePack>>): Coverage[] {
  return served.map((s) => {
    const p = packs[s.state_code];
    return { ...s, pack: p ? { version: p.version, effectiveOn: p.effectiveOn } : null };
  });
}
