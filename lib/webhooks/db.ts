// Webhook delivery (spec 20 rule 5): what is due goes out signed, in order per subscription, from the messaging job.
import type postgres from "postgres";
import { nextAttempt, sign } from "./events";

type Sql = postgres.Sql | postgres.TransactionSql;

async function post(url: string, secret: string, body: string): Promise<{ status: number; text: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Bugsy-Webhooks/1", "bugsy-signature": sign(secret, body) },
      body,
      signal: AbortSignal.timeout(10_000),
      redirect: "manual",
    });
    return { status: res.status, text: (await res.text()).slice(0, 1024) };
  } catch (err) {
    return { status: 0, text: (err as Error).message.slice(0, 200) };
  }
}

export async function deliverWebhooks(tx: Sql, tenantId: string): Promise<{ delivered: number; failed: number }> {
  const due = await tx<{ id: string; url: string; secret: string; event: string; payload: unknown; attempt: number }[]>`select * from app.webhooks_due(${tenantId})`;
  let delivered = 0;
  let failed = 0;
  const blocked = new Set<string>();
  for (const d of due) {
    // In order per URL: one that failed holds the ones after it for the next run.
    if (blocked.has(d.url)) continue;
    const r = await post(d.url, d.secret, JSON.stringify(d.payload));
    const ok = r.status >= 200 && r.status < 300;
    const next = ok ? null : nextAttempt(d.attempt + 1, new Date());
    await tx`select app.webhook_result(${d.id}, ${r.status}, ${r.text}, ${next})`;
    if (ok) delivered += 1;
    else {
      failed += 1;
      blocked.add(d.url);
    }
  }
  return { delivered, failed };
}

/** A signed test ping to a subscription's URL, without queueing anything. */
export async function testWebhook(tx: Sql, tenantId: string, subscriptionId: string): Promise<{ status: number; text: string }> {
  const [s] = await tx<{ url: string; secret: string }[]>`
    select s.url, s.secret from app.webhook_subscription_secret(${tenantId}, ${subscriptionId}) s`;
  if (!s) return { status: 404, text: "no such subscription" };
  return post(s.url, s.secret, JSON.stringify({ event: "ping", id: crypto.randomUUID(), created_at: new Date().toISOString(), data: {} }));
}
