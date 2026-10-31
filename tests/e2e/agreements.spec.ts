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

/** First day of the month `offset` months from now, as a business date. */
function firstOfMonth(offset: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
}

test("office staff sign a quarterly agreement, book a re-service, raise prices in bulk and cancel it, and the other company sees none of it", async ({ page }) => {
  const startsOn = firstOfMonth(1);
  const increaseOn = firstOfMonth(2);
  const stamp = Date.now();

  await signIn(page, seedUserEmail(northwind, "office"));

  // From the account: a quarterly plan on flat monthly billing, starting next month.
  await page.goto("/customers?q=Maria");
  await page.getByRole("link", { name: "Maria Lopez" }).click();
  await page.getByRole("link", { name: "New agreement" }).click();
  await expect(page).toHaveURL(/\/agreements\/new\?account_id=/);
  await page.getByLabel("Service type").selectOption({ label: "General pest plan" });
  await page.locator("#new-initial").fill("249.00");
  await page.locator("#new-recurring").fill("119.00");
  await page.locator("#new-starts").fill(startsOn);
  await page.locator("#new-first").fill(startsOn);
  await page.locator("#new-notes").fill(`e2e ${stamp}`);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/agreements\/[0-9a-f-]+$/);
  const agreementUrl = page.url();
  await expect(page.getByRole("heading", { name: /Agreement #\d+/ })).toBeVisible();
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();

  // The preview: 4 visits (one initial, three recurring) and 12 installments.
  await expect(page.getByRole("cell", { name: "Initial", exact: true })).toHaveCount(1);
  await expect(page.getByRole("cell", { name: "Recurring", exact: true })).toHaveCount(3);
  await expect(page.getByText(/12 billing events totalling \$606\.00/)).toBeVisible();
  await page.screenshot({ path: "test-results/agreement-draft.png", fullPage: true });

  // The customer signs.
  await page.getByLabel("Customer's typed name").fill("Maria Lopez");
  await page.getByLabel("The customer agrees to the terms above").check();
  await page.getByRole("button", { name: "Sign and activate" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Planned", exact: true })).toHaveCount(4);
  await page.screenshot({ path: "test-results/agreement-signed.png", fullPage: true });

  // A free re-service.
  await page.getByLabel("What the customer is seeing").fill("Ants back in the kitchen");
  await page.getByRole("button", { name: "Book re-service" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("row", { name: /Re-service.*Ants back in the kitchen.*\$0\.00/ })).toBeVisible();

  // A 5% increase on general pest plans effective in two months: the later recurring visits change, the initial does not.
  await page.goto("/agreements/price-increases");
  await page.getByLabel("Percent").fill("5");
  await page.locator("#effective_on").fill(increaseOn);
  await page.getByLabel("Service type").selectOption({ label: "General pest plan" });
  await page.locator("#notes").fill(`e2e ${stamp}`);
  await page.getByRole("button", { name: "Save for review" }).click();
  await page.waitForLoadState("networkidle");
  const pending = page.getByRole("row", { name: /5%.*every branch/ }).first();
  await expect(pending).toBeVisible();
  await pending.getByRole("button", { name: /Apply to \d+/ }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("applied", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: "test-results/price-increases.png", fullPage: true });

  await page.goto(agreementUrl);
  await expect(page.getByRole("row", { name: /Initial.*\$249\.00/ })).toHaveCount(1);
  await expect(page.getByRole("row", { name: /Recurring.*\$124\.95/ })).toHaveCount(3);
  await expect(page.getByRole("row", { name: /bulk increase/ })).toBeVisible();

  // Cancel with a reason; nothing was billed or delivered yet, so nothing settles.
  await expect(page.getByText(/Billed through/)).toBeVisible();
  await page.getByLabel("Reason").selectOption({ label: "Price" });
  await page.getByLabel("A save offer was made").check();
  await page.getByLabel("Save outcome").selectOption("lost");
  await page.getByRole("button", { name: "Cancel agreement" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Cancelled", exact: true })).toHaveCount(5);
  await page.screenshot({ path: "test-results/agreement-cancelled.png", fullPage: true });

  await signOut(page);

  // The other company cannot open it.
  await signIn(page, seedUserEmail(lakeshore, "owner"));
  await page.goto(agreementUrl);
  await expect(page.getByText("This page could not be found")).toBeVisible();
});

test("the renewals view lists the seeded agreement that ends within 30 days", async ({ page }) => {
  await signIn(page, seedUserEmail(northwind, "owner"));
  await page.goto("/agreements?view=renewals");
  await expect(page.getByRole("row", { name: /Oakwood Properties.*Rodent control program/ })).toBeVisible();
});
