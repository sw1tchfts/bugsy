import { expect, type Page, test } from "@playwright/test";
import { PLATFORM_ADMIN_EMAIL, SEED_PASSWORD, SEED_TENANTS, seedUserEmail } from "../../scripts/seed-data";

const [northwind, lakeshore] = SEED_TENANTS;

async function signIn(page: Page, email: string, landing: RegExp = /\/$/) {
  await page.goto("/sign-in");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(landing);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
}

test("an owner builds a service type with state rules and a price book, enables and adds products, quotes from the book, and the platform approves the product", async ({ page }) => {
  const stamp = Date.now();
  const serviceTypeName = `Mosquito season ${stamp}`;
  const productName = `Demo botanical ${stamp}`;
  const epaRegNo = `99999-${String(stamp).slice(-5)}`;

  await signIn(page, seedUserEmail(northwind, "owner"));

  // A service type from a template, with one state rule row per state Northwind works in and no rule pack yet.
  await page.goto("/catalog/service-types");
  await page.getByLabel("Template").selectOption({ label: "Mosquito and tick season (Mosquito and tick)" });
  await page.getByLabel("Name (optional)").fill(serviceTypeName);
  await page.getByRole("button", { name: "Add from template" }).click();
  await expect(page).toHaveURL(/\/catalog\/service-types\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: new RegExp(serviceTypeName) })).toBeVisible();
  await expect(page.getByText("no rule pack for OH yet")).toBeVisible();
  await expect(page.getByLabel("Categories for IL")).toHaveCount(0);

  // The owner tightens the OH rule: a certification category and the tax class.
  await page.getByLabel("Categories for OH").fill("7F");
  await page.getByLabel("Tax class for OH").selectOption("taxable");
  await page.locator("tr", { has: page.getByLabel("Categories for OH") }).getByRole("button", { name: "Save" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("Categories for OH")).toHaveValue("7F");
  await expect(page.getByLabel("Tax class for OH")).toHaveValue("taxable");

  // Two lot-size bands and an add-on; an overlapping band is rejected.
  const addBand = async (min: string, max: string, price: string) => {
    await page.locator("#new-name").fill("Season program");
    await page.locator("#new-basis").selectOption("lot_sqft");
    await page.locator("#new-min").fill(min);
    await page.locator("#new-max").fill(max);
    await page.locator("#new-initial").fill(price);
    await page.locator("#new-recurring").fill(price);
    await page.getByRole("button", { name: "Add item" }).click();
    // The action redirects back to this page and refreshes it; let that settle before typing into the form again.
    await page.waitForLoadState("networkidle");
  };
  await addBand("0", "10000", "89");
  await expect(page.locator('input[name="size_max"]').first()).toHaveValue("10000");
  await addBand("10000", "22000", "119");
  await expect(page.locator('input[name="size_min"]').nth(1)).toHaveValue("10000");
  await addBand("5000", "15000", "99");
  await expect(page.getByText(/overlaps a band that already exists/)).toBeVisible();
  await page.locator("#new-name").fill("Backyard event spray");
  await page.locator("#new-basis").selectOption("none");
  await page.locator("#new-initial").fill("49");
  await page.locator('form:has(#new-name) input[name="add_on"]').check();
  await page.getByRole("button", { name: "Add item" }).click();
  await page.waitForLoadState("networkidle");
  const addOnRow = page.locator("form", { has: page.locator('input[name="name"][value="Backyard event spray"]') });
  await expect(addOnRow).toBeVisible();
  await expect(addOnRow.locator('input[name="add_on"]')).toBeChecked();
  await page.screenshot({ path: "test-results/service-type.png", fullPage: true });

  // Products: enable a master product with a cost, then add one the master list lacks.
  await page.goto("/catalog/products");
  const suspend = page.getByRole("row", { name: /Suspend SC/ });
  await suspend.getByLabel("Enable Suspend SC").check();
  await suspend.getByLabel("Unit cost for Suspend SC").fill("8.25");
  await suspend.getByRole("button", { name: "Save" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("Unit cost for Suspend SC")).toHaveValue("8.25");

  await page.locator("#new-name").fill(productName);
  await page.locator("#new-manufacturer").fill("Demo Labs");
  await page.locator("#new-epa").fill(epaRegNo);
  await page.locator("#new-ai").fill("demo ingredient 1%");
  await page.locator("#new-cost").fill("4.50");
  await page.getByRole("button", { name: "Add product" }).click();
  const added = page.getByRole("row", { name: new RegExp(productName) });
  await expect(added).toBeVisible();
  await expect(added.getByText("unverified")).toBeVisible();
  await page.screenshot({ path: "test-results/products.png", fullPage: true });

  // A quote line from the price book uses the property's size to pick the band.
  await page.goto("/customers?q=Maria");
  await page.getByRole("link", { name: "Maria Lopez" }).click();
  await page.getByRole("button", { name: "New quote" }).click();
  await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]+$/);
  await page.getByLabel("From the price book").selectOption({ label: "General pest plan: Quarterly plan (2,000 to 3,499 sq ft), initial service $249.00" });
  await page.getByRole("button", { name: "Add from price book" }).click();
  await expect(page.getByRole("cell", { name: "Quarterly plan" })).toBeVisible();
  await expect(page.getByText("$249.00").first()).toBeVisible();
  await page.screenshot({ path: "test-results/quote-from-price-book.png", fullPage: true });

  await signOut(page);

  // The platform admin approves the product into the master list.
  await signIn(page, PLATFORM_ADMIN_EMAIL, /\/(no-company)?$/);
  await page.goto("/admin/products");
  await page.getByRole("row", { name: new RegExp(productName) }).getByRole("button", { name: "Approve into master list" }).click();
  await expect(page.getByRole("row", { name: new RegExp(productName) })).toHaveCount(0);
  await expect(page.getByText(productName)).toBeVisible();
  await page.screenshot({ path: "test-results/admin-products.png", fullPage: true });
  await signOut(page);

  // Back at Northwind the product is verified and still enabled with its cost.
  await signIn(page, seedUserEmail(northwind, "owner"));
  await page.goto("/catalog/products");
  const approved = page.getByRole("row", { name: new RegExp(productName) });
  await expect(approved).toBeVisible();
  await expect(approved.getByText("unverified")).toHaveCount(0);
  await expect(approved.getByLabel(`Unit cost for ${productName}`)).toHaveValue("4.50");
  await signOut(page);

  // The other company never sees Northwind's service type, but does see the approved product, now verified.
  await signIn(page, seedUserEmail(lakeshore, "owner"));
  await page.goto("/catalog/service-types");
  await expect(page.getByText(serviceTypeName)).toHaveCount(0);
  await page.goto("/catalog/products");
  const shared = page.getByRole("row", { name: new RegExp(productName) });
  await expect(shared).toBeVisible();
  await expect(shared.getByText("unverified")).toHaveCount(0);
});
