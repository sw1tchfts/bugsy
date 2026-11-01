import type { Metadata } from "next";
import { headers } from "next/headers";
import { SecretForm } from "@/components/integrations/secret-form";
import { Badge, Button, Card, Empty, Field, Input, Notice, Table, errorMessage } from "@/components/ui";
import { SCOPES, SCOPE_LABELS } from "@/lib/api/keys";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { addDays, formatInstant, todayInZone } from "@/lib/dates";
import { liveTokens } from "@/lib/quickbooks/db";
import { type QboAccount, quickBooks } from "@/lib/quickbooks/provider";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { EVENTS, EVENT_LABELS } from "@/lib/webhooks/events";
import {
  connectPhone,
  createApiKey,
  createWebhook,
  disconnectPhone,
  disconnectQuickBooks,
  revokeApiKey,
  saveMapping,
  sendToQuickBooks,
  setWebhookActive,
  testWebhookAction,
} from "./actions";

export const metadata: Metadata = { title: "Integrations" };

type Search = { note?: string; error?: string };

/** Spec 20: API keys, webhooks, QuickBooks Online and the phone system, each for the people who may change it. */
export default async function Integrations({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  const { session, active } = await requireActiveTenant();
  const manage = can(active.permissions, "integrations.manage");
  const glRead = can(active.permissions, "gl.read");
  const glWrite = can(active.permissions, "gl.write");
  const t = active.tenantId;
  const tz = active.tenantTimezone;
  const h = await headers();
  const origin = h.get("host") ? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}` : (process.env.NEXT_PUBLIC_SITE_URL ?? "");
  const data = await dbAs(session, async (tx) => {
    const keys = manage
      ? await tx<{ id: string; name: string; prefix: string; scopes: string[]; last_used_at: Date | null; revoked_at: Date | null; created_at: Date }[]>`
          select id, name, prefix, scopes, last_used_at, revoked_at, created_at from public.api_keys where tenant_id = ${t} order by revoked_at nulls first, created_at desc`
      : [];
    const requests = manage
      ? await tx<{ at: Date; method: string; path: string; status: number; key: string }[]>`
          select r.at, r.method, r.path, r.status, k.name as key from public.api_requests r join public.api_keys k on k.id = r.api_key_id
          where r.tenant_id = ${t} order by r.at desc limit 15`
      : [];
    const subs = manage
      ? await tx<{ id: string; url: string; events: string[]; active: boolean }[]>`select id, url, events, active from public.webhook_subscriptions where tenant_id = ${t} order by created_at`
      : [];
    const deliveries = manage
      ? await tx<{ id: string; url: string; event: string; status: string; attempt: number; response_status: number | null; created_at: Date; next_at: Date }[]>`
          select d.id, s.url, d.event, d.status, d.attempt, d.response_status, d.created_at, d.next_at
          from public.webhook_deliveries d join public.webhook_subscriptions s on s.id = d.subscription_id
          where d.tenant_id = ${t} order by d.created_at desc limit 20`
      : [];
    const connections = await tx<{ provider: string; status: string; settings: { realm_id?: string; provider?: string; call_number?: string }; inbound_key: string; connected_at: Date }[]>`
      select provider, status, settings, inbound_key, connected_at from public.integration_connections where tenant_id = ${t}`;
    const phoneSecret = manage ? ((await tx<{ inbound_secret: string }[]>`select inbound_secret from app.connection_secrets(${t}, 'phone')`)[0]?.inbound_secret ?? null) : null;
    const qbo = connections.find((c) => c.provider === "quickbooks" && c.status !== "disconnected") ?? null;
    let theirs: QboAccount[] = [];
    let qboError: string | null = null;
    if (glRead && qbo?.status === "connected" && glWrite) {
      try {
        const tokens = await liveTokens(tx, t);
        theirs = tokens ? await quickBooks().accounts(tokens) : [];
      } catch (err) {
        qboError = (err as Error).message;
      }
    }
    const ours = glRead
      ? await tx<{ id: string; number: string | null; name: string; qbo_account_id: string | null; qbo_account_name: string | null }[]>`
          select a.id, a.number, a.name, m.qbo_account_id, m.qbo_account_name from public.gl_accounts a
          left join public.quickbooks_account_map m on m.tenant_id = a.tenant_id and m.gl_account_id = a.id
          where a.tenant_id = ${t} and a.active order by a.number nulls last, a.name`
      : [];
    const syncs = glRead
      ? await tx<{ day: string; status: string; qbo_entry_id: string | null; error: string | null; attempts: number; sent_at: Date | null; lines: unknown[] }[]>`
          select day::text, status, qbo_entry_id, error, attempts, sent_at, lines from public.quickbooks_syncs where tenant_id = ${t} order by day desc limit 14`
      : [];
    return { keys, requests, subs, deliveries, connections, phoneSecret, qbo, theirs, qboError, ours, syncs };
  });
  const phone = data.connections.find((c) => c.provider === "phone" && c.status === "connected") ?? null;
  const hidden = <input type="hidden" name="tenant_id" value={t} />;
  const when = (d: Date | null) => (d ? formatInstant(d, tz) : "never");
  const yesterday = addDays(todayInZone(tz), -1);

  return (
    <>
      <h1 className="text-2xl font-semibold">Integrations</h1>
      {q.note ? <Notice kind="success">{q.note}</Notice> : null}
      {errorMessage(q.error) ? <Notice kind="error">{errorMessage(q.error)}</Notice> : null}
      {!manage && !glRead ? <Notice>Integrations are set up by the owner, and QuickBooks by whoever keeps the books.</Notice> : null}

      {manage ? (
        <Card title="API keys" description="A tool such as an AI receptionist, the website or a lead marketplace calls Bugsy's API with a key. Give each tool its own key with only the scopes it needs; the reference is in docs/api.md.">
          {data.keys.length === 0 ? (
            <Empty>No keys yet.</Empty>
          ) : (
            <Table headers={["Name", "Key", "Scopes", "Last used", ""]}>
              {data.keys.map((k) => (
                <tr key={k.id} data-testid="api-key">
                  <td className="py-2 pr-4 text-sm">{k.name}</td>
                  <td className="py-2 pr-4 font-mono text-xs">bgy_{k.prefix}_...</td>
                  <td className="py-2 pr-4 text-xs">{k.scopes.join(", ")}</td>
                  <td className="py-2 pr-4 text-sm">{k.revoked_at ? <Badge tone="bad">revoked</Badge> : when(k.last_used_at)}</td>
                  <td className="py-2 pr-4 text-sm">
                    {k.revoked_at ? null : (
                      <form action={revokeApiKey}>
                        {hidden}
                        <input type="hidden" name="key_id" value={k.id} />
                        <button type="submit" className="text-red-800 underline">
                          Revoke
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
          <div className="mt-4 border-t border-stone-200 pt-4">
            <SecretForm action={createApiKey} submit="Create key">
              {hidden}
              <Field label="Name" htmlFor="key-name" hint="The tool that will use it.">
                <Input id="key-name" name="name" required maxLength={100} />
              </Field>
              <fieldset className="grid gap-1 text-sm sm:grid-cols-2">
                <legend className="mb-1 font-medium">Scopes</legend>
                {SCOPES.map((s) => (
                  <label key={s} className="flex items-center gap-2">
                    <input type="checkbox" name="scopes" value={s} /> {SCOPE_LABELS[s]} <span className="text-xs text-stone-500">({s})</span>
                  </label>
                ))}
              </fieldset>
            </SecretForm>
          </div>
          {data.requests.length ? (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-medium">Recent calls</h3>
              <Table headers={["When", "Key", "Call", "Answer"]}>
                {data.requests.map((r, i) => (
                  <tr key={i} data-testid="api-request">
                    <td className="py-1 pr-4 text-xs">{formatInstant(r.at, tz)}</td>
                    <td className="py-1 pr-4 text-xs">{r.key}</td>
                    <td className="py-1 pr-4 font-mono text-xs">
                      {r.method} {r.path}
                    </td>
                    <td className="py-1 pr-4 text-xs tabular-nums">{r.status}</td>
                  </tr>
                ))}
              </Table>
            </div>
          ) : null}
        </Card>
      ) : null}

      {manage ? (
        <Card title="Webhooks" description="Bugsy tells another tool when something happens. Each delivery is signed with the subscription's secret (the bugsy-signature header), sent by the messaging job, and retried after 1, 5 and 30 minutes, 2 hours and 12 hours.">
          {data.subs.length === 0 ? (
            <Empty>No subscriptions yet.</Empty>
          ) : (
            <Table headers={["URL", "Events", "", ""]}>
              {data.subs.map((s) => (
                <tr key={s.id} data-testid="webhook-sub">
                  <td className="py-2 pr-4 text-sm break-all">
                    {s.url} {s.active ? null : <Badge tone="warn">off</Badge>}
                  </td>
                  <td className="py-2 pr-4 text-xs">{s.events.join(", ")}</td>
                  <td className="py-2 pr-4 text-sm">
                    <form action={testWebhookAction}>
                      {hidden}
                      <input type="hidden" name="subscription_id" value={s.id} />
                      <button type="submit" className="text-emerald-800 underline">
                        Send a test
                      </button>
                    </form>
                  </td>
                  <td className="py-2 pr-4 text-sm">
                    <form action={setWebhookActive}>
                      {hidden}
                      <input type="hidden" name="subscription_id" value={s.id} />
                      <input type="hidden" name="active" value={s.active ? "false" : "true"} />
                      <button type="submit" className="underline">
                        {s.active ? "Turn off" : "Turn on"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </Table>
          )}
          <div className="mt-4 border-t border-stone-200 pt-4">
            <SecretForm action={createWebhook} submit="Subscribe">
              {hidden}
              <Field label="URL" htmlFor="webhook-url" hint="https://, where the other tool receives events.">
                <Input id="webhook-url" name="url" type="url" required maxLength={500} />
              </Field>
              <fieldset className="grid gap-1 text-sm sm:grid-cols-2">
                <legend className="mb-1 font-medium">Events</legend>
                {EVENTS.map((e) => (
                  <label key={e} className="flex items-center gap-2">
                    <input type="checkbox" name="events" value={e} /> {EVENT_LABELS[e]} <span className="text-xs text-stone-500">({e})</span>
                  </label>
                ))}
              </fieldset>
            </SecretForm>
          </div>
          {data.deliveries.length ? (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-medium">Deliveries (kept 30 days)</h3>
              <Table headers={["Created", "Event", "To", "State", "Tries", "Answer"]}>
                {data.deliveries.map((d) => (
                  <tr key={d.id} data-testid="webhook-delivery">
                    <td className="py-1 pr-4 text-xs">{formatInstant(d.created_at, tz)}</td>
                    <td className="py-1 pr-4 text-xs">{d.event}</td>
                    <td className="py-1 pr-4 text-xs break-all">{d.url}</td>
                    <td className="py-1 pr-4 text-xs">
                      <Badge tone={d.status === "delivered" ? "good" : d.status === "failed" ? "bad" : "neutral"}>{d.status}</Badge>
                      {d.status === "pending" && d.attempt > 0 ? <span className="block text-stone-500">next {formatInstant(d.next_at, tz)}</span> : null}
                    </td>
                    <td className="py-1 pr-4 text-xs tabular-nums">{d.attempt}</td>
                    <td className="py-1 pr-4 text-xs tabular-nums">{d.response_status ?? ""}</td>
                  </tr>
                ))}
              </Table>
            </div>
          ) : null}
        </Card>
      ) : null}

      {glRead ? (
        <Card
          title="QuickBooks Online"
          description="Each day's journal goes to QuickBooks once, as one entry summed by account. Bugsy stays the ledger of record for contract balances; QuickBooks gets the totals."
        >
          {!data.qbo ? (
            glWrite ? (
              <form method="post" action="/api/integrations/quickbooks/connect">
                <Button type="submit">Connect QuickBooks</Button>
                {quickBooks().kind === "local" ? <p className="mt-2 text-xs text-stone-500">No Intuit keys are set, so this connects the local test company.</p> : null}
              </form>
            ) : (
              <Empty>Not connected.</Empty>
            )
          ) : (
            <div className="grid gap-4">
              <p className="text-sm" data-testid="qbo-status">
                {data.qbo.status === "connected" ? <Badge tone="good">connected</Badge> : <Badge tone="bad">needs to be connected again</Badge>} company {data.qbo.settings.realm_id}, since{" "}
                {formatInstant(data.qbo.connected_at, tz)}
              </p>
              {data.qboError ? <Notice kind="error">{data.qboError}</Notice> : null}
              {glWrite ? (
                <div className="flex flex-wrap gap-3">
                  {data.qbo.status !== "connected" ? (
                    <form method="post" action="/api/integrations/quickbooks/connect">
                      <Button type="submit">Connect again</Button>
                    </form>
                  ) : null}
                  <form action={sendToQuickBooks}>
                    {hidden}
                    <Button type="submit" variant="secondary">
                      Send unsent days through {yesterday}
                    </Button>
                  </form>
                  <form action={sendToQuickBooks} className="flex items-end gap-2">
                    {hidden}
                    <input id="qbo-day" type="date" name="day" defaultValue={yesterday} max={yesterday} aria-label="Day to send" className="rounded border border-stone-300 px-2 py-1 text-sm" />
                    <Button type="submit" variant="secondary">
                      Send this day
                    </Button>
                  </form>
                  <form action={disconnectQuickBooks}>
                    {hidden}
                    <Button type="submit" variant="secondary">
                      Disconnect
                    </Button>
                  </form>
                </div>
              ) : null}
              <form action={saveMapping} className="grid gap-2">
                {hidden}
                <h3 className="text-sm font-medium">Accounts</h3>
                <Table headers={["Bugsy account", "QuickBooks account"]}>
                  {data.ours.map((a) => (
                    <tr key={a.id} data-testid="qbo-map-row">
                      <td className="py-1 pr-4 text-sm">
                        {a.number ? `${a.number} ` : ""}
                        {a.name}
                      </td>
                      <td className="py-1 pr-4 text-sm">
                        {glWrite && data.theirs.length ? (
                          <select name={`map:${a.id}`} defaultValue={a.qbo_account_id ?? ""} aria-label={`QuickBooks account for ${a.name}`} className="rounded border border-stone-300 bg-white px-2 py-1 text-sm">
                            <option value="">Not mapped</option>
                            {data.theirs.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name} ({x.type})
                              </option>
                            ))}
                          </select>
                        ) : (
                          (a.qbo_account_name ?? <span className="text-stone-500">not mapped</span>)
                        )}
                      </td>
                    </tr>
                  ))}
                </Table>
                {glWrite && data.theirs.length ? (
                  <div>
                    <Button type="submit">Save mapping</Button>
                  </div>
                ) : null}
              </form>
              <div>
                <h3 className="mb-2 text-sm font-medium">Days sent</h3>
                {data.syncs.length === 0 ? (
                  <Empty>Nothing sent yet.</Empty>
                ) : (
                  <Table headers={["Day", "State", "QuickBooks entry", "Lines", ""]}>
                    {data.syncs.map((s) => (
                      <tr key={s.day} data-testid="qbo-sync">
                        <td className="py-1 pr-4 text-sm">{s.day}</td>
                        <td className="py-1 pr-4 text-sm">
                          {s.status === "sent" ? <Badge tone="good">sent</Badge> : <Badge tone="bad">not sent</Badge>}
                          {s.error ? <span className="block text-xs text-red-900">{s.error}</span> : null}
                        </td>
                        <td className="py-1 pr-4 font-mono text-xs">{s.qbo_entry_id ?? ""}</td>
                        <td className="py-1 pr-4 text-xs tabular-nums">{s.lines.length}</td>
                        <td className="py-1 pr-4 text-sm">
                          {s.status === "failed" && glWrite ? (
                            <form action={sendToQuickBooks}>
                              {hidden}
                              <input type="hidden" name="day" value={s.day} />
                              <button type="submit" className="text-emerald-800 underline">
                                Send again
                              </button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </Table>
                )}
              </div>
            </div>
          )}
        </Card>
      ) : null}

      {manage ? (
        <Card title="Phone system" description="When a call comes in, the phone system tells Bugsy: the caller's account opens on the office screens and the call is logged on it. Outgoing calls from a contact's page are logged too.">
          {phone ? (
            <div className="grid gap-3 text-sm">
              <p data-testid="phone-status">
                <Badge tone="good">connected</Badge> {phone.settings.provider ?? "Phone system"}
                {phone.settings.call_number ? `, calls from ${phone.settings.call_number}` : ""}
              </p>
              <p>
                Send call events to <code className="rounded bg-stone-100 px-1 font-mono text-xs" data-testid="phone-url">{`${origin}/api/integrations/phone/${phone.inbound_key}`}</code>, signed with{" "}
                <code className="rounded bg-stone-100 px-1 font-mono text-xs break-all" data-testid="phone-secret">
                  {data.phoneSecret}
                </code>{" "}
                the way Bugsy signs its webhooks.
              </p>
              <form action={disconnectPhone}>
                {hidden}
                <Button type="submit" variant="secondary">
                  Disconnect
                </Button>
              </form>
            </div>
          ) : (
            <form action={connectPhone} className="grid gap-3 sm:grid-cols-2">
              {hidden}
              <Field label="Phone system" htmlFor="phone-provider">
                <Input id="phone-provider" name="provider" maxLength={60} placeholder="Your VoIP provider" />
              </Field>
              <Field label="Company number" htmlFor="phone-number">
                <Input id="phone-number" name="call_number" type="tel" maxLength={30} />
              </Field>
              <div>
                <Button type="submit">Connect</Button>
              </div>
            </form>
          )}
        </Card>
      ) : null}
    </>
  );
}
