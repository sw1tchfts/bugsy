// Termite diagram marks (spec 15 rule 8), pure: the kinds and the tag each carries on the map, so a mark is read by its
// letter and label, never by color alone.

export const MARK_KINDS = ["damage", "evidence", "treated", "inaccessible", "moisture", "note"] as const;
export type MarkKind = (typeof MARK_KINDS)[number];

export const MARK_LABELS: Record<MarkKind, string> = {
  damage: "Damage",
  evidence: "Evidence (tubes, frass, wings)",
  treated: "Treated area",
  inaccessible: "Not accessible",
  moisture: "Moisture",
  note: "Note",
};

export const MARK_TAGS: Record<MarkKind, string> = { damage: "D", evidence: "E", treated: "T", inaccessible: "X", moisture: "M", note: "N" };

export function isMarkKind(v: unknown): v is MarkKind {
  return typeof v === "string" && (MARK_KINDS as readonly string[]).includes(v);
}
