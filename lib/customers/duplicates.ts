import { normalizeEmail, phoneDigits } from "@/lib/geo/normalize";

export type DuplicateProbe = {
  normalizedAddress?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type DuplicateCandidate = {
  kind: "account" | "property" | "contact" | "lead";
  id: string;
  label: string;
  normalizedAddress?: string | null;
  phoneDigits?: string | null;
  email?: string | null;
};

export type DuplicateMatch = DuplicateCandidate & { matchedOn: ("address" | "phone" | "email")[] };

export type DuplicateSummary = Pick<DuplicateMatch, "kind" | "id" | "label" | "matchedOn">;

/** State returned by create actions that use useActionState: an error, duplicates to confirm, and the typed values. */
export type FormState = {
  error?: string | null;
  duplicates?: DuplicateSummary[];
  values?: Record<string, string>;
};

export const EMPTY_FORM_STATE: FormState = {};

/** Pure matching used by the actions and the unit tests: same normalized address, phone digits or email. */
export function matchDuplicates(candidates: readonly DuplicateCandidate[], probe: DuplicateProbe): DuplicateMatch[] {
  const address = probe.normalizedAddress?.trim() || null;
  const phone = phoneDigits(probe.phone);
  const email = normalizeEmail(probe.email);
  const matches: DuplicateMatch[] = [];
  for (const c of candidates) {
    const matchedOn: DuplicateMatch["matchedOn"] = [];
    if (address && c.normalizedAddress && c.normalizedAddress === address) matchedOn.push("address");
    if (phone && c.phoneDigits && c.phoneDigits === phone) matchedOn.push("phone");
    if (email && c.email && c.email === email) matchedOn.push("email");
    if (matchedOn.length) matches.push({ ...c, matchedOn });
  }
  return matches;
}

/** Encodes matches for a redirect query string so the form can show them. */
export function encodeMatches(matches: DuplicateMatch[]): string {
  return encodeURIComponent(JSON.stringify(matches.map((m) => ({ kind: m.kind, id: m.id, label: m.label, matchedOn: m.matchedOn }))));
}

export function decodeMatches(value: string | undefined): Pick<DuplicateMatch, "kind" | "id" | "label" | "matchedOn">[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as unknown;
    return Array.isArray(parsed) ? (parsed as Pick<DuplicateMatch, "kind" | "id" | "label" | "matchedOn">[]) : [];
  } catch {
    return [];
  }
}
