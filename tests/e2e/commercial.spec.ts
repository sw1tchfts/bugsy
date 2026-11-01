import { expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import postgres from "postgres";
import { floorPlan } from "../../lib/commercial/image";
import { todayInZone } from "../../lib/dates";
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
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
}

test("a commercial site: the office maps a device, the technician checks every device and adds one on the map, and the binder holds it all", async ({ page }) => {
  test.setTimeout(300_000);
  const today = todayInZone(northwind.timezone);
  const stamp = Date.now();
  const officeDevice = `E${stamp % 10000}`;
  const techDevice = `T${stamp % 10000}`;
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1, prepare: false, onnotice: () => {} });
  const [site] = await sql<{ id: string }[]>`
    select p.id from public.properties p join public.accounts a on a.id = p.account_id join public.tenants t on t.id = p.tenant_id
    where t.name = ${northwind.name} and a.name = 'Corner Bistro' order by p.created_at limit 1`;
  await sql.end();
  expect(site, "the seed gives Northwind the Corner Bistro site").toBeTruthy();

  // The office: the site has its seeded map and a hot trap; a new floor plan goes up and a device goes on the map.
  await signIn(page, seedUserEmail(northwind, "owner"));
  await page.getByRole("link", { name: "Sites", exact: true }).click();
  await page.getByTestId("site-row").filter({ hasText: "Corner Bistro" }).getByRole("link", { name: "Corner Bistro" }).click();
  await expect(page).toHaveURL(new RegExp(`/sites/${site.id}`));
  await expect(page.getByTestId("site-map")).toBeVisible();
  await expect(page.getByTestId("site-device").filter({ hasText: "MC 6" })).toContainText("hot");
  await page.locator("#map-file").setInputFiles({ name: "basement.png", mimeType: "image/png", buffer: Buffer.from(await floorPlan(400, 250)) });
  await page.locator("#map-name").fill(`Basement ${stamp}`);
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Floor plan added.")).toBeVisible();
  await page.locator("#dev-kind").selectOption("multi_catch");
  await page.locator("#dev-number").fill(officeDevice);
  await page.locator("#dev-location").fill("Office closet, behind the door");
  await page.getByRole("button", { name: "Add device" }).click();
  await expect(page.getByText(`Device ${officeDevice} added.`)).toBeVisible();
  const option = await page.getByTestId("place-device").locator("option", { hasText: `MC ${officeDevice}:` }).getAttribute("value");
  await page.getByTestId("place-device").selectOption(option as string);
  await page.getByTestId("site-map").click({ position: { x: 200, y: 120 } });
  await page.getByTestId("place-save").click();
  await expect(page.getByText("Device placed on the map.")).toBeVisible();
  await expect(page.locator(`[data-testid="site-map"] g[data-device="${officeDevice}"]`)).toHaveCount(1);
  await page.screenshot({ path: "test-results/commercial-site.png", fullPage: true });

  // A program agreement whose first visit is due today.
  await page.goto("/customers?q=Corner%20Bistro");
  await page.getByRole("link", { name: "Corner Bistro" }).click();
  await page.getByRole("link", { name: "New agreement" }).click();
  await page.getByLabel("Service type").selectOption({ label: "Commercial device service" });
  await page.locator("#new-initial").fill("150.00");
  await page.locator("#new-recurring").fill("120.00");
  await page.locator("#new-starts").fill(today);
  await page.locator("#new-first").fill(today);
  await page.locator("#new-notes").fill(`e2e commercial ${stamp}`);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/agreements\/[0-9a-f-]+$/);
  await page.getByLabel("Customer's typed name").fill("Corner Bistro manager");
  await page.getByLabel("The customer agrees to the terms above").check();
  await page.getByRole("button", { name: "Sign and activate" }).click();
  await page.waitForLoadState("networkidle");
  const visitUrl = (await page.getByRole("link", { name: "Visit 1 on the dispatch board" }).getAttribute("href")) as string;
  const visitId = visitUrl.split("/").pop() as string;
  await signOut(page);

  await signIn(page, seedUserEmail(northwind, "dispatcher"));
  await page.goto(visitUrl);
  await page.getByLabel("Technician (lead)").selectOption({ label: "Sam Rivera" });
  await page.getByLabel("Date").fill(today);
  await page.getByRole("button", { name: "Schedule visit" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/lead Sam Rivera/)).toBeVisible();
  await signOut(page);

  // The technician at the stop: completion is refused while devices are unchecked.
  await signIn(page, seedUserEmail(northwind, "technician"));
  await page.goto(`/tech?visit=${visitId}`);
  await page.getByRole("button", { name: "Arrived" }).click();
  await expect(page.getByTestId("stop-status")).toHaveText("On site");
  const devices = page.getByTestId("devices");
  await expect(devices.getByTestId("devices-progress")).toContainText("0 of");
  await page.getByRole("button", { name: "Complete visit" }).click();
  await expect(page.getByTestId("gaps")).toContainText("A check for every device in the program");

  // A new station added by tapping the map, in the same step.
  await devices.getByTestId("device-add").click();
  const add = devices.getByTestId("device-add-form");
  await add.getByLabel("Kind").selectOption("multi_catch");
  await add.getByLabel("Number").fill(techDevice);
  await add.getByLabel("Location", { exact: true }).fill("Hallway by the restrooms");
  await devices.getByTestId("tech-site-map").click({ position: { x: 120, y: 90 } });
  await expect(devices.getByText("Placed on the map.")).toBeVisible();
  await add.getByTestId("device-add-save").click();
  await expect(devices.locator(`[data-testid="device-row"][data-number="${techDevice}"]`)).toBeVisible();

  // Every device checked; trap 6 has activity. Rows re-sort and the route refreshes as checks land, so each pass
  // reads the next unchecked device's number and works on that row by number.
  for (let guard = 0; guard < 60; guard += 1) {
    const next = devices.locator('[data-testid="device-row"][data-checked="no"]').first();
    if ((await next.count()) === 0) break;
    const number = (await next.getAttribute("data-number")) as string;
    const target = devices.locator(`[data-testid="device-row"][data-number="${number}"]`);
    const form = devices.getByTestId(`check-form-${number}`);
    if (!(await form.isVisible())) await target.locator("button").first().click();
    await expect(form).toBeVisible();
    if (number === "6") {
      await form.getByTestId("check-activity").selectOption("medium");
      await form.getByTestId("check-count").fill("1");
      await form.getByTestId("check-pest").fill("house mouse");
    }
    await form.getByTestId("check-save").click();
    await expect(target).toHaveAttribute("data-checked", "yes");
  }
  const progress = (await devices.getByTestId("devices-progress").textContent()) as string;
  const [done, total] = progress.match(/\d+/g) as string[];
  expect(done).toBe(total);

  const recText = devices.getByLabel("What should be done");
  await recText.fill(`Seal the gap behind the dish machine (${stamp})`);
  await expect(recText).toHaveValue(`Seal the gap behind the dish machine (${stamp})`);
  await devices.getByTestId("recommendation-save").click();
  await expect(devices.getByTestId("tech-recommendation").filter({ hasText: String(stamp) })).toBeVisible();
  await page.screenshot({ path: "test-results/commercial-tech.png", fullPage: true });

  // The rest of the record: bait in the stations, conditions, areas, a note and the signature.
  const products = page.getByTestId("products");
  await products.getByRole("button", { name: "Add product" }).click();
  await products.getByLabel("Product").selectOption({ label: "Contrac Blox (12455-79)" });
  await products.getByLabel("Amount").fill("0.5");
  await products.getByLabel("Site treated").fill("bait stations");
  await products.getByLabel("Where exactly").fill("Exterior stations 1 to 4");
  await products.getByLabel("Target pests").fill("house mouse");
  await products.getByRole("button", { name: "Save product" }).click();
  await expect(products.getByText("Contrac Blox")).toBeVisible();
  const conditions = page.getByTestId("conditions");
  await conditions.getByLabel("Temperature (F)").fill("55");
  await conditions.getByLabel("Wind (mph)").fill("3");
  await conditions.getByLabel("Sky").fill("cloudy");
  await conditions.getByRole("button", { name: "Save conditions" }).click();
  const areas = page.getByTestId("areas");
  await areas.getByLabel("Devices").check();
  await areas.getByLabel("Target pests (comma separated)").fill("house mouse, flies");
  await areas.getByRole("button", { name: "Save areas and pests" }).click();
  const notes = page.getByTestId("notes");
  await notes.getByLabel("What you found and what you did").fill("Droppings at trap 6; caught one.");
  await notes.getByRole("button", { name: "Add note" }).click();
  const canvas = page.getByLabel("Sign above");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox()) as { x: number; y: number; width: number; height: number };
  await page.mouse.move(box.x + 20, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 40, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Save signature" }).click();
  await page.getByRole("button", { name: "Complete visit" }).click();
  await expect(page.getByTestId("stop-status")).toHaveText("Done");
  await expect(page.getByText("All changes synced")).toBeVisible({ timeout: 30_000 });
  // The completion reached the office: the stop stays done after the route reloads from the server.
  await page.reload();
  await expect(page.getByTestId("stop-status")).toHaveText("Done");
  await signOut(page);

  // The office sees the checks, the new station on the map, the trend and the recommendation; logs a sighting;
  // closes the overdue recommendation; and downloads the binder.
  await signIn(page, seedUserEmail(northwind, "office"));
  await page.goto(`/sites/${site.id}`);
  await expect(page.getByTestId("site-check").filter({ hasText: "MC 6" }).first()).toContainText("medium");
  await expect(page.locator(`[data-testid="site-map"] g[data-device="${techDevice}"]`)).toHaveCount(1);
  await expect(page.getByTestId("trend-row").first()).toBeVisible();
  await expect(page.getByTestId("recommendation-row").filter({ hasText: String(stamp) })).toBeVisible();
  await expect(page.getByTestId("device-event").filter({ hasText: techDevice }).first()).toContainText("at a visit");
  await page.locator("#sig-seen").fill(`${today}T09:30`);
  await page.locator("#sig-pest").fill("German cockroach");
  await page.locator("#sig-location").fill(`Bar back ${stamp}`);
  await page.getByRole("button", { name: "Log sighting" }).click();
  await expect(page.getByText("Sighting logged.")).toBeVisible();
  const overdue = page.getByTestId("recommendation-row").filter({ hasText: "Seal the gap under the rear dock door" });
  if ((await overdue.count()) > 0 && (await overdue.getAttribute("data-status")) !== "closed") {
    await overdue.getByLabel("Status").selectOption("closed");
    await overdue.getByLabel("Closing note").fill("Door sweep installed by the landlord.");
    await overdue.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Recommendation closed.")).toBeVisible();
  }
  await page.screenshot({ path: "test-results/commercial-office.png", fullPage: true });
  const binder = await page.request.get(`/api/sites/${site.id}/binder.zip?from=${today.slice(0, 4)}-01-01&to=${today}`);
  expect(binder.status()).toBe(200);
  const files = unzipSync(new Uint8Array(await binder.body()));
  const html = strFromU8(files["binder.html"]);
  expect(html).toContain("Corner Bistro");
  expect(html).toContain(techDevice);
  expect(html).toContain("Commercial device service");
  expect(html).toContain("12455-79");
  expect(strFromU8(files["device_checks.csv"])).toContain("medium");
  await signOut(page);

  // The other company sees none of it.
  await signIn(page, seedUserEmail(lakeshore, "owner"));
  expect((await page.request.get(`/sites/${site.id}`)).status()).toBe(404);
  expect((await page.request.get(`/api/sites/${site.id}/binder.zip`)).status()).toBe(404);
});
