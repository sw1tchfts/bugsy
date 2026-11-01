// Spec 20 seed: an API key with its recent calls, a webhook subscription (off, so no job delivers to a made-up host)
// with a delivery, a call logged on an account, and for the second company a connected local QuickBooks with every
// account mapped, a sent day and a day that waits, plus a phone connection. Idempotent.
import { createHash } from "node:crypto";
import type postgres from "postgres";
import { hashKey } from "../lib/api/keys";
import { addDays, todayInZone } from "../lib/dates";
import { seal } from "../lib/integrations/crypto";
import type { SeedTenant } from "./seed-data";

type Sql = postgres.Sql;

/** A development key per company, derived from its name so docs and manual tests can use it (never in production). */
export function devApiKey(tenantName: string): string {
  const h = createHash("sha256").update(`bugsy-dev-key:${tenantName}`).digest("hex");
  return `bgy_${h.slice(0, 8)}_${Buffer.from(h.slice(8, 56), "hex").toString("base64url")}`;
}

export async function seedIntegrations(sql: Sql, tenant: SeedTenant, tenantId: string, index: number): Promise<void> {
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from public.api_keys where tenant_id = ${tenantId}`;
  if (n) return;
  const [owner] = await sql<{ user_id: string }[]>`
    select m.user_id from public.memberships m join public.roles r on r.id = m.role_id where m.tenant_id = ${tenantId} and r.key = 'owner' order by m.created_at limit 1`;
  const key = devApiKey(tenant.name);
  const [k] = await sql<{ id: string }[]>`
    insert into public.api_keys (tenant_id, name, prefix, key_hash, scopes, created_by, last_used_at, created_at)
    values (${tenantId}, 'Website booking form', ${key.slice(4, 12)}, ${hashKey(key)}, ${["leads.write", "requests.write", "availability.read"]}, ${owner?.user_id ?? null},
            now() - interval '2 hours', now() - interval '20 days')
    returning id`;
  await sql`
    insert into public.api_requests (tenant_id, api_key_id, method, path, status, at)
    values (${tenantId}, ${k.id}, 'GET', '/api/v1/availability', 200, now() - interval '2 hours 1 minute'),
           (${tenantId}, ${k.id}, 'POST', '/api/v1/leads', 201, now() - interval '2 hours')`;
  const [sub] = await sql<{ id: string }[]>`
    insert into public.webhook_subscriptions (tenant_id, url, events, secret, active, created_by)
    values (${tenantId}, 'https://hooks.example.com/bugsy', ${["lead.created"]}, ${`whsec_${createHash("sha256").update(`hook:${tenant.name}`).digest("hex").slice(0, 48)}`}, false, ${owner?.user_id ?? null})
    returning id`;
  await sql`
    insert into public.webhook_deliveries (tenant_id, subscription_id, event, payload, attempt, status, response_status, response_body, next_at, delivered_at, created_at)
    values (${tenantId}, ${sub.id}, 'lead.created', ${sql.json({ event: "lead.created", id: crypto.randomUUID(), created_at: new Date().toISOString(), data: { lead_id: null, source: "Website" } })},
            1, 'delivered', 200, 'ok', now() - interval '3 days', now() - interval '3 days', now() - interval '3 days')`;
  // A call last week from an account's own number.
  const [account] = await sql<{ id: string; phone: string | null }[]>`
    select id, phone from public.accounts where tenant_id = ${tenantId} and phone is not null and archived_at is null order by created_at limit 1`;
  if (account?.phone) {
    await sql`
      insert into public.calls (tenant_id, direction, from_number, to_number, account_id, started_at, duration_seconds, provider_call_id, notes)
      values (${tenantId}, 'inbound', ${account.phone}, ${tenant.branches[0]?.address ? "+15555550100" : ""}, ${account.id}, now() - interval '6 days', 184, 'seed-call-1', 'Asked about the next visit.')`;
  }
  if (index === 0) return;
  // The second company keeps its books in QuickBooks (the local test company) and has its phone system connected.
  const today = todayInZone(tenant.timezone);
  await sql`
    insert into public.integration_connections (tenant_id, provider, status, settings, tokens, connected_by, connected_at)
    values (${tenantId}, 'quickbooks', 'connected', ${sql.json({ realm_id: "local-realm", provider: "local" })},
            ${seal({ access_token: "local", refresh_token: "local", expires_at: Date.now() - 1, realm_id: "local-realm" })}, ${owner?.user_id ?? null}, now() - interval '10 days'),
           (${tenantId}, 'phone', 'connected', ${sql.json({ provider: "Office VoIP", call_number: "+15555550100" })}, null, ${owner?.user_id ?? null}, now() - interval '10 days')`;
  const accounts = await sql<{ id: string; type: string; subtype: string }[]>`select id, type, subtype from public.gl_accounts where tenant_id = ${tenantId} and active`;
  const bySubtype: Record<string, [string, string]> = {
    bank: ["10", "Checking"], clearing: ["11", "Undeposited Funds"], receivable: ["12", "Accounts Receivable (A/R)"], contract_asset: ["13", "Unbilled Receivables"],
    inventory: ["14", "Inventory Asset"], payable: ["20", "Accounts Payable (A/P)"], contract_liability: ["21", "Deferred Revenue"], tax_payable: ["22", "Sales Tax Payable"],
  };
  const byType: Record<string, [string, string]> = { asset: ["11", "Undeposited Funds"], liability: ["23", "Payroll Liabilities"], equity: ["31", "Retained Earnings"], revenue: ["40", "Services"], expense: ["50", "Cost of Goods Sold"] };
  for (const a of accounts) {
    const [id, name] = bySubtype[a.subtype] ?? byType[a.type] ?? ["50", "Cost of Goods Sold"];
    await sql`insert into public.quickbooks_account_map (tenant_id, gl_account_id, qbo_account_id, qbo_account_name) values (${tenantId}, ${a.id}, ${id}, ${name}) on conflict do nothing`;
  }
  await sql`
    insert into public.quickbooks_syncs (tenant_id, day, status, qbo_entry_id, lines, attempts, sent_at, error)
    values (${tenantId}, ${addDays(today, -3)}, 'sent', ${`local-${addDays(today, -3)}`}, ${sql.json([{ qbo_account_id: "12", qbo_account_name: "Accounts Receivable (A/R)", posting: "Debit", amount_cents: 0 }])}, 1, now() - interval '2 days', null),
           (${tenantId}, ${addDays(today, -2)}, 'failed', null, '[]'::jsonb, 1, null, 'QuickBooks did not answer; it is sent again on the next run.')
    on conflict (tenant_id, day) do nothing`;
}
