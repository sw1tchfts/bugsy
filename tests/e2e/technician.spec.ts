import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { todayInZone } from "../../lib/dates";
import { SEED_PASSWORD, SEED_TENANTS, seedUserEmail } from "../../scripts/seed-data";

const [northwind, lakeshore] = SEED_TENANTS;

// A 1x1 PNG, the smallest photo a phone could hand over.
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
}

async function setLanguage(page: Page, locale: "en" | "es") {
  await page.goto("/tech");
  await page.locator("#tech-locale").selectOption(locale);
  await page.locator("#tech-locale").locator("..").getByRole("button", { name: "OK" }).click();
  await page.waitForLoadState("networkidle");
}

test("a technician works a stop offline, syncs it, the office sees the record, and the app speaks Spanish", async ({ page, context }) => {
  test.setTimeout(180_000);
  const today = todayInZone(northwind.timezone);
  const stamp = Date.now();

  // Setup as the owner: Maria gets a fresh signed agreement whose first visit is due today.
  await signIn(page, seedUserEmail(northwind, "owner"));
  await page.goto("/customers?q=Maria");
  await page.getByRole("link", { name: "Maria Lopez" }).click();
  await page.getByRole("link", { name: "New agreement" }).click();
  await page.getByLabel("Service type").selectOption({ label: "General pest plan" });
  await page.locator("#new-initial").fill("199.00");
  await page.locator("#new-recurring").fill("99.00");
  await page.locator("#new-starts").fill(today);
  await page.locator("#new-first").fill(today);
  await page.locator("#new-notes").fill(`e2e technician ${stamp}`);
  // Billed per visit, so the stop invoices itself when it completes and cash taken at the door lands on it.
  await page.locator("#new-billing").selectOption("per_visit");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/agreements\/[0-9a-f-]+$/);
  await page.getByLabel("Customer's typed name").fill("Maria Lopez");
  await page.getByLabel("The customer agrees to the terms above").check();
  await page.getByRole("button", { name: "Sign and activate" }).click();
  await page.waitForLoadState("networkidle");
  const visitHref = await page.getByRole("link", { name: "Visit 1 on the dispatch board" }).getAttribute("href");
  const visitUrl = visitHref as string;
  const visitId = visitUrl.split("/").pop() as string;
  await signOut(page);

  // The dispatcher puts the visit on Sam Rivera's route for today.
  await signIn(page, seedUserEmail(northwind, "dispatcher"));
  await page.goto(visitUrl);
  await page.getByLabel("Technician (lead)").selectOption({ label: "Sam Rivera" });
  await page.getByLabel("Date").fill(today);
  await page.getByRole("button", { name: "Schedule visit" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/lead Sam Rivera/)).toBeVisible();
  await signOut(page);

  // Sam opens the app online (in English, whatever a previous run left), so the route and the shell are cached.
  await signIn(page, seedUserEmail(northwind, "technician"));
  await setLanguage(page, "en");
  await expect(page.getByRole("heading", { name: "My route" })).toBeVisible();
  const stop = page.locator(`[data-testid="route-stop"][href="/tech?visit=${visitId}"]`);
  await expect(stop).toBeVisible();

  // The signal drops. Against a production server (npm run build, npx next start -p 3001, E2E_BASE_URL) the app
  // reloads its shell from the service worker and the route from IndexedDB. The dev server's HMR runtime does not
  // hydrate a page without a connection, so there the stop is opened first and the signal drops on it.
  const devServer = (await (await page.request.get("/tech")).text()).includes("hmr-client");
  if (devServer) {
    await stop.click();
    await expect(page.getByTestId("stop-status")).toHaveText("Scheduled");
    await context.setOffline(true);
  } else {
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.reload();
    await expect(stop).toBeVisible();
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText("Showing the route saved on this phone.")).toBeVisible();
    await stop.click();
  }
  await expect(page.getByTestId("online-state")).toContainText("Offline");
  await expect(page).toHaveURL(new RegExp(`/tech\\?visit=${visitId}`));
  await expect(page.getByTestId("stop-status")).toHaveText("Scheduled");

  await page.getByRole("button", { name: "On my way" }).click();
  await expect(page.getByTestId("stop-status")).toHaveText("On my way");
  await page.getByRole("button", { name: "Arrived" }).click();
  await expect(page.getByTestId("stop-status")).toHaveText("On site");
  await expect(page.getByText(/Arrived \d/)).toBeVisible();

  // A product above the label rate: the warning must be acknowledged before the line saves.
  const products = page.getByTestId("products");
  await products.getByRole("button", { name: "Add product" }).click();
  await products.getByLabel("Product").selectOption({ label: "Demand CS (100-1066)" });
  await products.getByLabel("Amount").fill("2");
  await products.getByLabel("Mixed into (optional)").fill("1");
  await products.getByLabel("Site treated").fill("perimeter");
  await products.getByLabel("Where exactly").fill("North foundation");
  await products.getByLabel("Target pests").fill("ants");
  await expect(products.getByTestId("label-check")).toContainText("Above the label rate");
  await products.getByRole("button", { name: "Save product" }).click();
  await expect(products.getByText("Confirm the amount against the label before saving.")).toBeVisible();
  await products.getByLabel("I checked the label and this amount is right").check();
  await products.getByRole("button", { name: "Save product" }).click();
  await expect(products.getByText("Demand CS")).toBeVisible();
  await expect(products.getByText("Above the label rate")).toBeVisible();

  // A note, a recommendation, the conditions by hand (no weather without a signal), a photo and the signature.
  const notes = page.getByTestId("notes");
  await notes.getByLabel("What you found and what you did").fill("Ant trail along the north foundation.");
  await notes.getByRole("button", { name: "Add note" }).click();
  await notes.getByLabel("Notes and recommendations").selectOption("recommendation");
  await notes.getByLabel("What you found and what you did").fill("Trim the shrubs back from the siding.");
  await notes.getByRole("button", { name: "Add note" }).click();
  await expect(notes.getByText("Trim the shrubs back from the siding.")).toBeVisible();

  const conditions = page.getByTestId("conditions");
  await conditions.getByLabel("Temperature (F)").fill("68");
  await conditions.getByLabel("Wind (mph)").fill("5");
  await conditions.getByLabel("Sky").fill("clear");
  await conditions.getByRole("button", { name: "Save conditions" }).click();

  await page.getByTestId("photo-input").setInputFiles({ name: "foundation.png", mimeType: "image/png", buffer: TINY_PNG });
  await expect(page.getByTestId("photos").locator("li", { hasText: "Other" })).toBeVisible();

  const canvas = page.getByLabel("Sign above");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox()) as { x: number; y: number; width: number; height: number };
  await page.mouse.move(box.x + 20, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 40, { steps: 8 });
  await page.mouse.move(box.x + 220, box.y + 90, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Save signature" }).click();
  await expect(page.getByTestId("signature-saved")).toContainText("Signed by Maria Lopez");

  // Completion is gated: no areas are marked yet.
  await page.getByRole("button", { name: "Complete visit" }).click();
  const gaps = page.getByTestId("gaps");
  await expect(gaps).toContainText("Areas treated");
  await expect(page.getByTestId("stop-status")).toHaveText("On site");
  await page.screenshot({ path: "test-results/technician-gaps.png", fullPage: true });

  const areas = page.getByTestId("areas");
  await areas.getByLabel("Perimeter").check();
  await areas.getByLabel("Target pests (comma separated)").fill("ants");
  await areas.getByRole("button", { name: "Save areas and pests" }).click();
  await page.getByRole("button", { name: "Complete visit" }).click();
  await expect(page.getByTestId("stop-status")).toHaveText("Done");

  // Maria pays the stop in cash; the payment queues behind the completion and lands on the stop's invoice at sync.
  const payment = page.getByTestId("payment");
  await expect(payment).toContainText("This stop bills $199.00");
  await payment.getByLabel("Paid by").selectOption("cash");
  await payment.getByLabel("Amount ($)").fill("199.00");
  await payment.getByLabel("Check number or note").fill("paid at the door");
  await payment.getByRole("button", { name: "Record payment" }).click();
  await expect(payment.getByTestId("payment-taken")).toContainText("$199.00 taken by Cash");
  await expect(page.getByTestId("pending-count")).toContainText("waiting to sync");
  await page.screenshot({ path: "test-results/technician-offline.png", fullPage: true });

  // Back online: the queue drains in order and the server agrees with the device.
  await context.setOffline(false);
  await expect(page.getByTestId("online-state")).toHaveText("Online");
  await expect(page.getByTestId("pending-count")).toHaveText("All changes synced", { timeout: 30_000 });
  await expect(page.getByTestId("stop-status")).toHaveText("Done");
  await expect(page.getByTestId("rejected")).toHaveCount(0);
  await page.getByRole("link", { name: "Visit summary" }).click();
  await expect(page.getByTestId("visit-summary")).toContainText("Demand CS");
  await expect(page.getByTestId("signature-image")).toBeVisible();

  // Another company's file does not exist for Sam.
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1, prepare: false, onnotice: () => {} });
  const [lakeshoreFile] = await sql<{ id: string }[]>`
    select f.id from public.files f join public.tenants t on t.id = f.tenant_id where t.name = ${lakeshore.name} limit 1`;
  // The cash from the door is a payment on the visit, allocated to the invoice the completion raised (spec 08 rule 15).
  const [cash] = await sql<{ method: string; amount_cents: string; allocated: string | null; source_key: string | null; invoice_status: string | null }[]>`
    select p.method, p.amount_cents::text, a.amount_cents::text as allocated, i.source_key, i.status as invoice_status
    from public.payments p left join public.payment_allocations a on a.payment_id = p.id left join public.invoices i on i.id = a.invoice_id
    where p.visit_id = ${visitId}`;
  // The completion sent Maria the visit summary (spec 11 rule 8); its page carries what was applied.
  const [summary] = await sql<{ status: string; channel: string; token: string; held: boolean }[]>`
    select status, channel, token, send_after > now() as held from public.messages where visit_id = ${visitId} and purpose = 'summary'`;
  await sql.end();
  expect(cash).toMatchObject({ method: "cash", amount_cents: "19900", allocated: "19900", source_key: `visit:${visitId}`, invoice_status: "paid" });
  // Delivered at once, or, as a text after the company's texting hours, held for the morning (rule 4).
  if (summary?.status === "queued") expect(summary).toMatchObject({ channel: "sms", held: true });
  else expect(summary?.status).toBe("delivered");
  const summaryPage = await page.request.get(`/m/${summary.token}`);
  expect(summaryPage.status()).toBe(200);
  expect(await summaryPage.text()).toContain("100-1066");
  expect(lakeshoreFile, "the seed stores Lakeshore files").toBeTruthy();
  const foreign = await page.request.get(`/api/files/${lakeshoreFile.id}`);
  expect(foreign.status()).toBe(404);

  // Spanish sticks to the membership.
  await setLanguage(page, "es");
  await expect(page.getByRole("heading", { name: "Mi ruta" })).toBeVisible();
  await page.goto("/tech");
  await expect(page.getByRole("heading", { name: "Mi ruta" })).toBeVisible();
  await page.screenshot({ path: "test-results/technician-spanish.png", fullPage: true });
  await setLanguage(page, "en");
  await expect(page.getByRole("heading", { name: "My route" })).toBeVisible();
  await signOut(page);

  // The dispatcher sees what Sam recorded, with the times, and cannot move the finished visit.
  await signIn(page, seedUserEmail(northwind, "dispatcher"));
  await page.goto(visitUrl);
  const recorded = page.getByTestId("visit-summary");
  await expect(recorded).toContainText("Demand CS");
  await expect(recorded).toContainText("100-1066");
  await expect(recorded).toContainText("Above the label rate");
  await expect(recorded).toContainText("Ant trail along the north foundation.");
  await expect(recorded).toContainText("Trim the shrubs back from the siding.");
  await expect(recorded).toContainText("68 F, 5 mph, clear");
  await expect(recorded).toContainText(/Arrived \w+ \d/);
  await expect(recorded).toContainText(/Completed \w+ \d/);
  await expect(recorded.getByTestId("signature-image")).toBeVisible();
  await page.screenshot({ path: "test-results/technician-office.png", fullPage: true });
  await signOut(page);
});
