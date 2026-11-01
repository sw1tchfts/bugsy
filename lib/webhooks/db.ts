// Webhook delivery (spec 20 rule 5): what is due goes out signed, in order per subscription, after the messaging job
// commits (its own transaction, a time budget per run), and only to public hosts.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type postgres from "postgres";
import { nextAttempt, sign } from "./events";

type Sql = postgres.Sql | postgres.TransactionSql;

/** Loopback, private, link-local, unique-local and other addresses a webhook must never reach (rule 5, review fix). */
export function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return privateAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") || v6.startsWith("ff");
}

type Resolver = (host: string) => Promise<string[]>;
const resolveAll: Resolver = async (host) => (await lookup(host, { all: true })).map((r) => r.address);

/**
 * Whether a URL may receive a delivery: https to a host that resolves only to public addresses; in development also
 * http to this machine (the local receiver the tests run).
 */
export async function deliverable(url: string, resolve: Resolver = resolveAll, production = process.env.NODE_ENV === "production"): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const local = ["localhost", "127.0.0.1", "::1"].includes(host);
  if (!production && local && (u.protocol === "http:" || u.protocol === "https:")) return true;
  if (u.protocol !== "https:") return false;
  try {
    const addresses = isIP(host) ? [host] : await resolve(host);
    return addresses.length > 0 && !addresses.some(privateAddress);
  } catch {
    return false;
  }
}

export async function post(url: string, secret: string, body: string, timeoutMs = 10_000): Promise<{ status: number; text: string }> {
  if (!(await deliverable(url))) return { status: 0, text: "refused: the URL must be https to a public host" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Bugsy-Webhooks/1", "bugsy-signature": sign(secret, body) },
      body,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    return { status: res.status, text: (await res.text()).slice(0, 1024) };
  } catch (err) {
    return { status: 0, text: (err as Error).message.slice(0, 200) };
  }
}

/** One run's deliveries, in order per subscription, stopping when the run's time budget is spent. */
export async function deliverWebhooks(tx: Sql, tenantId: string, budgetMs = 25_000): Promise<{ delivered: number; failed: number }> {
  await tx`select app.integrations_purge(${tenantId})`;
  const due = await tx<{ id: string; url: string; secret: string; event: string; payload: unknown; attempt: number }[]>`select * from app.webhooks_due(${tenantId})`;
  const started = Date.now();
  let delivered = 0;
  let failed = 0;
  const blocked = new Set<string>();
  for (const d of due) {
    if (Date.now() - started > budgetMs) break;
    // In order per URL: one that failed holds the ones after it (the database holds them across runs).
    if (blocked.has(d.url)) continue;
    const r = await post(d.url, d.secret, JSON.stringify(d.payload), Math.min(10_000, Math.max(1_000, budgetMs - (Date.now() - started))));
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
