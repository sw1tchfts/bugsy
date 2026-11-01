// The portal assistant's context (spec 21 rule 7): the asking customer's own records, read under their portal session
// (row level security already limits it to their account), shaped as plain data for the model. Nothing else goes in:
// no staff notes, no other account, no internal prices.
import type postgres from "postgres";
import { todayInZone } from "@/lib/dates";
import { type Overview, overview, visitDetail } from "@/lib/portal/db";
import type { PortalIdentity } from "@/lib/portal/session";
import type { PortalContext } from "./types";

type Sql = postgres.Sql | postgres.TransactionSql;

type Plan = { id: string; service: string; address: string; price_cents: number | null; cadence: string | null };
type Applied = { visit_id: string; products: string[]; areas: string[] };

/** Pure: the overview, what was applied on recent visits, and the plans, as the model's context. */
export function buildContext(identity: Pick<PortalIdentity, "tenant_name" | "account_name" | "tenant_timezone">, o: Overview, applied: readonly Applied[], plans: readonly Plan[]): PortalContext {
  const usedOn = new Map(applied.map((a) => [a.visit_id, a]));
  return {
    today: todayInZone(identity.tenant_timezone),
    company: identity.tenant_name,
    customer: identity.account_name,
    properties: o.properties.map((p) => ({ id: p.id, address: p.address })),
    upcoming: o.upcoming.slice(0, 6).map((v) => ({ id: v.id, date: v.scheduled_for, status: v.scheduled_for ? "scheduled" : `due ${v.due_start} to ${v.due_end}`, service: v.service, address: v.address, window: v.arrival_window })),
    recent: o.recent.slice(0, 6).map((v) => ({
      id: v.id,
      date: v.completed_at ? new Date(v.completed_at).toISOString().slice(0, 10) : null,
      status: "completed",
      service: v.service,
      address: v.address,
      window: null,
      products: usedOn.get(v.id)?.products ?? [],
      areas: usedOn.get(v.id)?.areas ?? [],
    })),
    balance_cents: o.balance_cents,
    open_invoices: o.open.map((i) => ({ id: i.id, number: i.number, due_on: i.due_on, owed_cents: i.total_cents - i.paid_cents })),
    plans: [...plans],
    requests: o.requests.slice(0, 6).map((r) => ({ id: r.id, kind: r.kind, status: r.status, preferred_date: r.preferred_date })),
  };
}

export async function loadPortalContext(tx: Sql, identity: PortalIdentity): Promise<PortalContext> {
  const o = await overview(tx, identity);
  const applied: Applied[] = [];
  for (const v of o.recent.slice(0, 3)) {
    const d = await visitDetail(tx, identity, v.id);
    if (d?.record) applied.push({ visit_id: v.id, products: d.record.products.map((p) => p.product_name), areas: d.record.areas_treated.map((a) => a.replace(/_/g, " ")) });
  }
  const plans = await tx<Plan[]>`select id, service, address, price_cents, cadence from app.portal_plans(${identity.tenant_id})`;
  return buildContext(identity, o, applied, plans.map((p) => ({ ...p, price_cents: p.price_cents === null ? null : Number(p.price_cents) })));
}

/** Which of the context's record ids an answer may cite: anything else the model names is dropped. */
export function contextIds(c: PortalContext): Set<string> {
  return new Set([...c.properties.map((p) => p.id), ...c.upcoming.map((v) => v.id), ...c.recent.map((v) => v.id), ...c.open_invoices.map((i) => i.id), ...c.plans.map((p) => p.id), ...c.requests.map((r) => r.id)]);
}
