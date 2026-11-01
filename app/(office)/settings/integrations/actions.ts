"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cleanScopes, newKey } from "@/lib/api/keys";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { str } from "@/lib/customers/forms";
import { isIsoDate } from "@/lib/dates";
import { errorCode } from "@/lib/db";
import { liveTokens, syncQuickBooks } from "@/lib/quickbooks/db";
import { quickBooks } from "@/lib/quickbooks/provider";
import { testWebhook } from "@/lib/webhooks/db";
import { EVENTS, validUrl } from "@/lib/webhooks/events";

const page = "/settings/integrations";

function back(params: Record<string, string | null>): never {
  revalidatePath(page);
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  redirect(`${page}${q ? `?${q}` : ""}`);
}

export type SecretState = { secret?: string; label?: string; error?: string };

// ---------------------------------------------------------------------------
// API keys (rule 1): the secret is shown once, here, and stored only as its hash.
// ---------------------------------------------------------------------------

export async function createApiKey(_prev: SecretState, formData: FormData): Promise<SecretState> {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "integrations.manage");
  const name = str(formData, "name").trim().slice(0, 100);
  const scopes = cleanScopes(formData.getAll("scopes").map(String));
  if (!name) return { error: "Name the key after the tool that will use it." };
  if (scopes.length === 0) return { error: "Give the key at least one scope." };
  const k = newKey();
  try {
    await dbAs(session, (tx) => tx`insert into public.api_keys (tenant_id, name, prefix, key_hash, scopes) values (${tenantId}, ${name}, ${k.prefix}, ${k.hash}, ${scopes})`);
  } catch (err) {
    return { error: errorCode(err) };
  }
  revalidatePath(page);
  return { secret: k.key, label: `Key "${name}"` };
}

export async function revokeApiKey(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "integrations.manage");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`update public.api_keys set revoked_at = now() where id = ${str(formData, "key_id")} and tenant_id = ${tenantId} and revoked_at is null`);
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Key revoked. Calls with it now fail." });
}

// ---------------------------------------------------------------------------
// Webhooks (rules 5 and 6)
// ---------------------------------------------------------------------------

export async function createWebhook(_prev: SecretState, formData: FormData): Promise<SecretState> {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "integrations.manage");
  const url = str(formData, "url").trim();
  const events = formData.getAll("events").map(String).filter((e) => (EVENTS as readonly string[]).includes(e));
  if (!validUrl(url)) return { error: "The URL must start with https:// (http:// only for a receiver on this computer)." };
  if (events.length === 0) return { error: "Pick at least one event." };
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  try {
    await dbAs(session, (tx) => tx`insert into public.webhook_subscriptions (tenant_id, url, events, secret) values (${tenantId}, ${url}, ${events}, ${secret})`);
  } catch (err) {
    return { error: errorCode(err) };
  }
  revalidatePath(page);
  return { secret, label: `Signing secret for ${url}` };
}

export async function setWebhookActive(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "integrations.manage");
  const active = formData.get("active") === "true";
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`update public.webhook_subscriptions set active = ${active} where id = ${str(formData, "subscription_id")} and tenant_id = ${tenantId}`);
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: active ? "Subscription on." : "Subscription off: nothing more is queued for it." });
}

export async function testWebhookAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "integrations.manage");
  let error: string | null = null;
  let note: string | null = null;
  try {
    const r = await dbAs(session, (tx) => testWebhook(tx, tenantId, str(formData, "subscription_id")));
    note = r.status >= 200 && r.status < 300 ? `Test delivered: the receiver answered ${r.status}.` : `Test not delivered: ${r.status ? `the receiver answered ${r.status}` : r.text}.`;
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note });
}

// ---------------------------------------------------------------------------
// QuickBooks Online (rule 7): connect, map accounts, send days
// ---------------------------------------------------------------------------

export async function disconnectQuickBooks(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "gl.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`select app.set_connection_tokens(${tenantId}, 'quickbooks', null, 'disconnected')`);
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "QuickBooks disconnected. Days already sent stay there." });
}

export async function saveMapping(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "gl.write");
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const tokens = await liveTokens(tx, tenantId);
      if (!tokens) throw Object.assign(new Error("Connect QuickBooks first."), { code: "23514" });
      const theirs = new Map((await quickBooks().accounts(tokens)).map((a) => [a.id, a.name]));
      for (const [field, value] of formData.entries()) {
        if (!field.startsWith("map:")) continue;
        const glAccountId = field.slice(4);
        const qbo = String(value);
        if (!qbo) await tx`delete from public.quickbooks_account_map where tenant_id = ${tenantId} and gl_account_id = ${glAccountId}`;
        else if (theirs.has(qbo)) {
          await tx`insert into public.quickbooks_account_map (tenant_id, gl_account_id, qbo_account_id, qbo_account_name) values (${tenantId}, ${glAccountId}, ${qbo}, ${theirs.get(qbo) as string})
                   on conflict (tenant_id, gl_account_id) do update set qbo_account_id = excluded.qbo_account_id, qbo_account_name = excluded.qbo_account_name`;
        }
      }
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Account mapping saved." });
}

/** Sends one day (a failed day again), or every unsent day through yesterday. */
export async function sendToQuickBooks(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session, membership } = await requirePermission(tenantId, "gl.write");
  const day = formData.get("day") ? str(formData, "day") : null;
  if (day && !isIsoDate(day)) back({ error: "Pick a day." });
  let error: string | null = null;
  let note: string | null = null;
  try {
    const r = await dbAs(session, (tx) => syncQuickBooks(tx, tenantId, membership.tenantTimezone, day ?? undefined));
    note = `${r.sent} day(s) sent to QuickBooks${r.failed ? `, ${r.failed} not sent: ${r.waiting}` : r.waiting ? `. ${r.waiting}` : "."}`;
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note });
}

// ---------------------------------------------------------------------------
// The phone system (rule 8)
// ---------------------------------------------------------------------------

export async function connectPhone(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "integrations.manage");
  const provider = str(formData, "provider").trim().slice(0, 60) || "Phone system";
  const callNumber = str(formData, "call_number").trim().slice(0, 30);
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`
      insert into public.integration_connections (tenant_id, provider, status, settings) values (${tenantId}, 'phone', 'connected', ${tx.json({ provider, call_number: callNumber })})
      on conflict (tenant_id, provider) do update set status = 'connected', settings = excluded.settings`);
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Phone system connected. Give it the address and secret below." });
}

export async function disconnectPhone(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "integrations.manage");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`update public.integration_connections set status = 'disconnected' where tenant_id = ${tenantId} and provider = 'phone'`);
  } catch (err) {
    error = errorCode(err);
  }
  back(error ? { error } : { note: "Phone system disconnected: its events are refused." });
}
