// Unusual amounts' database side (spec 21 rule 5): the company's last 180 days of applications as history, the last 30
// as the ones to review, flagged by the pure check. Read under the caller's session.
import type postgres from "postgres";
import { type AmountFlag, type AmountRow, unusualAmounts } from "./amounts";

type Sql = postgres.Sql | postgres.TransactionSql;

export type AmountReview = AmountFlag & { visit_id: string; address: string };

export async function amountsToReview(tx: Sql, tenantId: string): Promise<AmountReview[]> {
  const rows = await tx<(AmountRow & { visit_id: string; address: string; days: number })[]>`
    select vp.id, vp.product_id, p.name as product_name, vp.site_treated as site, vp.amount_unit as unit, vp.amount::float8 as amount,
           coalesce(vp.label_check ->> 'status', '') = 'above_label' as over_label, vp.recorded_at::text as applied_at,
           vp.visit_id, pr.normalized_address as address, (now()::date - vp.recorded_at::date) as days
    from public.visit_products vp join public.products p on p.id = vp.product_id join public.visits v on v.id = vp.visit_id
      join public.properties pr on pr.id = v.property_id
    where vp.tenant_id = ${tenantId} and vp.recorded_at > now() - interval '180 days'`;
  const recent = rows.filter((r) => r.days <= 30);
  const extra = new Map(rows.map((r) => [r.id, { visit_id: r.visit_id, address: r.address }]));
  return unusualAmounts(rows, recent).map((f) => ({ ...f, ...(extra.get(f.id) as { visit_id: string; address: string }) })).slice(0, 50);
}
