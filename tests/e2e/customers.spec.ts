import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_TENANTS, seedUserEmail } from "../../scripts/seed-data";

const [northwind, lakeshore] = SEED_TENANTS;

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

test("a sales rep takes a lead from first call to a converted account, and the other company cannot see it", async ({ page }) => {
  const stamp = Date.now();
  const leadName = `Taylor Reed ${stamp}`;
  const phone = `614555${String(stamp).slice(-4)}`;
  const street = `${String(stamp).slice(-4)} Birch Ave`;

  await signIn(page, seedUserEmail(northwind, "sales_rep"));

  // New lead with a source and a service address.
  await page.goto("/leads/new");
  await page.getByLabel("Name").fill(leadName);
  await page.getByLabel("Lead source").selectOption({ label: "Referral" });
  await page.getByLabel("Phone").fill(phone);
  await page.getByLabel("Street address").fill(street);
  await page.getByLabel("City").fill("Dayton");
  await page.getByLabel("State").fill("OH");
  await page.getByLabel("ZIP").fill("45402");
  await page.getByLabel("Property type").selectOption("house");
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: new RegExp(leadName) })).toBeVisible();

  // Book the inspection.
  await page.getByLabel("Inspection date and time").fill("2027-04-15T09:00");
  await page.getByRole("button", { name: "Book inspection" }).click();
  await expect(page.getByText("Inspection booked")).toBeVisible();

  // Build a quote with two options and lines, then send it.
  await page.getByRole("button", { name: "New quote" }).click();
  await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]+$/);
  const firstOption = page.locator("section").filter({ hasText: "Option 1" }).first();
  await firstOption.getByLabel("Line").fill("Initial service and inspection");
  await firstOption.getByLabel("Kind").selectOption("initial");
  await firstOption.getByLabel("Unit price ($)").fill("225");
  await firstOption.getByRole("button", { name: "Add line" }).click();
  await expect(page.getByText("$225.00").first()).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill("Quarterly plan with mosquito season");
  await page.getByRole("button", { name: "Add option" }).click();
  const secondOption = page.locator("section").filter({ hasText: "Quarterly plan with mosquito season" }).first();
  await secondOption.getByLabel("Line").fill("Mosquito and tick round");
  await secondOption.getByLabel("Qty").fill("6");
  await secondOption.getByLabel("Unit price ($)").fill("89");
  await secondOption.getByRole("button", { name: "Add line" }).click();
  await expect(page.getByText("$534.00").first()).toBeVisible();

  await page.getByRole("button", { name: "Mark sent" }).click();
  await expect(page.getByText("sent", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: "test-results/quote-sent.png", fullPage: true });

  // Back on the lead: quoted, then won and converted.
  const quoteUrl = page.url();
  await page.getByRole("link", { name: new RegExp(`Lead: ${leadName}`) }).click();
  await expect(page.getByText("Quoted", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mark won and convert" }).click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: new RegExp(leadName) })).toBeVisible();
  await expect(page.getByRole("cell", { name: new RegExp(street.toUpperCase()) })).toBeVisible();
  await expect(page.getByRole("cell", { name: leadName, exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/converted-account.png", fullPage: true });
  const accountUrl = page.url();

  // Search finds the account by phone.
  await page.goto(`/customers?q=${phone}`);
  await expect(page.getByRole("link", { name: leadName })).toBeVisible();

  // A second property at the same address raises the duplicate warning and nothing is saved until confirmed.
  await page.goto(accountUrl);
  await page.getByText("Add a property").click();
  await page.locator("#pf-type").selectOption("house");
  await page.locator("#line1").fill(street);
  await page.locator("#city").fill("Dayton");
  await page.locator("#state_code").fill("OH");
  await page.locator("#postal_code").fill("45402");
  await page.getByRole("button", { name: "Add property" }).click();
  await expect(page.getByText("This looks like it may already exist")).toBeVisible();
  await page.screenshot({ path: "test-results/duplicate-warning.png", fullPage: true });

  await signOut(page);

  // The other company sees none of it.
  await signIn(page, seedUserEmail(lakeshore, "owner"));
  await page.goto(`/customers?q=${phone}`);
  await expect(page.getByText("Nothing matches.")).toBeVisible();
  await page.goto(accountUrl);
  await expect(page.getByText("This page could not be found")).toBeVisible();
  await page.goto(quoteUrl);
  await expect(page.getByText("This page could not be found")).toBeVisible();
});

test("the seeded landlord has a building with units and residents", async ({ page }) => {
  await signIn(page, seedUserEmail(northwind, "office"));
  await page.goto("/customers?q=Oakwood");
  await page.getByRole("link", { name: "Oakwood Properties" }).click();
  await page.getByRole("link", { name: "Oakwood Apartments" }).click();
  // Unit 1A appears in the units table and again against its resident.
  await expect(page.getByRole("cell", { name: "1A", exact: true })).toHaveCount(2);
  await expect(page.getByRole("cell", { name: "Priya Natarajan" })).toBeVisible();
});
