// Job costing's query (spec 18 rule 8): completed visits in a range with their price, the product they used and each
// crew member's labor rate on the day, under the reader's row level security.
import type postgres from "postgres";
import { productCostCents } from "@/lib/ledger/post";
import { dateInZone, fromTenantLocal, addDays } from "@/lib/dates";
import { type JobCost, jobCost } from "./jobs";

type Sql = postgres.Sql | postgres.TransactionSql;

export async function jobCosts(tx: Sql, tenantId: string, from: string, to: string, timeZone: string): Promise<JobCost[]> {
  const start = fromTenantLocal(`${from}T00:00`, timeZone) as Date;
  const end = fromTenantLocal(`${addDays(to, 1)}T00:00`, timeZone) as Date;
  const visits = await tx<{
    id: string;
    completed_at: Date;
    account_id: string;
    account_name: string;
    technician_id: string | null;
    technician_name: string | null;
    service_line: string;
    service_name: string;
    price_cents: string;
    arrived_at: Date | null;
    departed_at: Date | null;
    crew: string[];
  }[]>`
    select v.id, v.completed_at, v.account_id, a.name as account_name, v.technician_id, m.display_name as technician_name, st.service_line, st.name as service_name,
           v.price_cents, v.arrived_at, v.departed_at,
           coalesce((select array_agg(c.user_id) from public.visit_crew c where c.visit_id = v.id), '{}') as crew
    from public.visits v join public.accounts a on a.id = v.account_id join public.service_types st on st.id = v.service_type_id
      left join public.memberships m on m.tenant_id = v.tenant_id and m.user_id = v.technician_id
    where v.tenant_id = ${tenantId} and v.status = 'completed' and not v.imported and v.completed_at >= ${start} and v.completed_at < ${end}
    order by v.completed_at`;
  if (visits.length === 0) return [];
  const ids = visits.map((v) => v.id);
  const usage = await tx<{ visit_id: string; amount: string; amount_unit: string; unit: string | null; unit_cost_cents: string | null; moved_value: string | null }[]>`
    select vp.visit_id, vp.amount::text, vp.amount_unit, tp.unit, tp.unit_cost_cents::text,
           (select m.value_cents::text from public.stock_movements m where m.visit_product_id = vp.id and m.unit_cost_cents > 0) as moved_value
    from public.visit_products vp left join public.tenant_products tp on tp.tenant_id = vp.tenant_id and tp.product_id = vp.product_id
    where vp.visit_id = any(${ids}::uuid[])`;
  const product = new Map<string, { cents: number; unpriced: number }>();
  for (const u of usage) {
    const p = product.get(u.visit_id) ?? { cents: 0, unpriced: 0 };
    // What came off the shelves is the cost; usage from before tracking is valued at today's cost, or left unpriced.
    if (u.moved_value !== null) p.cents += Number(u.moved_value);
    else {
      const cost = u.unit && u.unit_cost_cents !== null && Number(u.unit_cost_cents) > 0 ? productCostCents({ quantity: u.amount, usage_unit: u.amount_unit, unit_cost_cents: Number(u.unit_cost_cents), cost_unit: u.unit }) : null;
      if (cost === null) p.unpriced += 1;
      else p.cents += cost;
    }
    product.set(u.visit_id, p);
  }
  const rates = await tx<{ user_id: string; effective_from: string; cents_per_hour: string | null }[]>`
    select user_id, effective_from::text, cents_per_hour::text from app.labor_costs(${tenantId}) order by effective_from desc`;
  const names = new Map((await tx<{ user_id: string; name: string | null }[]>`select user_id, display_name as name from public.memberships where tenant_id = ${tenantId}`).map((r) => [r.user_id, r.name ?? "Member"]));
  const rateOn = (user: string, day: string) => {
    const r = rates.find((x) => x.user_id === user && x.effective_from <= day);
    return r && r.cents_per_hour !== null ? Number(r.cents_per_hour) : null;
  };
  return visits.map((v) => {
    const day = dateInZone(v.completed_at, timeZone);
    const people = [...new Set([...(v.technician_id ? [v.technician_id] : []), ...v.crew])];
    const p = product.get(v.id) ?? { cents: 0, unpriced: 0 };
    return jobCost({
      visit_id: v.id,
      completed_on: day,
      account_id: v.account_id,
      account_name: v.account_name,
      technician_id: v.technician_id,
      technician_name: v.technician_name ?? (v.technician_id ? (names.get(v.technician_id) ?? "Member") : "No technician"),
      service_line: v.service_line,
      service_name: v.service_name,
      revenue_cents: Number(v.price_cents),
      product_cost_cents: p.cents,
      unpriced_products: p.unpriced,
      arrived_at: v.arrived_at,
      departed_at: v.departed_at,
      crew: people.map((u) => ({ user_id: u, name: names.get(u) ?? "Member", cost_cents_per_hour: rateOn(u, day) })),
    });
  });
}
