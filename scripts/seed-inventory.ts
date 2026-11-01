// Spec 18 seed: per company, a warehouse per branch and a truck per technician with product received and loaded, the
// usage of stops completed since tracking began, a weekly pay period, pay for everyone, two weeks of clocked time,
// and the period before last exported and its payroll posted (last week's is left for the office to export). Idempotent.
import type postgres from "postgres";
import { addDays, fromTenantLocal, todayInZone } from "../lib/dates";
import { receiveStock, recordUsage, transferStock } from "../lib/inventory/db";
import { exportPeriod, postPayroll } from "../lib/payroll/db";
import { lastClosedPeriod, periodFor } from "../lib/payroll/periods";
import type { SeedTenant } from "./seed-data";

type Sql = postgres.Sql;

const ANCHOR = "2026-10-05"; // a Monday

export async function seedInventory(sql: Sql, tenant: SeedTenant, tenantId: string): Promise<void> {
  const tz = tenant.timezone;
  const today = todayInZone(tz);
  await sql`insert into public.inventory_settings (tenant_id, tracking_since) values (${tenantId}, ${addDays(today, -45)}) on conflict (tenant_id) do nothing`;

  const [{ n: haveLocations }] = await sql<{ n: number }[]>`select count(*)::int as n from public.stock_locations where tenant_id = ${tenantId}`;
  if (!haveLocations) {
    const branches = await sql<{ id: string; name: string }[]>`select id, name from public.branches where tenant_id = ${tenantId} and archived_at is null order by created_at`;
    for (const b of branches) await sql`insert into public.stock_locations (tenant_id, branch_id, kind, name) values (${tenantId}, ${b.id}, 'warehouse', ${`${b.name} warehouse`})`;
    const techs = await sql<{ user_id: string; name: string | null }[]>`
      select m.user_id, m.display_name as name from public.memberships m join public.roles r on r.id = m.role_id where m.tenant_id = ${tenantId} and r.key = 'technician' order by m.created_at`;
    for (const t of techs) await sql`insert into public.stock_locations (tenant_id, branch_id, kind, name, user_id) values (${tenantId}, ${branches[0].id}, 'truck', ${`Truck: ${t.name ?? "Technician"}`}, ${t.user_id})`;
  }
  const [warehouse] = await sql<{ id: string }[]>`select id from public.stock_locations where tenant_id = ${tenantId} and kind = 'warehouse' order by created_at limit 1`;
  const trucks = await sql<{ id: string }[]>`select id from public.stock_locations where tenant_id = ${tenantId} and kind = 'truck' order by created_at`;
  const [{ n: moved }] = await sql<{ n: number }[]>`select count(*)::int as n from public.stock_movements where tenant_id = ${tenantId} and kind = 'receipt'`;
  if (!moved && warehouse) {
    const products = await sql<{ product_id: string; unit_cost_cents: string; unit: string }[]>`
      select product_id, unit_cost_cents, unit from public.tenant_products where tenant_id = ${tenantId} and enabled order by product_id`;
    for (const [i, p] of products.entries()) {
      const cost = Number(p.unit_cost_cents) || 2500;
      await receiveStock(sql, tenantId, { product_id: p.product_id, location_id: warehouse.id, quantity: 12, unit_cost_cents: cost, vendor: "Univar Solutions", reference: `PS-${4100 + i}`, paid: "on_account", note: null }, tz);
      for (const t of trucks) await transferStock(sql, tenantId, { product_id: p.product_id, from_location_id: warehouse.id, to_location_id: t.id, quantity: 3, note: "Monday load" });
      await sql`update public.tenant_products set truck_minimum = 1, warehouse_minimum = 4 where tenant_id = ${tenantId} and product_id = ${p.product_id}`;
    }
  }
  await recordUsage(sql, tenantId, null);

  await sql`insert into public.pay_settings (tenant_id, period, anchor_on) values (${tenantId}, 'weekly', ${ANCHOR}) on conflict (tenant_id) do nothing`;
  const people = await sql<{ user_id: string; role: string }[]>`
    select m.user_id, r.key as role from public.memberships m join public.roles r on r.id = m.role_id where m.tenant_id = ${tenantId} and r.tenant_id is null order by m.created_at`;
  for (const [i, p] of people.entries()) {
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from public.pay_rates where tenant_id = ${tenantId} and user_id = ${p.user_id}`;
    if (n) continue;
    if (p.role === "technician") {
      await sql`insert into public.pay_rates (tenant_id, user_id, kind, production_percent, draw_cents, labor_cost_cents_per_hour, effective_from)
                values (${tenantId}, ${p.user_id}, 'production', 22, 80000, 3200, '2026-01-01')`;
    } else if (p.role !== "owner") {
      const hourly = { office: 2150, dispatcher: 2300, sales_rep: 1800, compliance_manager: 3100, bookkeeper: 2800 }[p.role] ?? 2000;
      await sql`insert into public.pay_rates (tenant_id, user_id, kind, hourly_rate_cents, labor_cost_cents_per_hour, effective_from)
                values (${tenantId}, ${p.user_id}, 'hourly', ${hourly}, ${Math.round(hourly * 1.25)}, '2026-01-01')`;
    }
    await sql`update public.memberships set payroll_id = coalesce(payroll_id, ${`E-${1001 + i}`}) where tenant_id = ${tenantId} and user_id = ${p.user_id}`;
  }

  // Two weeks of weekday time for the technicians and the office, 7:30 to 4:00, today excepted.
  const [{ n: haveTime }] = await sql<{ n: number }[]>`select count(*)::int as n from public.time_entries where tenant_id = ${tenantId}`;
  if (!haveTime) {
    const workers = people.filter((p) => p.role === "technician" || p.role === "office");
    for (let d = addDays(today, -15); d < today; d = addDays(d, 1)) {
      const weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      for (const w of workers) {
        await sql`insert into public.time_entries (tenant_id, user_id, started_at, ended_at, source)
                  values (${tenantId}, ${w.user_id}, ${fromTenantLocal(`${d}T07:30`, tz)}, ${fromTenantLocal(`${d}T16:00`, tz)}, 'app')`;
      }
    }
  }

  // The period before last is exported and its payroll posted; last week's waits for the office.
  const settings = { period: "weekly" as const, anchor_on: ANCHOR };
  const last = lastClosedPeriod(settings, today);
  const before = periodFor(settings, addDays(last.starts_on, -1));
  const [done] = await sql<{ id: string }[]>`select id from public.pay_periods where tenant_id = ${tenantId} and starts_on = ${before.starts_on}`;
  if (!done) {
    const id = await exportPeriod(sql, tenantId, before, tz);
    const [lines] = await sql<{ pay: string; commissions: string }[]>`
      select coalesce(sum(pay_due_cents), 0)::text as pay, coalesce(sum(commissions_cents), 0)::text as commissions from public.pay_period_lines where pay_period_id = ${id}`;
    const gross = Number(lines.pay) + Number(lines.commissions);
    const withholdings = Math.round(gross * 0.22);
    await postPayroll(sql, tenantId, id, { gross_wages_cents: gross, employer_taxes_cents: Math.round(gross * 0.0765), withholdings_cents: withholdings, net_pay_cents: gross - withholdings, commissions_cents: Number(lines.commissions) }, tz);
  }
}
