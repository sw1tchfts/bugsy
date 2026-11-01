import { NextResponse } from "next/server";
import { runAi } from "@/lib/ai/db";
import type { SummaryInput } from "@/lib/ai/types";
import { can } from "@/lib/auth/permissions";
import { dbAs, getSession } from "@/lib/auth/session";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const strings = (v: unknown, max = 20) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 600)).slice(0, max) : []);

/**
 * Spec 21 rule 3: a draft of the customer's note from this stop's capture, for the technician to edit. Nothing is
 * saved here; the technician saves the note they want, and only that goes to the customer.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const { active } = await resolveActiveTenant(session);
  if (!active || !can(active.permissions, "visits.write")) return NextResponse.json({ error: "Your role does not allow that." }, { status: 403 });
  let body: { visit_id?: unknown; language?: unknown; capture?: Record<string, unknown> };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const visitId = typeof body.visit_id === "string" && UUID.test(body.visit_id) ? body.visit_id : null;
  if (!visitId) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const c = body.capture ?? {};
  const input = await dbAs(session, async (tx) => {
    const [v] = await tx<{ service: string; first_name: string | null }[]>`
      select st.name as service,
             (select split_part(ct.name, ' ', 1) from public.contacts ct
              where ct.tenant_id = v.tenant_id and ct.archived_at is null and ((ct.property_id = v.property_id and ct.role in ('primary', 'site_contact')) or (ct.account_id = v.account_id and ct.role = 'primary'))
              order by (ct.property_id = v.property_id) desc nulls last, ct.created_at limit 1) as first_name
      from public.visits v join public.service_types st on st.id = v.service_type_id
      where v.id = ${visitId} and v.tenant_id = ${active.tenantId}`;
    if (!v) return null;
    const input: SummaryInput = {
      service: v.service,
      customer_first_name: v.first_name,
      notes: strings(c.notes),
      conditions: strings(c.conditions),
      recommendations: strings(c.recommendations),
      areas: strings(c.areas),
      pests: strings(c.pests),
      products: strings(c.products),
      language: body.language === "es" ? "es" : "en",
    };
    return input;
  });
  if (!input) return NextResponse.json({ error: "That stop is not on your company's schedule." }, { status: 404 });
  // The model is asked outside the transaction; the call's place in the month was reserved first (rule 2).
  const outcome = await runAi((fn) => dbAs(session, fn), active.tenantId, "summary", visitId, (p) => p.draftSummary(input));
  return outcome.ok ? NextResponse.json({ text: outcome.value.text }) : NextResponse.json({ error: outcome.message });
}
