// API keys (spec 20 rule 1), pure: `bgy_<prefix>_<secret>`, stored as a hash, carrying scopes.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SCOPES = ["accounts.read", "leads.write", "requests.write", "availability.read", "visits.read", "invoices.read", "devices.write"] as const;
export type Scope = (typeof SCOPES)[number];
export const SCOPE_LABELS: Record<Scope, string> = {
  "accounts.read": "Look up callers and accounts",
  "leads.write": "Create leads",
  "requests.write": "Send service requests",
  "availability.read": "Read open days",
  "visits.read": "Read visits",
  "invoices.read": "Read invoices",
  "devices.write": "Report smart trap events",
};

const KEY = /^bgy_([a-z0-9]{8})_([A-Za-z0-9_-]{32,64})$/;

export function newKey(): { key: string; prefix: string; hash: string } {
  const prefix = randomBytes(6).toString("hex").slice(0, 8);
  const secret = randomBytes(30).toString("base64url");
  const key = `bgy_${prefix}_${secret}`;
  return { key, prefix, hash: hashKey(key) };
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function parseKey(raw: string | null | undefined): { prefix: string; key: string } | null {
  const key = (raw ?? "").trim().replace(/^Bearer\s+/i, "");
  const m = KEY.exec(key);
  return m ? { prefix: m[1], key } : null;
}

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

export function hasScope(scopes: readonly string[], need: Scope): boolean {
  return scopes.includes(need);
}

export function cleanScopes(input: readonly string[]): Scope[] {
  return SCOPES.filter((s) => input.includes(s));
}
