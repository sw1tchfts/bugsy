import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { unzipSync } from "fflate";
import postgres from "postgres";
import { addDays, todayInZone } from "../../lib/dates";
import { SEED_PASSWORD, SEED_TENANTS, seedUserEmail } from "../../scripts/seed-data";

const [northwind, lakeshore] = SEED_TENANTS;
const FIXTURES = path.join(__dirname, "fixtures");

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

/** Replaces the test's own registry (kind e2e) with the given file, so Maria's address matches or stops matching. */
async function importRegistry(page: Page, file: string, year: number) {
  await page.goto("/compliance/registries");
  await page.locator("#reg-state").fill("OH");
  await page.locator("#reg-kind").fill("e2e");
  await page.locator("#reg-year").fill(String(year));
  await page.locator("#reg-file").setInputFiles(path.join(FIXTURES, file));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/registry row\(s\) loaded for OH e2e/)).toBeVisible();
}

// A week well ahead of the seed and of the dispatch test's dates.
const STARTS_ON = "2027-05-03";
const VISIT_DAY = "2027-05-04";

test("a licensed manager works the compliance home, amends a locked record, records notice proof, imports a registry that blocks dispatch until the advance notice is recorded, and exports for an inspector", async ({ page }) => {
  test.setTimeout(180_000);
  const today = todayInZone(northwind.timezone);
  const year = Number(today.slice(0, 4));
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1, prepare: false, onnotice: () => {} });
  const [record] = await sql<{ id: string; tenant_id: string; visit_id: string; property_id: string }[]>`
    select r.id, r.tenant_id, r.visit_id, v.property_id from public.application_records r join public.tenants t on t.id = r.tenant_id join public.visits v on v.id = r.visit_id
    where t.name = ${northwind.name} and r.status = 'locked' and r.complete order by r.business_date desc limit 1`;
  expect(record, "the seed locks one complete Northwind record").toBeTruthy();
  // A due notice of this run's own, so repeated runs never run out of seed notices to print.
  const [dueNotice] = await sql<{ id: string }[]>`
    insert into public.notices (tenant_id, kind, rule_key, required, dedupe_key, visit_id, property_id, recipient_name, recipient_address, channel, status)
    values (${record.tenant_id}, 'post_application', 'default', false, ${`e2e:${Date.now()}`}, ${record.visit_id}, ${record.property_id}, 'Maria Lopez', '1234 Neil Ave', 'print', 'due') returning id`;
  const [branch] = await sql<{ id: string; business_license_number: string; license_expires_on: string }[]>`
    select b.id, b.business_license_number, b.license_expires_on::text from public.branches b join public.tenants t on t.id = b.tenant_id
    where t.name = ${northwind.name} and b.license_expires_on is not null order by b.created_at limit 1`;
  await sql.end();
  expect(branch, "the seed gives the Northwind main branch a license").toBeTruthy();
  expect(record, "the seed locks one complete Northwind record").toBeTruthy();
  expect(dueNotice, "the seed leaves a Northwind post-application notice due").toBeTruthy();

  // The licensed manager's home: the 45-day credential alert and the branch license from the seed.
  await signIn(page, seedUserEmail(northwind, "compliance_manager"));
  await importRegistry(page, "registry-none.csv", year);
  await page.goto("/compliance");
  await expect(page.getByRole("heading", { name: "Compliance" })).toBeVisible();
  await expect(page.getByTestId("compliance-task").filter({ hasText: "Lee Thompson (OH certification) expires in 45 days" })).toBeVisible();
  await page.screenshot({ path: "test-results/compliance-home.png", fullPage: true });
  await page.goto("/compliance/licenses");
  const licenseForm = page.getByTestId(`branch-license-${branch.id}`);
  await expect(licenseForm.locator('input[name="business_license_number"]')).toHaveValue(branch.business_license_number);
  await expect(licenseForm.locator('input[name="license_expires_on"]')).toHaveValue(branch.license_expires_on);

  // The locked record: the snapshot carries Sam's credential; an amendment keeps the original beside the correction.
  await page.goto(`/compliance/records/${record.id}`);
  await expect(page.getByTestId("record-snapshot")).toContainText("OH-APP-1042");
  await expect(page.getByText("Demand CS")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lock now" })).toHaveCount(0);
  const stamp = Date.now();
  const wind = String(1 + (stamp % 99991));
  await page.locator("#amend-field").fill("conditions.wind_mph");
  await page.locator("#amend-value").fill(wind);
  await page.locator("#amend-reason").fill(`Gauge read again at the office (${stamp}).`);
  await page.getByRole("button", { name: "File amendment" }).click();
  await page.waitForLoadState("networkidle");
  const mine = page.getByTestId("amendment-row").filter({ hasText: `(${stamp})` });
  await expect(mine).toBeVisible();
  await expect(mine).toContainText("conditions.wind_mph");
  await expect(mine.locator("td").nth(5)).toHaveText(wind);
  await expect(mine.locator("td").nth(4)).not.toHaveText(wind);
  await expect(page.getByTestId("record-snapshot")).toContainText(`"wind_mph":${wind}`);
  await page.screenshot({ path: "test-results/compliance-record.png", fullPage: true });

  // A due notice: print it and record the proof.
  await page.goto(`/compliance/notices/${dueNotice.id}`);
  await expect(page.getByTestId("notice-proof")).toContainText("none yet");
  await page.getByRole("link", { name: "Print view" }).click();
  await expect(page.getByTestId("notice-print")).toContainText("Post-application information");
  await page.getByRole("button", { name: "Mark as printed and sent" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(new RegExp(`/compliance/notices/${dueNotice.id}$`));
  await expect(page.getByTestId("notice-proof")).toContainText("printed from the office");

  // The registry: Maria's address goes on it and the property shows the match.
  await importRegistry(page, "registry.csv", year);
  await expect(page.getByTestId("registry-match").filter({ hasText: "1234 Neil Ave" })).toBeVisible();
  await page.screenshot({ path: "test-results/compliance-registry.png", fullPage: true });
  await signOut(page);

  // The owner signs a fresh agreement for Maria; the dispatcher is blocked until the advance notice is recorded.
  await signIn(page, seedUserEmail(northwind, "owner"));
  await page.goto("/customers?q=Maria");
  await page.getByRole("link", { name: "Maria Lopez" }).click();
  await page.getByRole("link", { name: "New agreement" }).click();
  await page.getByLabel("Service type").selectOption({ label: "General pest plan" });
  await page.locator("#new-initial").fill("199.00");
  await page.locator("#new-recurring").fill("99.00");
  await page.locator("#new-starts").fill(STARTS_ON);
  await page.locator("#new-first").fill(VISIT_DAY);
  await page.locator("#new-notes").fill(`e2e compliance ${Date.now()}`);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/agreements\/[0-9a-f-]+$/);
  await page.getByLabel("Customer's typed name").fill("Maria Lopez");
  await page.getByLabel("The customer agrees to the terms above").check();
  await page.getByRole("button", { name: "Sign and activate" }).click();
  await page.waitForLoadState("networkidle");
  const visitUrl = (await page.getByRole("link", { name: "Visit 1 on the dispatch board" }).getAttribute("href")) as string;
  await signOut(page);

  await signIn(page, seedUserEmail(northwind, "dispatcher"));
  await page.goto(visitUrl);
  await page.getByLabel("Technician (lead)").selectOption({ label: "Sam Rivera" });
  await page.getByLabel("Date", { exact: true }).fill(VISIT_DAY);
  await page.getByRole("button", { name: "Schedule visit" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/notification registry; the advance notice/)).toBeVisible();
  await page.locator("#registry-date").fill(VISIT_DAY);
  await page.locator("#registry-channel").selectOption("mail");
  await page.locator("#registry-note").fill("Letter mailed to the registrant");
  await page.getByRole("button", { name: "Record advance notice" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("registry-notice").filter({ hasText: "Jane Neighbor" })).toContainText("sent");
  await page.getByLabel("Technician (lead)").selectOption({ label: "Sam Rivera" });
  await page.getByLabel("Date", { exact: true }).fill(VISIT_DAY);
  await page.getByRole("button", { name: "Schedule visit" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/lead Sam Rivera/)).toBeVisible();
  await page.screenshot({ path: "test-results/compliance-registry-visit.png", fullPage: true });
  await signOut(page);

  // The inspector export is one zip with the named files; then the test's registry stops matching Maria again.
  await signIn(page, seedUserEmail(northwind, "compliance_manager"));
  const response = await page.request.get(`/api/compliance/export?from=${addDays(today, -30)}&to=${today}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/zip");
  const entries = unzipSync(new Uint8Array(await response.body()));
  expect(Object.keys(entries).sort()).toEqual(["amendments.csv", "binder.html", "branch_licenses.csv", "credentials.csv", "notices.csv", "record_products.csv", "records.csv"]);
  expect(new TextDecoder().decode(entries["records.csv"])).toContain("Maria Lopez");
  expect(new TextDecoder().decode(entries["record_products.csv"])).toContain("Demand CS");
  expect(new TextDecoder().decode(entries["amendments.csv"])).toContain(`(${stamp})`);
  await page.goto("/compliance/export");
  await expect(page.getByTestId("export-row").first()).toBeVisible();
  await importRegistry(page, "registry-none.csv", year);
  await expect(page.getByTestId("registry-match").filter({ hasText: "1234 Neil Ave" })).toHaveCount(0);
  await signOut(page);

  // The other company sees none of it.
  await signIn(page, seedUserEmail(lakeshore, "compliance_manager"));
  const foreign = await page.request.get(`/compliance/records/${record.id}`);
  expect(foreign.status()).toBe(404);
  await page.goto("/compliance/registries");
  await expect(page.getByTestId("registry-set").filter({ hasText: "e2e" })).toHaveCount(0);
  await signOut(page);
});
