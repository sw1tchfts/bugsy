// Outgoing webhooks (spec 20 rules 5 and 6), pure: event names, payload shapes, the signature and the retry schedule.
import { createHmac, timingSafeEqual } from "node:crypto";

export const EVENTS = ["lead.created", "service_request.created", "visit.scheduled", "visit.completed", "invoice.paid"] as const;
export type EventName = (typeof EVENTS)[number];
export const EVENT_LABELS: Record<EventName, string> = {
  "lead.created": "A lead arrives",
  "service_request.created": "A customer asks for a visit",
  "visit.scheduled": "A visit is put on a day",
  "visit.completed": "A visit is done",
  "invoice.paid": "An invoice is paid",
};

/** The facts each event carries (rule 6): the database builds the payloads; tests hold it to this list. */
export const EVENT_FIELDS: Record<EventName, readonly string[]> = {
  "lead.created": ["lead_id", "name", "email", "phone", "source", "created_at"],
  "service_request.created": ["request_id", "account_id", "property_id", "kind", "preferred_date", "created_at"],
  "visit.scheduled": ["visit_id", "account_id", "property_id", "scheduled_for", "arrival_window", "technician"],
  "visit.completed": ["visit_id", "account_id", "property_id", "completed_at", "service_type"],
  "invoice.paid": ["invoice_id", "account_id", "number", "total_cents", "paid_at"],
};

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`, as the receiver checks it. */
export function sign(secret: string, body: string, at: Date = new Date()): string {
  const t = Math.floor(at.getTime() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex");
  return `t=${t},v1=${v1}`;
}

/** The receiver's check: the signature matches and is no older than the tolerance. */
export function verify(secret: string, body: string, header: string, now: Date = new Date(), toleranceSeconds = 300): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1 || Math.abs(now.getTime() / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parts.v1, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Rule 5: minutes after the first failure for each retry; after the last the delivery fails. */
export const RETRY_MINUTES = [1, 5, 30, 120, 720] as const;

export function nextAttempt(attempt: number, failedAt: Date): Date | null {
  const wait = RETRY_MINUTES[attempt - 1];
  return wait === undefined ? null : new Date(failedAt.getTime() + wait * 60_000);
}

export function validUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || (process.env.NODE_ENV !== "production" && u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname));
  } catch {
    return false;
  }
}
