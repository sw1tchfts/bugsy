import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { todayInZone } from "../../lib/dates";
import { PG_TYPES } from "../../lib/pg-types";
import { SEED_PASSWORD, SEED_TENANTS, seedUserEmail } from "../../scripts/seed-data";

const [northwind, lakeshore] = SEED_TENANTS;

async function signIn(page: Page, email: string, landing: RegExp = /\/(tech)?$/) {
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

const truckDemand = async (page: Page) => {
  await page.goto("/tech?truck=1");
  const item = page.getByTestId("truck-item").filter({ hasText: "Demand CS" });
  await expect(item).toBeVisible();
  return Number(((await item.textContent()) ?? "").match(/(-?\d+(?:\.\d+)?) fl oz/)?.[1]);
};

test("inventory and payroll: stock received and loaded, a clocked shift and a stop that uses it, the job's margin, the payroll export and journal", async ({ page, context }) => {
  test.setTimeout(300_000);
  const stamp = Date.now();
  const today = todayInZone(northwind.timezone);
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1, prepare: false, onnotice: () => {}, types: PG_TYPES });
  const [tenant] = await sql<{ id: string }[]>`select id from public.tenants where name = ${northwind.name}`;

  // 1. The dispatcher receives Demand CS at a new price and loads some onto Sam's truck.
  await signIn(page, seedUserEmail(northwind, "dispatcher"));
  await page.goto("/inventory");
  const receive = page.getByTestId("receive-form");
  await receive.getByLabel("Product").selectOption({ label: "Demand CS (fl oz)" });
  await receive.getByLabel("Into").selectOption({ label: "Main office warehouse" });
  await receive.getByLabel("Quantity").fill("32");
  await receive.getByLabel("Cost per unit").fill("7.00");
  await receive.getByLabel("Supplier").fill("Univar Solutions");
  await receive.getByLabel("Reference").fill(`PS-${stamp}`);
  await receive.getByRole("button", { name: "Receive" }).click();
  await expect(page.getByText(/Received\. The product now costs \$\d+\.\d{2} a unit on average\./)).toBeVisible();
  const move = page.getByTestId("transfer-form");
  await move.getByLabel("Product").selectOption({ label: "Demand CS (fl oz)" });
  await move.getByLabel("From").selectOption({ label: "Main office warehouse" });
  await move.getByLabel("To").selectOption({ label: "Truck: Sam Rivera" });
  await move.getByLabel("Quantity").fill("8");
  await move.getByRole("button", { name: "Move" }).click();
  await expect(page.getByText("Moved.")).toBeVisible();
  await expect(page.getByTestId("movement-row").filter({ hasText: `PS-${stamp}` })).toBeVisible();
  await page.screenshot({ path: "test-results/inventory.png", fullPage: true });
  await signOut(page);

  // 2. A stop for Sam today: Maria's fresh plan, put on his route.
  await signIn(page, seedUserEmail(northwind, "owner"));
  await page.goto("/customers?q=Maria");
  await page.getByRole("link", { name: "Maria Lopez" }).click();
  await page.getByRole("link", { name: "New agreement" }).click();
  await page.getByLabel("Service type").selectOption({ label: "General pest plan" });
  await page.locator("#new-initial").fill("199.00");
  await page.locator("#new-recurring").fill("99.00");
  await page.locator("#new-starts").fill(today);
  await page.locator("#new-first").fill(today);
  await page.locator("#new-notes").fill(`e2e inventory ${stamp}`);
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByLabel("Customer's typed name").fill("Maria Lopez");
  await page.getByLabel("The customer agrees to the terms above").check();
  await page.getByRole("button", { name: "Sign and activate" }).click();
  await page.waitForLoadState("networkidle");
  const visitUrl = (await page.getByRole("link", { name: "Visit 1 on the dispatch board" }).getAttribute("href")) as string;
  const visitId = visitUrl.split("/").pop() as string;
  await page.goto(visitUrl);
  await page.getByLabel("Technician (lead)").selectOption({ label: "Sam Rivera" });
  await page.getByLabel("Date").fill(today);
  await page.getByRole("button", { name: "Schedule visit" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/lead Sam Rivera/)).toBeVisible();
  await signOut(page);

  // 3. Sam clocks in with no signal; it syncs when the signal is back. The truck shows what was loaded.
  await signIn(page, seedUserEmail(northwind, "technician"));
  await page.goto("/tech");
  await expect(page.getByTestId("clock-bar")).toBeVisible();
  // A previous run may have left Sam clocked in; start from clocked out.
  if ((await page.getByTestId("clock-state").textContent())?.includes("Clocked in")) {
    await page.getByRole("button", { name: "Clock out" }).click();
    await expect(page.getByTestId("pending-count")).toHaveText("All changes synced", { timeout: 30_000 });
  }
  await context.setOffline(true);
  await expect(page.getByTestId("online-state")).toContainText("Offline");
  await page.getByRole("button", { name: "Clock in" }).click();
  await expect(page.getByTestId("clock-state")).toContainText("Clocked in since");
  await expect(page.getByTestId("pending-count")).toContainText("waiting to sync");
  await context.setOffline(false);
  await expect(page.getByTestId("pending-count")).toHaveText("All changes synced", { timeout: 30_000 });
  const [open] = await sql<{ n: number }[]>`
    select count(*)::int as n from public.time_entries e join auth.users u on u.id = e.user_id where e.tenant_id = ${tenant.id} and u.email = ${seedUserEmail(northwind, "technician")} and e.ended_at is null and e.source = 'app'`;
  expect(open.n).toBe(1);
  const before = await truckDemand(page);

  // 4. The stop: 2 fl oz of Demand CS, then done. It comes off the truck.
  await page.goto(`/tech?visit=${visitId}`);
  await page.getByRole("button", { name: "On my way" }).click();
  await page.getByRole("button", { name: "Arrived" }).click();
  await expect(page.getByTestId("stop-status")).toHaveText("On site");
  const products = page.getByTestId("products");
  await products.getByRole("button", { name: "Add product" }).click();
  await products.getByLabel("Product").selectOption({ label: "Demand CS (100-1066)" });
  await products.getByLabel("Amount").fill("2");
  await products.getByLabel("Mixed into (optional)").fill("1");
  await products.getByLabel("Site treated").fill("perimeter");
  await products.getByLabel("Where exactly").fill("North foundation");
  await products.getByLabel("Target pests").fill("ants");
  await products.getByRole("button", { name: "Save product" }).click();
  const confirm = products.getByLabel("I checked the label and this amount is right");
  if (await confirm.isVisible()) {
    await confirm.check();
    await products.getByRole("button", { name: "Save product" }).click();
  }
  await expect(products.getByText("Demand CS")).toBeVisible();
  const conditions = page.getByTestId("conditions");
  await conditions.getByLabel("Temperature (F)").fill("68");
  await conditions.getByLabel("Wind (mph)").fill("5");
  await conditions.getByLabel("Sky").fill("clear");
  await conditions.getByRole("button", { name: "Save conditions" }).click();
  const canvas = page.getByLabel("Sign above");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox()) as { x: number; y: number; width: number; height: number };
  await page.mouse.move(box.x + 20, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 40, { steps: 8 });
  await page.mouse.move(box.x + 220, box.y + 90, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Save signature" }).click();
  const areas = page.getByTestId("areas");
  await areas.getByLabel("Perimeter").check();
  await areas.getByLabel("Target pests (comma separated)").fill("ants");
  await areas.getByRole("button", { name: "Save areas and pests" }).click();
  await page.getByRole("button", { name: "Complete visit" }).click();
  await expect(page.getByTestId("stop-status")).toHaveText("Done");
  await expect(page.getByTestId("pending-count")).toHaveText("All changes synced", { timeout: 30_000 });
  const after = await truckDemand(page);
  expect(after).toBeCloseTo(before - 2, 4);
  await page.screenshot({ path: "test-results/inventory-truck.png", fullPage: true });
  await page.goto("/tech");
  await page.getByRole("button", { name: "Clock out" }).click();
  await expect(page.getByTestId("clock-state")).toHaveText("Not clocked in");
  await signOut(page);

  // 5. The owner sees the visit's margin.
  await signIn(page, seedUserEmail(northwind, "owner"));
  await page.goto(`/reports/job-costing?from=${today}&to=${today}&group=visit`);
  const row = page.getByTestId("costing-row").filter({ hasText: "Maria Lopez" }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("$199.00");
  await page.screenshot({ path: "test-results/job-costing.png", fullPage: true });
  await signOut(page);

  // 6. The bookkeeper exports last week and posts the payroll register.
  await signIn(page, seedUserEmail(northwind, "bookkeeper"));
  await page.goto("/payroll");
  // Sam's pay from today on: production with a draw (the period being exported keeps the rate it ended under).
  const rate = page.getByTestId("rate-form");
  await rate.getByLabel("Person").selectOption({ label: "Sam Rivera" });
  await rate.getByLabel("Pay", { exact: true }).selectOption("production");
  await rate.getByLabel("Production percent").fill("23");
  await rate.getByLabel("Draw per period").fill("800.00");
  await rate.getByLabel("Labor cost per hour").fill("33.00");
  await rate.getByRole("button", { name: "Save pay" }).click();
  await expect(page.getByText("Pay saved.")).toBeVisible();
  await expect(page.getByTestId("pay-rate-row").filter({ hasText: "Sam Rivera" })).toContainText("23% of production");
  const exportButton = page.getByRole("button", { name: "Export this period" });
  if (await exportButton.isVisible()) {
    await expect(page.getByTestId("payroll-preview").filter({ hasText: "Sam Rivera" })).toBeVisible();
    await exportButton.click();
    await expect(page.getByText("Exported. Download the file for the payroll provider.")).toBeVisible();
  }
  const latest = page.getByTestId("pay-period").first();
  const href = (await latest.getByTestId("payroll-csv").getAttribute("href")) as string;
  const csv = await (await page.request.get(href)).text();
  expect(csv.split("\r\n")[0]).toContain("payroll_id,name,email,pay_kind,hours");
  expect(csv.split("\r\n")[0]).toContain("production_pay");
  expect(csv.split("\r\n")[0]).toContain("commissions");
  expect(csv).toMatch(/Sam Rivera,technician@northwind\.test,production,\d+\.\d{2}/);
  const post = latest.getByTestId("post-payroll");
  if (await post.isVisible()) {
    await post.getByLabel("Gross wages").fill("5000.00");
    await post.getByLabel("Employer taxes").fill("382.50");
    await post.getByLabel("Withholdings").fill("1100.00");
    await post.getByLabel("Net pay").fill("3900.00");
    const commissions = Number(await post.getByLabel("Commissions paid").inputValue());
    expect(commissions).toBeLessThanOrEqual(5000);
    await post.getByRole("button", { name: "Post payroll" }).click();
    await expect(page.getByText("Payroll posted to the ledger.")).toBeVisible();
  }
  await page.screenshot({ path: "test-results/payroll.png", fullPage: true });
  await page.goto("/ledger/journal?source_type=payroll");
  const entry = page.getByTestId("journal-row").first();
  await expect(entry).toBeVisible();
  await entry.getByRole("link").first().click();
  await expect(page.getByTestId("journal-line").filter({ hasText: "Technician labor" })).toBeVisible();
  await expect(page.getByTestId("journal-line").filter({ hasText: "Payroll liabilities" })).toBeVisible();
  await signOut(page);

  // 7. Another company sees none of it.
  await signIn(page, seedUserEmail(lakeshore, "owner"));
  await page.goto("/inventory");
  await expect(page.getByTestId("movement-row").filter({ hasText: `PS-${stamp}` })).toHaveCount(0);
  await page.goto(`/reports/job-costing?from=${today}&to=${today}&group=visit`);
  await expect(page.getByTestId("costing-row").filter({ hasText: "Maria Lopez" })).toHaveCount(0);
  await signOut(page);
  await sql.end();
});
