import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { todayInZone } from "../../lib/dates";
import { PG_TYPES } from "../../lib/pg-types";
import { SEED_PASSWORD, SEED_TENANTS, seedUserEmail } from "../../scripts/seed-data";

const [northwind, lakeshore] = SEED_TENANTS;

async function signIn(page: Page, email: string, landing: RegExp = /\/(tech|portal)?$/) {
  await page.goto("/sign-in");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(landing);
}

async function signOut(page: Page) {
  if (!(await page.getByRole("button", { name: "Sign out" }).isVisible())) await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
}

async function knock(page: Page, line1: string, outcome: string) {
  await page.getByLabel("Street address").fill(line1);
  await page.getByLabel("City").fill("Columbus");
  await page.getByLabel("State").fill("OH");
  await page.getByLabel("ZIP").fill("43201");
  await page.getByLabel(outcome, { exact: true }).check();
  await page.getByRole("button", { name: /Save knock|Save anyway/ }).click();
  await page.waitForLoadState("networkidle");
}

async function sell(page: Page, territoryUrl: string, name: string, line1: string, billing: string) {
  await page.goto(`${territoryUrl}/sell`);
  await page.getByLabel("Customer's name").fill(name);
  await page.getByLabel("Email").fill(`${name.toLowerCase().replace(/\s+/g, ".")}@example.test`);
  await page.getByLabel("Street address").fill(line1);
  await page.getByLabel("City").fill("Columbus");
  await page.getByLabel("State").fill("OH");
  await page.getByLabel("ZIP").fill("43201");
  await page.getByLabel("Size (sq ft)").fill("1800");
  await page.getByLabel("Plan").selectOption({ label: "General pest plan" });
  await page.getByRole("button", { name: "Price it" }).click();
  await expect(page.getByTestId("door-price").first()).toBeVisible();
  await page.getByLabel("Billing").selectOption(billing);
  await page.getByLabel("Customer types their name").fill(name);
  const canvas = page.getByLabel("Customer signs here");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox()) as { x: number; y: number; width: number; height: number };
  await page.mouse.move(box.x + 20, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 30, { steps: 8 });
  await page.mouse.move(box.x + 240, box.y + 70, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("signature-state")).toHaveText("Signed.");
  await page.getByLabel("Card number").fill("4242424242424242");
  await page.getByLabel("Month").fill("12");
  await page.getByLabel("Year").fill("2031");
  await page.getByRole("button", { name: "Sign and start the plan" }).click();
  await expect(page.getByText(/Sold: agreement #\d+ is active/)).toBeVisible();
  return Number((await page.getByText(/Sold: agreement #\d+/).textContent())?.match(/#(\d+)/)?.[1]);
}

test("door to door: a territory, knocks and the do-not-knock warning, two sales at the door, a commission held then payable and one charged back, a sequence, a survey and a referral", async ({ page }) => {
  test.setTimeout(300_000);
  const stamp = Date.now();
  const today = todayInZone(northwind.timezone);
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1, prepare: false, onnotice: () => {}, types: PG_TYPES });
  const [tenant] = await sql<{ id: string }[]>`select id from public.tenants where name = ${northwind.name}`;

  // 1. The office makes a territory for Alex.
  await signIn(page, seedUserEmail(northwind, "office"));
  await page.goto("/sales/territories");
  await page.getByLabel("New territory").fill(`Birch ${stamp}`);
  await page.locator("#t-zips").fill("43201");
  await page.getByRole("checkbox", { name: "Alex Kim" }).last().check();
  await page.getByRole("button", { name: "Add territory" }).click();
  await expect(page.getByTestId("territory-row").filter({ hasText: `Birch ${stamp}` })).toContainText("Alex Kim");
  await signOut(page);

  // 2. Alex knocks: not home, a do-not-knock, and the warning at that door next time.
  await signIn(page, seedUserEmail(northwind, "sales_rep"));
  // The rep's phone shares where they stand, so each knock lands on the map.
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: 39.9842, longitude: -83.0046 });
  await page.goto("/door");
  await page.getByTestId("door-territory").filter({ hasText: `Birch ${stamp}` }).click();
  await expect(page).toHaveURL(/\/door\/[0-9a-f-]+$/);
  const territoryUrl = new URL(page.url()).pathname;
  const door = (n: number) => `${300 + n} Birch Lane ${stamp % 1000}`;
  await expect(page.getByTestId("door-location")).toHaveText(/saved with the knock/);
  await knock(page, door(1), "Not home");
  await expect(page.getByText("Knock saved.")).toBeVisible();
  await knock(page, door(5), "Do not knock");
  await knock(page, door(5), "Not home");
  await expect(page.getByText("This address asked not to be knocked.")).toBeVisible();
  await expect(page.getByTestId("dnk-list")).toContainText(door(5).split(" ").slice(0, 2).join(" "));
  await expect(page.getByTestId("knock-map")).toBeVisible();
  await page.screenshot({ path: "test-results/sales-territory.png", fullPage: true });

  // 3. Two sales at the door: one on annual prepay (paid by autopay on the next run), one per visit (cancelled below).
  const kept = await sell(page, territoryUrl, `Casey Prepay ${stamp}`, door(9), "annual_prepay");
  const lost = await sell(page, territoryUrl, `Robin Cancel ${stamp}`, door(13), "per_visit");
  await page.screenshot({ path: "test-results/sales-sold.png", fullPage: true });
  // Back at a door already sold: the rep is offered the existing account instead of a duplicate customer.
  const again = new URLSearchParams({ name: "Someone Else", line1: door(9), city: "Columbus", state_code: "OH", postal_code: "43201", size_sqft: "1800" });
  await page.goto(`${territoryUrl}/sell?${again.toString()}`);
  await page.getByLabel("Plan").selectOption({ label: "General pest plan" });
  await page.getByRole("button", { name: "Price it" }).click();
  await expect(page.getByTestId("door-existing")).toContainText(`Add the plan to Casey Prepay ${stamp} (this address)`);
  const sales = await sql<{ id: string; number: number; status: string; sold_by: string | null; visits: number; card: string | null; commission: string | null; commission_status: string | null }[]>`
    select g.id, g.number, g.status, g.sold_by,
           (select count(*)::int from public.visits v where v.agreement_id = g.id) as visits,
           (select pm.last4 from public.payment_methods pm where pm.account_id = g.account_id and pm.status = 'active' limit 1) as card,
           (select c.id from public.commissions c where c.agreement_id = g.id limit 1) as commission,
           (select c.status from public.commissions c where c.agreement_id = g.id limit 1) as commission_status
    from public.agreements g where g.tenant_id = ${tenant.id} and g.number = any(${[kept, lost]}::int[]) order by g.number`;
  expect(sales).toHaveLength(2);
  for (const s of sales) {
    expect(s.status).toBe("active");
    expect(s.sold_by).toBeTruthy();
    expect(s.visits).toBeGreaterThan(0);
    expect(s.card).toBe("4242");
    expect(s.commission_status).toBe("held");
  }
  await page.goto("/sales/commissions");
  await expect(page.getByTestId("commission-row").filter({ hasText: `Casey Prepay ${stamp}` })).toContainText(/held until/);
  await signOut(page);

  // 4. The hold passes (the clock is moved for the test); the office cancels the other sale inside its window.
  const keptSale = sales.find((s) => s.number === kept)!;
  await sql`update public.commissions set releasable_on = ${today}::date - 1 where id = ${keptSale.commission}`;
  await signIn(page, seedUserEmail(northwind, "owner"));
  const lostSale = sales.find((s) => s.number === lost)!;
  await page.goto(`/agreements/${lostSale.id}`);
  await page.locator("#cancel_reason_id").selectOption({ index: 1 });
  await page.locator("#cancel_effective_on").fill(today);
  await page.getByRole("button", { name: /Cancel agreement/ }).click();
  await page.waitForLoadState("networkidle");
  await page.goto("/billing");
  await page.getByRole("button", { name: "Run the billing job now" }).click();
  await page.waitForLoadState("networkidle");
  const after = await sql<{ id: string; status: string }[]>`select id, status from public.commissions where id = any(${[keptSale.commission, lostSale.commission]}::uuid[])`;
  expect(after.find((c) => c.id === keptSale.commission)?.status).toBe("payable");
  expect(after.find((c) => c.id === lostSale.commission)?.status).toBe("charged_back");
  await page.goto(`/ledger/journal?source_type=commission&q=${encodeURIComponent(`agreement #${kept}`)}`);
  const entry = page.getByTestId("journal-row").filter({ hasText: `agreement #${kept}` });
  await expect(entry).toHaveCount(1);
  await entry.getByRole("link").first().click();
  await expect(page.getByTestId("journal-line").filter({ hasText: "Commissions payable" })).toBeVisible();
  await page.screenshot({ path: "test-results/sales-commission-entry.png", fullPage: true });

  // 5. The renewal sequence sent its first step to the customer whose plan ends soon.
  const [sent] = await sql<{ n: number }[]>`
    select count(*)::int as n from public.messages m where m.tenant_id = ${tenant.id} and m.purpose = 'campaign' and m.subject like 'Your plan with%'`;
  expect(sent.n).toBeGreaterThan(0);
  await signOut(page);

  // 6. A customer rates a visit from the link in the summary.
  // The seed leaves one unanswered; a rerun makes another the way the visit summary would.
  let [survey] = await sql<{ token: string }[]>`select token from public.surveys where tenant_id = ${tenant.id} and responded_at is null limit 1`;
  if (!survey) {
    [survey] = await sql<{ token: string }[]>`
      insert into public.surveys (tenant_id, visit_id, account_id)
      select v.tenant_id, v.id, v.account_id from public.visits v
      where v.tenant_id = ${tenant.id} and v.status = 'completed' and not v.imported and not exists (select 1 from public.surveys s where s.visit_id = v.id)
      order by v.completed_at desc limit 1 returning token`;
  }
  expect(survey, "a survey to answer").toBeTruthy();
  await page.goto(`/s/${survey.token}`);
  await page.getByLabel("9", { exact: true }).check({ force: true });
  await page.getByLabel("Anything to tell us?").fill(`Great service ${stamp}`);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("survey-thanks")).toBeVisible();

  // 7. A friend comes through Maria's referral link and books; when the friend signs, Maria gets the credit.
  const [maria] = await sql<{ id: string; referral_code: string }[]>`select id, referral_code from public.accounts where tenant_id = ${tenant.id} and name = 'Maria Lopez'`;
  await page.goto(`/r/${maria.referral_code}`);
  await expect(page).toHaveURL(/\/f\/[0-9a-f-]+\?ref=/);
  await page.getByLabel("Your name").fill(`Pat Friend ${stamp}`);
  await page.getByLabel("Email").fill(`pat.friend.${stamp}@example.test`);
  await page.getByLabel("Service address").fill(`77 Willow Way ${stamp % 1000}`);
  await page.getByLabel("City").fill("Columbus");
  await page.getByLabel("State").fill("OH");
  await page.getByLabel("ZIP").fill("43201");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("form-thanks")).toBeVisible();
  const [lead] = await sql<{ id: string; referred_by_account_id: string | null }[]>`select id, referred_by_account_id from public.leads where tenant_id = ${tenant.id} and name = ${`Pat Friend ${stamp}`}`;
  expect(lead.referred_by_account_id).toBe(maria.id);
  await signIn(page, seedUserEmail(northwind, "owner"));
  await page.goto(`/leads/${lead.id}`);
  await page.getByRole("button", { name: "Mark won and convert" }).click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]+$/);
  await page.getByRole("link", { name: "New agreement" }).click();
  await page.getByLabel("Service type").selectOption({ label: "General pest plan" });
  await page.locator("#new-initial").fill("199.00");
  await page.locator("#new-recurring").fill("99.00");
  await page.locator("#new-starts").fill(today);
  await page.locator("#new-first").fill(today);
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByLabel("Customer's typed name").fill(`Pat Friend ${stamp}`);
  await page.getByLabel("The customer agrees to the terms above").check();
  await page.getByRole("button", { name: "Sign and activate" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
  const [credit] = await sql<{ amount_cents: string; credit_memo_id: string | null }[]>`
    select rc.amount_cents, rc.credit_memo_id from public.referral_credits rc join public.agreements g on g.id = rc.agreement_id join public.accounts a on a.id = g.account_id
    where rc.referrer_account_id = ${maria.id} and a.name = ${`Pat Friend ${stamp}`}`;
  expect(credit, "the referrer is credited when the friend signs").toBeTruthy();
  expect(credit.credit_memo_id).toBeTruthy();
  await page.goto("/settings/growth");
  await expect(page.getByTestId("nps")).not.toHaveText("no answers");
  await page.screenshot({ path: "test-results/sales-growth.png", fullPage: true });
  await signOut(page);

  // 8. Another company sees none of it.
  await signIn(page, seedUserEmail(lakeshore, "owner"));
  await page.goto("/sales/territories");
  await expect(page.getByTestId("territory-row").filter({ hasText: `Birch ${stamp}` })).toHaveCount(0);
  await page.goto("/sales/commissions");
  await expect(page.getByTestId("commission-row").filter({ hasText: String(stamp) })).toHaveCount(0);
  await signOut(page);
  await sql.end();
});
