import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { addDays, todayInZone } from "../../lib/dates";
import { PG_TYPES } from "../../lib/pg-types";
import { sign, verify } from "../../lib/webhooks/events";
import { SEED_PASSWORD, SEED_TENANTS, seedUserEmail } from "../../scripts/seed-data";

const [northwind, lakeshore] = SEED_TENANTS;

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/(tech)?$/);
}

async function signOut(page: Page) {
  if (!(await page.getByRole("button", { name: "Sign out" }).isVisible())) await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
}

/** Creates a key with the scopes and returns the secret the page shows once. */
async function createKey(page: Page, name: string, scopes: string[]): Promise<string> {
  await page.goto("/settings/integrations");
  await page.locator("#key-name").fill(name);
  for (const s of scopes) await page.locator(`input[name="scopes"][value="${s}"]`).check();
  await page.getByRole("button", { name: "Create key" }).click();
  await expect(page.getByTestId("secret-value")).toBeVisible();
  return ((await page.getByTestId("secret-value").textContent()) ?? "").trim();
}

test("integrations: a scoped key looks up, reads availability and adds a lead; a signed webhook arrives; QuickBooks gets a day; a call pops and is logged; a trap reports; another company sees none of it", async ({ page, request }) => {
  test.setTimeout(300_000);
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1, prepare: false, onnotice: () => {}, types: PG_TYPES });
  const [tenant] = await sql<{ id: string }[]>`select id from public.tenants where name = ${northwind.name}`;
  const [other] = await sql<{ id: string }[]>`select id from public.tenants where name = ${lakeshore.name}`;
  const run = Date.now().toString().slice(-6);

  // A receiver on this machine, as the other tool would run one.
  const received: { body: string; signature: string }[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ body, signature: String(req.headers["bugsy-signature"] ?? "") });
      res.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const hookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;

  // 1. The owner gives the AI receptionist a key with lookups, leads and availability, and subscribes the receiver.
  await signIn(page, seedUserEmail(northwind, "owner"));
  const key = await createKey(page, `Receptionist ${run}`, ["accounts.read", "leads.write", "availability.read"]);
  expect(key).toMatch(/^bgy_[a-z0-9]{8}_/);
  await page.goto("/settings/integrations");
  await expect(page.getByTestId("secret-value")).toHaveCount(0);
  const trapKey = await createKey(page, `Trap gateway ${run}`, ["devices.write"]);
  await page.goto("/settings/integrations");
  await page.locator("#webhook-url").fill(hookUrl);
  await page.locator('input[name="events"][value="lead.created"]').check();
  await page.getByRole("button", { name: "Subscribe" }).click();
  await expect(page.getByTestId("secret-value")).toBeVisible();
  const hookSecret = ((await page.getByTestId("secret-value").textContent()) ?? "").trim();
  await page.screenshot({ path: "test-results/integrations-keys.png", fullPage: true });

  // 2. The API, as the receptionist calls it.
  const auth = { authorization: `Bearer ${key}` };
  const lookup = await request.get("/api/v1/accounts/lookup?phone=614-555-0150", { headers: auth });
  expect(lookup.status()).toBe(200);
  const found = (await lookup.json()) as { accounts: { name: string; properties: { property_id: string }[] }[] };
  const oakwood = found.accounts.find((a) => a.name === "Oakwood Properties");
  expect(oakwood).toBeTruthy();
  const days = await request.get(`/api/v1/availability?property_id=${oakwood?.properties[0].property_id}`, { headers: auth });
  expect(days.status()).toBe(200);
  expect(((await days.json()) as { days: unknown[] }).days.length).toBeGreaterThan(0);
  const lead = await request.post("/api/v1/leads", { headers: auth, data: { name: `Caller ${run}`, email: "office@oakwood.northwind.test", phone: `614-555-${run.slice(-4)}`, source: "LeadMarket" } });
  expect(lead.status()).toBe(201);
  const created = (await lead.json()) as { lead_id: string; source: string; possible_matches: { kind: string; name: string }[] };
  expect(created.source).toBe("LeadMarket");
  expect(created.possible_matches.some((m) => m.name === "Oakwood Properties")).toBe(true);
  const visits = await request.get(`/api/v1/visits?account_id=${tenant.id}&from=2026-01-01&to=2026-12-31`, { headers: auth });
  expect(visits.status()).toBe(403);
  expect(((await visits.json()) as { error: { code: string } }).error.code).toBe("forbidden");
  const [{ api_key_id: by }] = await sql<{ api_key_id: string | null }[]>`select api_key_id from public.leads where id = ${created.lead_id}`;
  expect(by).not.toBeNull();
  // A property of another company is not found, whatever the key's scopes.
  const [theirs] = await sql<{ id: string }[]>`select id from public.properties where tenant_id = ${other.id} limit 1`;
  expect((await request.get(`/api/v1/availability?property_id=${theirs.id}`, { headers: auth })).status()).toBe(404);

  // The messaging job delivers the lead's event, signed with the subscription's secret.
  await expect
    .poll(async () => {
      await page.request.post("/api/messaging/run");
      return received.filter((r) => r.body.includes(created.lead_id)).length;
    }, { timeout: 60_000 })
    .toBeGreaterThan(0);
  const delivery = received.find((r) => r.body.includes(created.lead_id)) as { body: string; signature: string };
  expect(verify(hookSecret, delivery.body, delivery.signature)).toBe(true);
  expect(JSON.parse(delivery.body)).toMatchObject({ event: "lead.created", data: { lead_id: created.lead_id, source: "LeadMarket" } });
  await page.goto("/settings/integrations");
  await expect(page.getByTestId("webhook-delivery").filter({ hasText: "delivered" }).first()).toBeVisible();
  await expect(page.getByTestId("api-request").filter({ hasText: "/api/v1/visits" }).first()).toContainText("403");

  // 3. A smart trap's catch lands in the device's history as a sensor check.
  const [device] = await sql<{ barcode: string; property_id: string; number: number }[]>`
    select barcode, property_id, number from public.devices where tenant_id = ${tenant.id} and status = 'active' and barcode is not null order by number limit 1`;
  const trap = await request.post("/api/v1/device-events", { headers: { authorization: `Bearer ${trapKey}` }, data: { barcode: device.barcode, count: 2, pest: "House mouse" } });
  expect(trap.status()).toBe(201);
  expect((await request.post("/api/v1/device-events", { headers: { authorization: `Bearer ${trapKey}` }, data: { barcode: "NO-SUCH-TRAP" } })).status()).toBe(404);
  await page.goto(`/sites/${device.property_id}`);
  await expect(page.getByTestId("site-check").filter({ hasText: "sensor" }).first()).toBeVisible();

  // 4. The phone system: connected, a call rings and pops the account, then ends and is logged on it.
  await page.goto("/settings/integrations");
  if (await page.getByRole("button", { name: "Connect", exact: true }).isVisible()) {
    await page.locator("#phone-provider").fill("Office VoIP");
    await page.locator("#phone-number").fill("+16145550199");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
  }
  const phoneUrl = ((await page.getByTestId("phone-url").textContent()) ?? "").trim();
  const phoneSecret = ((await page.getByTestId("phone-secret").textContent()) ?? "").trim();
  const path = new URL(phoneUrl).pathname;
  const callId = `e2e-${run}`;
  const ring = JSON.stringify({ call_id: callId, direction: "inbound", from: "+16145550150", to: "+16145550199" });
  expect((await request.post(path, { headers: { "content-type": "application/json", "bugsy-signature": "t=1,v1=00" }, data: ring })).status()).toBe(401);
  const rang = await request.post(path, { headers: { "content-type": "application/json", "bugsy-signature": sign(phoneSecret, ring) }, data: ring });
  expect(rang.status()).toBe(200);
  await page.goto("/customers");
  await expect(page.getByTestId("caller-pop")).toContainText("Oakwood Properties", { timeout: 20_000 });
  await page.screenshot({ path: "test-results/integrations-caller-pop.png", fullPage: true });
  const ended = JSON.stringify({ call_id: callId, direction: "inbound", from: "+16145550150", to: "+16145550199", duration_seconds: 95, recording_url: "https://recordings.example.com/e2e.mp3" });
  expect((await request.post(path, { headers: { "content-type": "application/json", "bugsy-signature": sign(phoneSecret, ended) }, data: ended })).status()).toBe(200);
  const [call] = await sql<{ account_id: string; duration_seconds: number; n: number }[]>`
    select account_id, duration_seconds, (select count(*)::int from public.calls where tenant_id = ${tenant.id} and provider_call_id = ${callId}) as n
    from public.calls where tenant_id = ${tenant.id} and provider_call_id = ${callId}`;
  expect(call).toMatchObject({ duration_seconds: 95, n: 1 });
  await page.goto(`/customers/${call.account_id}`);
  await expect(page.getByTestId("call-row").filter({ hasText: "1:35" }).first()).toBeVisible();
  await expect(page.getByTestId("call-link").first()).toBeVisible();
  await signOut(page);

  // 5. The bookkeeper connects QuickBooks (the local test company), maps the accounts and sends a day.
  await signIn(page, seedUserEmail(northwind, "bookkeeper"));
  await page.goto("/settings/integrations");
  if (await page.getByRole("button", { name: /^Connect (QuickBooks|again)$/ }).isVisible()) {
    await page.getByRole("button", { name: /^Connect (QuickBooks|again)$/ }).click();
    await expect(page.getByText("QuickBooks connected.")).toBeVisible();
  }
  const pick = (name: string) => {
    const n = name.toLowerCase();
    if (/unbilled/.test(n)) return "Unbilled Receivables";
    if (/receivable/.test(n)) return "Accounts Receivable (A/R)";
    if (/deferred|unearned|customer deposits|prepaid by customers/.test(n)) return "Deferred Revenue";
    if (/tax/.test(n)) return "Sales Tax Payable";
    if (/payable|commissions owed|wages owed|payroll/.test(n)) return "Accounts Payable (A/P)";
    if (/inventory|stock/.test(n)) return "Inventory Asset";
    if (/cash|bank|checking|clearing|stripe|undeposited/.test(n)) return "Undeposited Funds";
    if (/equity|opening|retained/.test(n)) return "Opening Balance Equity";
    if (/revenue|income|service|fee/.test(n)) return "Services";
    return "Cost of Goods Sold";
  };
  const rows = page.getByTestId("qbo-map-row");
  for (let i = 0; i < (await rows.count()); i += 1) {
    const row = rows.nth(i);
    const name = ((await row.locator("td").first().textContent()) ?? "").trim();
    const select = row.locator("select");
    const label = ((await select.locator("option:checked").textContent()) ?? "").trim();
    if (label === "Not mapped") {
      const want = pick(name);
      const value = await select.locator("option", { hasText: want }).first().getAttribute("value");
      await select.selectOption(value as string);
    }
  }
  await page.getByRole("button", { name: "Save mapping" }).click();
  await expect(page.getByText("Account mapping saved.")).toBeVisible();
  // The last day with posted lines before today: yesterday when the books moved then.
  const today = todayInZone(northwind.timezone);
  const [busy] = await sql<{ day: string }[]>`
    select max(e.posted_on)::text as day from public.journal_entries e where e.tenant_id = ${tenant.id} and e.posted_on < ${today} and e.posted_on >= ${addDays(today, -60)}`;
  const day = busy.day ?? addDays(today, -1);
  await sql`delete from public.quickbooks_syncs where tenant_id = ${tenant.id} and day = ${day}`;
  await page.locator("#qbo-day").fill(day);
  await page.getByRole("button", { name: "Send this day" }).click();
  await expect(page.getByText(/1 day\(s\) sent to QuickBooks/)).toBeVisible();
  const [sent] = await sql<{ status: string; qbo_entry_id: string; n: number }[]>`
    select status, qbo_entry_id, jsonb_array_length(lines) as n from public.quickbooks_syncs where tenant_id = ${tenant.id} and day = ${day}`;
  expect(sent).toMatchObject({ status: "sent", qbo_entry_id: `local-${day}` });
  expect(sent.n).toBeGreaterThan(1);
  await expect(page.getByTestId("qbo-sync").filter({ hasText: day })).toContainText("sent");
  await page.screenshot({ path: "test-results/integrations-quickbooks.png", fullPage: true });
  await signOut(page);

  // 6. Another company sees none of it.
  await signIn(page, seedUserEmail(lakeshore, "owner"));
  await page.goto("/settings/integrations");
  await expect(page.getByTestId("api-key").filter({ hasText: `Receptionist ${run}` })).toHaveCount(0);
  await expect(page.getByTestId("webhook-sub").filter({ hasText: hookUrl })).toHaveCount(0);
  await signOut(page);
  server.close();
  await sql.end();
});
