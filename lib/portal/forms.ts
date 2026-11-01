import "server-only";
// The public booking form (spec 16 rule 8): its definition for the hosted page and the intake itself, both as an
// anonymous visitor through the definer functions granted to anon.
import { headers } from "next/headers";
import { withAnon } from "@/lib/db";
import { todayInZone } from "@/lib/dates";
import { normalizeAddress } from "@/lib/geo/normalize";
import { HONEYPOT, type IntakePayload, intakeProblems, ipHash, readIntake } from "./intake";

export type PublicForm = { tenant_name: string; timezone: string; name: string; ask_preferred_date: boolean; thank_you: string | null; services: { id: string; name: string }[] };

export async function publicForm(key: string): Promise<PublicForm | null> {
  if (!/^[0-9a-f-]{36}$/i.test(key)) return null;
  const [row] = await withAnon((tx) => tx<PublicForm[]>`select * from app.lead_form(${key}::uuid)`);
  return row ?? null;
}

export type IntakeOutcome = { ok: true; lead_id: string | null } | { ok: false; status: number; errors: string[] };

/** Validates and records one submission; a filled honeypot is accepted quietly and dropped. */
export async function submitIntake(key: string, body: Record<string, unknown>): Promise<IntakeOutcome> {
  const form = await publicForm(key);
  if (!form) return { ok: false, status: 404, errors: ["This form is not taking requests."] };
  if (typeof body[HONEYPOT] === "string" && (body[HONEYPOT] as string).trim() !== "") return { ok: true, lead_id: null };
  const payload: IntakePayload = readIntake(body);
  const problems = intakeProblems(payload, form, todayInZone(form.timezone));
  if (problems.length) return { ok: false, status: 422, errors: problems };
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  const hash = await ipHash(ip, process.env.INTAKE_SALT ?? process.env.SUPABASE_JWT_SECRET ?? "bugsy-intake");
  // A friend's referral link (spec 17 rule 10) carries the referrer's code; the lead names them in the same transaction.
  const ref = typeof body.ref === "string" && /^[A-Za-z0-9]{4,16}$/.test(body.ref) ? body.ref.toUpperCase() : null;
  const result = await withAnon(async (tx) => {
    const [{ r }] = await tx<{ r: { ok: boolean; status: number; error?: string; lead_id?: string } }[]>`
      select app.intake_lead(${key}::uuid, ${tx.json(payload)}, ${hash}) as r`;
    if (r.ok && r.lead_id && payload.line1 && payload.city && payload.state_code && payload.postal_code) {
      const normalized = normalizeAddress({ line1: payload.line1, city: payload.city, stateCode: payload.state_code, postalCode: payload.postal_code });
      await tx`select app.intake_address(${r.lead_id}::uuid, ${normalized})`;
    }
    if (r.ok && r.lead_id && ref) await tx`select app.intake_referral(${r.lead_id}::uuid, ${ref})`;
    return r;
  });
  if (result.ok) return { ok: true, lead_id: result.lead_id ?? null };
  if (result.status === 429) return { ok: false, status: 429, errors: ["Too many requests from here; try again later."] };
  const message = result.error ? result.error.charAt(0).toUpperCase() + result.error.slice(1) + "." : "That could not be sent.";
  return { ok: false, status: [400, 404, 422].includes(result.status) ? result.status : 422, errors: [message] };
}
