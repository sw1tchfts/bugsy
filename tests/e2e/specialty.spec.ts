import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { addMonths, daysBetween, endOfMonth, todayInZone } from "../../lib/dates";
import { BED_BUG_PREP, WARRANTY_FEE_CENTS } from "../../scripts/seed-specialty";
import { SEED_PASSWORD, SEED_TENANTS, seedUserEmail } from "../../scripts/seed-data";

const [northwind, lakeshore] = SEED_TENANTS;
// A 1x1 PNG: the signed authorization form's photo.
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

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

async function setEnglish(page: Page) {
  await page.goto("/tech");
  await page.locator("#tech-locale").selectOption("en");
  await page.locator("#tech-locale").locator("..").getByRole("button", { name: "OK" }).click();
  await page.waitForLoadState("networkidle");
}

/** Sells a job from the agreement form with the service type's own plan, signs it, and returns the agreement URL. */
async function sellJob(page: Page, ids: { account_id: string; property_id: string }, serviceType: string, initial: string, recurring: string, startsOn: string, stamp: number) {
  await page.goto(`/agreements/new?account_id=${ids.account_id}&property_id=${ids.property_id}`);
  await page.getByLabel("Service type").selectOption({ label: serviceType });
  await page.locator("#new-cadence").selectOption("job_plan");
  await page.locator("#new-billing").selectOption("per_visit");
  await page.locator("#new-initial").fill(initial);
  await page.locator("#new-recurring").fill(recurring);
  await page.locator("#new-starts").fill(startsOn);
  await page.locator("#new-first").fill(startsOn);
  await page.locator("#new-term").fill("2");
  await page.locator("#new-notes").fill(`e2e ${stamp}`);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/agreements\/[0-9a-f-]+$/);
  const url = page.url();
  await page.getByLabel("Customer's typed name").fill("Customer");
  await page.getByLabel("The customer agrees to the terms above").check();
  await page.getByRole("button", { name: "Sign and activate" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
  return url;
}

async function firstVisitId(page: Page): Promise<string> {
  const href = (await page.getByRole("link", { name: "Visit 1 on the dispatch board" }).getAttribute("href")) as string;
  return href.split("/").pop() as string;
}

async function schedule(page: Page, visitId: string, date: string) {
  await page.goto(`/dispatch/visits/${visitId}`);
  await page.getByLabel("Technician (lead)").selectOption({ label: "Sam Rivera" });
  await page.getByLabel("Date").fill(date);
  await page.getByRole("button", { name: "Schedule visit" }).click();
  await page.waitForLoadState("networkidle");
}

async function openStop(page: Page, visitId: string) {
  await page.goto(`/tech?visit=${visitId}`);
  await expect(page.getByTestId("stop-status")).toHaveText("Scheduled");
  await page.getByRole("button", { name: "Arrived" }).click();
  await expect(page.getByTestId("stop-status")).toHaveText("On site");
}

async function synced(page: Page) {
  await expect(page.getByTestId("pending-count")).toHaveText("All changes synced", { timeout: 30_000 });
}

test("specialty jobs: a bed bug plan with its prep check, a wildlife job held for the owner's authorization, an issued WDI report, and a warranty earned by the day", async ({ page }) => {
  test.setTimeout(300_000);
  const today = todayInZone(northwind.timezone);
  const stamp = Date.now();
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1, prepare: false, onnotice: () => {} });
  const place = async (account: string, property: string) =>
    (
      await sql<{ account_id: string; property_id: string }[]>`
        select a.id as account_id, p.id as property_id from public.accounts a join public.properties p on p.account_id = a.id join public.tenants t on t.id = a.tenant_id
        where t.name = ${northwind.name} and a.name = ${account} and p.name = ${property} order by p.created_at limit 1`
    )[0];
  const harbor = await place("Harbor View Apartments", "Building A");
  const green = await place("Green Residence", "Home");
  const [wdi] = await sql<{ visit_id: string }[]>`
    select v.id as visit_id from public.visits v join public.agreements a on a.id = v.agreement_id join public.tenants t on t.id = a.tenant_id
    where t.name = ${northwind.name} and a.notes = 'seed:lopez-wdi' order by v.due_start limit 1`;
  const [warranty] = await sql<{ number: number; starts_on: string; term_months: number }[]>`
    select a.number, a.starts_on::text, a.term_months from public.agreements a join public.tenants t on t.id = a.tenant_id where t.name = ${northwind.name} and a.notes = 'seed:patel-warranty'`;
  expect(harbor && green && wdi && warranty, "the seed has the specialty customers, the WDI inspection and the warranty").toBeTruthy();

  // 1. The office sells a bed bug job: the service type's plan gives three visits on its offsets.
  await signIn(page, seedUserEmail(northwind, "owner"));
  const bedBugUrl = await sellJob(page, harbor, "Bed bug treatment", "650.00", "0.00", today, stamp);
  const rows = page.getByTestId("agreement-visit");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Treatment");
  await expect(rows.nth(1)).toContainText("Follow-up");
  await expect(rows.nth(2)).toContainText("Final follow-up");
  const bedBugVisit = await firstVisitId(page);
  const offsets = await sql<{ due_start: string; step_label: string }[]>`select due_start::text, step_label from public.visits where agreement_id = (select agreement_id from public.visits where id = ${bedBugVisit}) order by due_start`;
  expect(offsets.map((o) => daysBetween(today, o.due_start))).toEqual([0, 14, 28]);
  await page.screenshot({ path: "test-results/specialty-bedbug-job.png", fullPage: true });
  await schedule(page, bedBugVisit, today);
  await expect(page.getByText(/lead Sam Rivera/)).toBeVisible();

  // 2. The office sells a wildlife job; dispatch refuses the trapping until the owner's authorization is on file.
  const wildlifeUrl = await sellJob(page, green, "Wildlife removal and exclusion", "350.00", "75.00", today, stamp);
  const wildlifeVisit = await firstVisitId(page);
  await schedule(page, wildlifeVisit, today);
  await expect(page.getByText(/authorization is not on file/).first()).toBeVisible();
  await expect(page.getByText("Not scheduled yet.", { exact: false })).toBeVisible();
  await page.goto(wildlifeUrl);
  await page.getByLabel("Signed by").fill("Dana Green");
  await page.getByLabel("Relationship to the property").selectOption("owner");
  await page.getByLabel("Scope").fill("Traps on the grounds and in the attic");
  await page.locator("#auth_file").setInputFiles({ name: "authorization.png", mimeType: "image/png", buffer: TINY_PNG });
  await page.getByRole("button", { name: "Record authorization" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("authorization").filter({ hasText: "Dana Green" })).toContainText("Signed form");
  await schedule(page, wildlifeVisit, today);
  await expect(page.getByText(/lead Sam Rivera/)).toBeVisible();
  await signOut(page);

  // 3. The technician: the bed bug stop asks for the prep check before it completes.
  await signIn(page, seedUserEmail(northwind, "technician"));
  await setEnglish(page);
  await openStop(page, bedBugVisit);
  const prep = page.getByTestId("prep-check");
  await expect(prep).toContainText(BED_BUG_PREP[0]);
  const products = page.getByTestId("products");
  await products.getByRole("button", { name: "Add product" }).click();
  await products.getByLabel("Product").selectOption({ label: "Demand CS (100-1066)" });
  await products.getByLabel("Amount").fill("1");
  await products.getByLabel("Site treated").fill("interior");
  await products.getByLabel("Target pests").fill("bed bugs");
  await products.getByRole("button", { name: "Save product" }).click();
  await expect(products.getByText("Demand CS")).toBeVisible();
  const areas = page.getByTestId("areas");
  await areas.getByLabel("Interior").check();
  await areas.getByLabel("Target pests (comma separated)").fill("bed bugs");
  await areas.getByRole("button", { name: "Save areas and pests" }).click();
  const notes = page.getByTestId("notes");
  await notes.getByLabel("What you found and what you did").fill("Treated bedrooms 1 and 2; harborages along the headboards.");
  await notes.getByRole("button", { name: "Add note" }).click();
  await page.getByRole("button", { name: "Complete visit" }).click();
  await expect(page.getByTestId("gaps")).toContainText("Whether the unit was ready (prep check)");
  await prep.getByText("Not ready", { exact: true }).click();
  await prep.getByLabel(`Tick what was not done: ${BED_BUG_PREP[1]}`).check();
  await prep.getByRole("button", { name: "Save prep check" }).click();
  await expect(prep.getByTestId("prep-saved")).toContainText("not ready");
  await page.getByRole("button", { name: "Complete visit" }).click();
  await expect(page.getByTestId("stop-status")).toHaveText("Done");
  await synced(page);
  await page.screenshot({ path: "test-results/specialty-prep-check.png", fullPage: true });

  // 4. The wildlife stop: a capture and billable materials, then complete.
  await openStop(page, wildlifeVisit);
  const captures = page.getByTestId("captures");
  await expect(captures).toContainText("Landowner authorization on file.");
  await captures.getByLabel("Species").fill("Raccoon");
  await captures.getByLabel("How many").fill("1");
  await captures.getByLabel("What happened to it").selectOption("relocated");
  await captures.getByLabel("Where (trap location)").fill("Attic, by the soffit");
  await captures.getByRole("button", { name: "Log capture" }).click();
  await expect(captures.getByText(/1 x Raccoon: Relocated/)).toBeVisible();
  const materials = page.getByTestId("materials");
  await materials.getByLabel("Material").fill("Hardware cloth");
  await materials.getByLabel("Quantity").fill("6");
  await materials.getByLabel("Unit", { exact: true }).fill("sq ft");
  await materials.getByLabel("Price per unit ($)").fill("4.50");
  await materials.getByRole("button", { name: "Add material" }).click();
  await expect(materials.getByText(/Hardware cloth: 6 sq ft, \$27\.00/)).toBeVisible();
  await notes.getByLabel("What you found and what you did").fill("Set two traps in the attic; one raccoon caught and relocated.");
  await notes.getByRole("button", { name: "Add note" }).click();
  await page.getByRole("button", { name: "Complete visit" }).click();
  await expect(page.getByTestId("stop-status")).toHaveText("Done");
  await synced(page);
  await page.screenshot({ path: "test-results/specialty-wildlife-stop.png", fullPage: true });
  await signOut(page);

  // The materials became their own invoice for the visit.
  const [invoice] = await sql<{ total_cents: string; status: string }[]>`select total_cents, status from public.invoices where source_key = ${`materials:${wildlifeVisit}`}`;
  expect(invoice, "the billable materials are invoiced at completion").toBeTruthy();
  expect(Number(invoice.total_cents)).toBe(2700);

  // 5. The office sees the job records on both agreements.
  await signIn(page, seedUserEmail(northwind, "owner"));
  await page.goto(bedBugUrl);
  await expect(page.getByTestId("prep-row")).toContainText("not ready");
  await page.goto(wildlifeUrl);
  await expect(page.getByTestId("capture-row")).toContainText("Raccoon");
  await expect(page.getByTestId("material-row")).toContainText("$27.00");
  await page.screenshot({ path: "test-results/specialty-wildlife-job.png", fullPage: true });

  // 6. A warranty's recognition for its first ended month is the fee times that month's days over the year's days.
  const firstMonth = warranty.starts_on.slice(0, 7);
  const year = daysBetween(warranty.starts_on, addMonths(warranty.starts_on, warranty.term_months));
  const monthDays = daysBetween(warranty.starts_on, endOfMonth(warranty.starts_on)) + 1;
  const expected = Math.round((WARRANTY_FEE_CENTS * monthDays) / year);
  const memo = `Warranty earned for ${firstMonth}, agreement #${warranty.number},`;
  await page.goto(`/ledger/journal?source_type=recognition&q=${encodeURIComponent(memo)}`);
  const entry = page.getByTestId("journal-row").filter({ hasText: memo });
  await expect(entry).toHaveCount(1);
  await entry.getByRole("link").first().click();
  await expect(page.getByTestId("journal-line").filter({ hasText: "Termite revenue" })).toContainText(`$${(expected / 100).toFixed(2)}`);
  await page.screenshot({ path: "test-results/specialty-warranty-entry.png", fullPage: true });
  await signOut(page);

  // 7. The licensed inspector writes and issues the WDI report; once issued it offers no edit.
  await signIn(page, seedUserEmail(northwind, "compliance_manager"));
  await page.goto(`/visits/${wdi.visit_id}/wdi`);
  await expect(page.getByRole("heading", { name: /WDI report/ })).toBeVisible();
  await page.getByLabel("Areas inspected").fill("Crawlspace, basement, garage, attic");
  await page.getByLabel("Areas not inspected and why (or none)").fill("None");
  for (const label of ["Live wood-destroying insects", "Dead insects, wings or shed parts", "Visible damage", "Evidence of previous treatment"]) {
    await page.getByLabel(`${label}: seen`).selectOption("no");
  }
  await page.getByLabel("Mud tubes, frass or exit holes: seen").selectOption("yes");
  await page.getByLabel("Mud tubes, frass or exit holes: where").fill("Old tubes on the garage foundation, inactive");
  await page.getByLabel("Treatment recommended").selectOption("no");
  await page.getByRole("button", { name: "Issue the report" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Report issued. It can no longer change.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /WDI report No\. \d+/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0);
  await expect(page.getByTestId("finding-evidence")).toContainText("Old tubes on the garage foundation");
  const print = await page.request.get(`/visits/${wdi.visit_id}/wdi/print`);
  expect(print.status()).toBe(200);
  expect(print.headers()["content-security-policy"]).toContain("sandbox");
  expect(await print.text()).toMatch(/Wood-destroying insect inspection report No\. \d+/);
  await page.screenshot({ path: "test-results/specialty-wdi-issued.png", fullPage: true });
  const [issued] = await sql<{ status: string; number: number }[]>`select status, number from public.wdi_reports where visit_id = ${wdi.visit_id}`;
  expect(issued.status).toBe("issued");
  await expect(sql`update public.wdi_reports set notes = 'changed' where visit_id = ${wdi.visit_id}`).rejects.toThrow(/kept as issued/);
  await signOut(page);

  // 8. Another company sees none of it.
  await signIn(page, seedUserEmail(lakeshore, "owner"));
  for (const url of [bedBugUrl, wildlifeUrl, `/visits/${wdi.visit_id}/wdi`]) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBe(404);
  }
  expect((await page.request.get(`/visits/${wdi.visit_id}/wdi/print`)).status()).toBe(404);
  await signOut(page);
  await sql.end();
});
