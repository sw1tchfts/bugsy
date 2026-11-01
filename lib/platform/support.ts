// Support access (spec 13 rules 2 to 4), pure: what state a grant is in and what it lets its holder do. The database
// enforces the same in app.support_access, app.has_permission and the write guard; this is the app's copy for pages.
import { ALL_PERMISSIONS } from "@/lib/auth/permissions";

export const MAX_HOURS = 72;
export const DECIDE_WITHIN_DAYS = 7;
export const MIN_REASON = 10;

export type GrantAccess = "read" | "write";
export type GrantRow = { approved: boolean | null; requested_at: string | Date; expires_at: string | Date | null; revoked_at: string | Date | null };
export type GrantState = "pending" | "lapsed" | "live" | "expired" | "denied" | "revoked";

const ms = (v: string | Date) => (v instanceof Date ? v.getTime() : Date.parse(v));

export function grantState(g: GrantRow, now: Date): GrantState {
  if (g.revoked_at) return "revoked";
  if (g.approved === false) return "denied";
  if (g.approved === null) return ms(g.requested_at) > now.getTime() - DECIDE_WITHIN_DAYS * 86_400_000 ? "pending" : "lapsed";
  return g.expires_at && ms(g.expires_at) > now.getTime() ? "live" : "expired";
}

/** Rule 4: read grants every .read permission; write grants everything but people, settings and imports. Never "*". */
export function grantPermissions(access: GrantAccess): string[] {
  if (access === "read") return ALL_PERMISSIONS.filter((p) => p.endsWith(".read"));
  return ALL_PERMISSIONS.filter((p) => !["users.write", "settings.write", "data.import"].includes(p));
}

/** Problems with a request before it reaches the database; empty when it can be sent. */
export function checkRequest(input: { access: string; hours: number; reason: string }): string[] {
  const problems: string[] = [];
  if (input.access !== "read" && input.access !== "write") problems.push("Pick read or write access.");
  if (!Number.isInteger(input.hours) || input.hours < 1 || input.hours > MAX_HOURS) problems.push(`Ask for 1 to ${MAX_HOURS} hours.`);
  if (input.reason.trim().length < MIN_REASON) problems.push(`Say why in at least ${MIN_REASON} characters; the owner reads it.`);
  return problems;
}

export const STATE_LABELS: Record<GrantState, string> = { pending: "waiting for the owner", lapsed: "lapsed without an answer", live: "live", expired: "ended", denied: "denied", revoked: "ended early" };
