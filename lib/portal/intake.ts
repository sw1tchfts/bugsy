// The public booking form's payload (spec 16 rule 8), pure: what a submission must carry before it reaches the
// database, which checks it again. A filled honeypot is dropped quietly by the caller.

export const HONEYPOT = "company_website";

export type IntakePayload = {
  name: string;
  email: string;
  phone: string;
  line1: string;
  city: string;
  state_code: string;
  postal_code: string;
  service_type_id: string;
  preferred_date: string;
  arrival_window: string;
  message: string;
  sms_consent: boolean;
};

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Reads a form or JSON body into the payload, trimming and capping every field. */
export function readIntake(body: Record<string, unknown>): IntakePayload {
  return {
    name: text(body.name, 200),
    email: text(body.email, 200).toLowerCase(),
    phone: text(body.phone, 40),
    line1: text(body.line1, 200),
    city: text(body.city, 100),
    state_code: text(body.state_code, 2).toUpperCase(),
    postal_code: text(body.postal_code, 10),
    service_type_id: text(body.service_type_id, 36),
    preferred_date: text(body.preferred_date, 10),
    arrival_window: text(body.arrival_window, 10) || "any",
    message: text(body.message, 2000),
    sms_consent: body.sms_consent === true || body.sms_consent === "on" || body.sms_consent === "true",
  };
}

export function intakeProblems(p: IntakePayload, form: { services: { id: string }[]; ask_preferred_date: boolean }, today: string): string[] {
  const problems: string[] = [];
  if (!p.name) problems.push("Your name is needed.");
  if (!p.email && !p.phone) problems.push("An email or a phone number is needed.");
  if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) problems.push("That email does not look right.");
  if (!p.line1) problems.push("The service address is needed.");
  if (p.state_code && !/^[A-Z]{2}$/.test(p.state_code)) problems.push("The state is its two-letter code.");
  if (form.services.length > 0 && !form.services.some((s) => s.id === p.service_type_id)) problems.push("Pick a service from the list.");
  if (form.ask_preferred_date && p.preferred_date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.preferred_date)) problems.push("Pick a preferred day.");
    else if (p.preferred_date < today) problems.push("The preferred day has passed.");
  }
  if (!["any", "morning", "afternoon", "evening"].includes(p.arrival_window)) problems.push("Pick a time of day.");
  return problems;
}

/** A one-way hash of the client address for rate limiting; the address itself is never stored. */
export async function ipHash(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
