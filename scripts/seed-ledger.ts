// Spec 09 seed: the chart of accounts, every billing event posted (the billing seed's job runs already post them), the
// local gateway's payouts, and the months before last closed so the isolation suite has period rows and the ledger
// pages show a close. Idempotent. Called from seed.ts after the billing seed.
import type postgres from "postgres";
import { addDays, todayInZone } from "../lib/dates";
import { closePeriod, ensureChart, localPayouts, runLedger } from "../lib/ledger/db";
import { lastEndedPeriod, periodsBetween, prevPeriod } from "../lib/ledger/periods";
import type { SeedTenant } from "./seed-data";

type Sql = postgres.Sql;

export async function seedLedger(sql: Sql, tenant: SeedTenant, tenantId: string): Promise<void> {
  const today = todayInZone(tenant.timezone);
  await ensureChart(sql, tenantId);
  const [settings] = await sql<{ gateway: string }[]>`select gateway from public.billing_settings where tenant_id = ${tenantId}`;
  await runLedger(sql, tenantId, tenant.timezone, today, settings?.gateway ?? "local");
  // The seed's own card charges settle today rather than tomorrow, so a payout exists from the first run.
  await localPayouts(sql, tenantId, settings?.gateway ?? "local", today, tenant.timezone, addDays(today, 1));

  // Every month before last is closed; last month stays open for the bookkeeper to close.
  const [first] = await sql<{ period: string | null }[]>`select min(period) as period from public.journal_entries where tenant_id = ${tenantId}`;
  const through = prevPeriod(lastEndedPeriod(today));
  if (first?.period && first.period <= through) {
    const closed = new Set((await sql<{ period: string }[]>`select period from public.period_closes where tenant_id = ${tenantId} and status = 'closed'`).map((r) => r.period));
    for (const period of periodsBetween(first.period, through)) {
      if (!closed.has(period)) await closePeriod(sql, tenantId, period, today);
    }
  }
}
