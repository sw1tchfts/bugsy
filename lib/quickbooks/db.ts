// The QuickBooks daily sync (spec 20 rule 7), in the billing job: each day since the last one sent, summarized per
// mapped account and sent once; a day with an unmapped account waits and says which.
import type postgres from "postgres";
import { addDays, dateInZone, todayInZone } from "@/lib/dates";
import { open, seal } from "@/lib/integrations/crypto";
import { type QboTokens, quickBooks } from "./provider";
import { summarizeDay } from "./summary";

type Sql = postgres.Sql | postgres.TransactionSql;

export async function qboTokens(tx: Sql, tenantId: string): Promise<QboTokens | null> {
  const [s] = await tx<{ tokens: string | null }[]>`select tokens from app.connection_secrets(${tenantId}, 'quickbooks')`;
  return open<QboTokens>(s?.tokens ?? null);
}

/** Fresh tokens, refreshed when they are about to expire; a failed refresh marks the connection for reconnection. */
export async function liveTokens(tx: Sql, tenantId: string): Promise<QboTokens | null> {
  const t = await qboTokens(tx, tenantId);
  if (!t) return null;
  if (t.expires_at > Date.now() + 60_000) return t;
  try {
    const fresh = await quickBooks().refresh(t);
    await tx`select app.set_connection_tokens(${tenantId}, 'quickbooks', ${seal(fresh)}, 'connected')`;
    return fresh;
  } catch {
    await tx`select app.set_connection_tokens(${tenantId}, 'quickbooks', ${seal(t)}, 'needs_reconnect')`;
    return null;
  }
}

export type SyncResult = { sent: number; failed: number; waiting: string | null };

export async function syncQuickBooks(tx: Sql, tenantId: string, timeZone: string, onlyDay?: string): Promise<SyncResult> {
  const [c] = await tx<{ status: string; connected_at: Date }[]>`select status, connected_at from public.integration_connections where tenant_id = ${tenantId} and provider = 'quickbooks'`;
  if (!c || c.status !== "connected") return { sent: 0, failed: 0, waiting: c ? "QuickBooks needs to be connected again." : null };
  const tokens = await liveTokens(tx, tenantId);
  if (!tokens) return { sent: 0, failed: 0, waiting: "QuickBooks needs to be connected again." };
  const yesterday = addDays(todayInZone(timeZone), -1);
  const [last] = await tx<{ day: string | null }[]>`select max(day)::text as day from public.quickbooks_syncs where tenant_id = ${tenantId} and status = 'sent'`;
  const start = onlyDay ?? (last?.day ? addDays(last.day, 1) : dateInZone(c.connected_at, timeZone));
  const mapping = await tx<{ gl_account_id: string; qbo_account_id: string; qbo_account_name: string }[]>`
    select gl_account_id, qbo_account_id, qbo_account_name from public.quickbooks_account_map where tenant_id = ${tenantId}`;
  const out: SyncResult = { sent: 0, failed: 0, waiting: null };
  const provider = quickBooks();
  for (let day = start, n = 0; day <= (onlyDay ?? yesterday) && n < 31; day = addDays(day, 1), n += 1) {
    const [done] = await tx<{ status: string }[]>`select status from public.quickbooks_syncs where tenant_id = ${tenantId} and day = ${day}`;
    if (done?.status === "sent") continue;
    const lines = await tx<{ gl_account_id: string; account_name: string; debit_cents: string; credit_cents: string }[]>`
      select l.gl_account_id, a.name as account_name, sum(l.debit_cents)::text as debit_cents, sum(l.credit_cents)::text as credit_cents
      from public.journal_lines l join public.journal_entries e on e.id = l.entry_id join public.gl_accounts a on a.id = l.gl_account_id
      where l.tenant_id = ${tenantId} and e.posted_on = ${day} group by l.gl_account_id, a.name`;
    const summary = summarizeDay(lines.map((l) => ({ gl_account_id: l.gl_account_id, account_name: l.account_name, debit_cents: Number(l.debit_cents), credit_cents: Number(l.credit_cents) })), mapping);
    if (!summary.ok) {
      const error = `Map these accounts first: ${summary.unmapped.join(", ")}.`;
      await tx`insert into public.quickbooks_syncs (tenant_id, day, status, error) values (${tenantId}, ${day}, 'failed', ${error})
               on conflict (tenant_id, day) do update set status = 'failed', error = excluded.error, attempts = quickbooks_syncs.attempts + 1`;
      out.failed += 1;
      out.waiting = error;
      break;
    }
    if (summary.lines.length === 0) {
      await tx`insert into public.quickbooks_syncs (tenant_id, day, status, lines, sent_at) values (${tenantId}, ${day}, 'sent', '[]'::jsonb, now())
               on conflict (tenant_id, day) do update set status = 'sent', lines = '[]'::jsonb, error = null, sent_at = now()`;
      continue;
    }
    try {
      const id = await provider.createEntry(tokens, day, `Bugsy summary for ${day}`, summary.lines);
      await tx`insert into public.quickbooks_syncs (tenant_id, day, status, qbo_entry_id, lines, sent_at) values (${tenantId}, ${day}, 'sent', ${id}, ${tx.json(summary.lines)}, now())
               on conflict (tenant_id, day) do update set status = 'sent', qbo_entry_id = excluded.qbo_entry_id, lines = excluded.lines, error = null, sent_at = now(), attempts = quickbooks_syncs.attempts + 1`;
      out.sent += 1;
    } catch (err) {
      const error = (err as Error).message.slice(0, 300);
      await tx`insert into public.quickbooks_syncs (tenant_id, day, status, lines, error) values (${tenantId}, ${day}, 'failed', ${tx.json(summary.lines)}, ${error})
               on conflict (tenant_id, day) do update set status = 'failed', error = excluded.error, attempts = quickbooks_syncs.attempts + 1`;
      if ((err as { code?: string }).code === "QBO_AUTH") await tx`select app.set_connection_tokens(${tenantId}, 'quickbooks', ${seal(tokens)}, 'needs_reconnect')`;
      out.failed += 1;
      out.waiting = error;
      break;
    }
  }
  return out;
}
