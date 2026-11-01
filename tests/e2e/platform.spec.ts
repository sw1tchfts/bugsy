import { expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { NEW_OWNER_EMAIL, PLATFORM_ADMIN_EMAIL, SEED_PASSWORD, SEED_TENANTS, seedUserEmail } from "../../scripts/seed-data";

const [northwind] = SEED_TENANTS;
const OWNER = seedUserEmail(northwind, "owner");

async function signIn(page: Page, email: string, landing: RegExp) {
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

const company = (page: Page, name: string) => page.locator(`[data-testid="company"][data-name="${name}"]`);

async function unzip(page: Page, url: string): Promise<Record<string, Uint8Array>> {
  const res = await page.request.get(url);
  expect(res.status(), url).toBe(200);
  return unzipSync(new Uint8Array(await res.body()));
}

test("support asks, the owner approves and watches, access ends; the owner sets up and exports; a company that leaves goes read only", async ({ page }) => {
  test.setTimeout(300_000);
  const stamp = Date.now();
  const reason = `e2e ${stamp}: statements print without the footer`;

  // Platform support asks Northwind's owners for two hours of read access. Platform staff land outside every company.
  await signIn(page, PLATFORM_ADMIN_EMAIL, /\/no-company/);
  await page.goto("/admin/tenants");
  for (const stale of await page.getByTestId("my-grant").filter({ hasText: northwind.name }).all()) {
    await stale.getByRole("button", { name: /End|Withdraw/ }).click();
    await page.waitForLoadState("networkidle");
  }
  const card = company(page, northwind.name);
  await expect(card.getByTestId("company-setup")).toContainText("of 13");
  await card.getByLabel(`Access for ${northwind.name}`, { exact: true }).selectOption("read");
  await card.getByLabel(`Hours for ${northwind.name}`, { exact: true }).fill("2");
  await card.getByLabel(`Reason for ${northwind.name}`, { exact: true }).fill(reason);
  await card.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Request sent")).toBeVisible();
  await expect(page.getByTestId("my-grant").filter({ hasText: northwind.name })).toContainText("waiting for the owner");
  await page.screenshot({ path: "test-results/platform-console.png", fullPage: true });
  await signOut(page);

  // The owner sees the request on every page and approves it.
  await signIn(page, OWNER, /\/$/);
  await expect(page.getByTestId("support-request-banner")).toContainText("asks for read-only access for 2 hours");
  await page.getByRole("link", { name: "Review support access" }).click();
  const request = page.getByTestId("support-open").filter({ hasText: reason });
  await request.getByTestId("support-approve").click();
  await expect(page.getByText("Support access approved")).toBeVisible();
  await expect(page.getByTestId("support-request-banner")).toContainText("can see this company's data until");
  await page.screenshot({ path: "test-results/platform-support-approved.png", fullPage: true });
  await signOut(page);

  // Support opens Northwind from the console: the data is there, read only, and a change is refused.
  await signIn(page, PLATFORM_ADMIN_EMAIL, /\/no-company/);
  await page.goto("/admin/tenants");
  await page.getByTestId("my-grant").filter({ hasText: northwind.name }).getByTestId("open-company").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("support-banner")).toContainText("read only");
  await page.goto("/customers?q=Maria");
  await expect(page.getByRole("link", { name: "Maria Lopez" })).toBeVisible();
  await page.screenshot({ path: "test-results/platform-support-session.png", fullPage: true });
  await page.goto("/customers/new");
  await expect(page).toHaveURL(/error=forbidden/);
  await expect(page.getByText("Your role does not allow that.")).toBeVisible();
  await signOut(page);

  // The owner reads what support opened, then ends the access.
  await signIn(page, OWNER, /\/$/);
  await page.goto("/settings/support");
  await expect(page.getByTestId("support-log").filter({ hasText: "/customers?q=Maria" }).first()).toBeVisible();
  await page.screenshot({ path: "test-results/platform-support-log.png", fullPage: true });
  await page.getByTestId("support-open").filter({ hasText: reason }).getByTestId("support-end").click();
  await expect(page.getByText("Support access ended.")).toBeVisible();
  await expect(page.getByTestId("support-request-banner")).toHaveCount(0);

  // Setup checklist and the full export.
  await page.goto("/onboarding");
  await expect(page.getByTestId("onboarding-progress")).toContainText("of 13 done");
  await expect(page.getByTestId("step-branch")).toHaveAttribute("data-done", "yes");
  await expect(page.getByTestId("step-customers")).toHaveAttribute("data-done", "yes");
  await page.screenshot({ path: "test-results/platform-onboarding.png", fullPage: true });
  const files = await unzip(page, "/api/company/export.zip");
  expect(Object.keys(files)).toEqual(expect.arrayContaining(["README.txt", "accounts.csv", "visits.csv", "application_records.csv", "journal_lines.csv"]));
  expect(Object.keys(files).some((f) => f.startsWith("files/"))).toBe(true);
  expect(strFromU8(files["accounts.csv"])).toContain("Maria Lopez");
  await signOut(page);

  // With the grant ended, support cannot open Northwind.
  await signIn(page, PLATFORM_ADMIN_EMAIL, /\/no-company/);
  await page.goto("/customers");
  await expect(page).toHaveURL(/\/no-company/);
  await page.goto("/admin/tenants");
  await expect(page.getByTestId("my-grant").filter({ hasText: northwind.name })).toHaveCount(0);

  // A new company: created from the console, its owner accepts and adds a branch.
  const name = `E2E Lifecycle ${stamp}`;
  await page.locator("#name").fill(name);
  await page.locator("#legal_name").fill(`${name} LLC`);
  await page.locator("#timezone").selectOption("America/Chicago");
  await page.locator("#owner_email").fill(NEW_OWNER_EMAIL);
  await page.getByRole("button", { name: "Create company" }).click();
  const invite = (await company(page, name).getByTestId("owner-invite").textContent())?.trim() as string;
  expect(invite).toMatch(/^\/invite\//);
  await signOut(page);

  await signIn(page, NEW_OWNER_EMAIL, /\/(no-company)?$/);
  await page.goto(invite);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await page.goto("/settings/branches");
  await page.locator("#name").fill("Springfield shop");
  await page.locator("#address").fill("1 Main St, Springfield, IL 62701");
  await page.locator("#state_code").fill("IL");
  await page.getByRole("button", { name: "Add branch" }).click();
  await expect(page.getByRole("cell", { name: "Springfield shop" })).toBeVisible();
  await signOut(page);

  // The company leaves: archived with a reason; a purge is refused until retention allows.
  await signIn(page, PLATFORM_ADMIN_EMAIL, /\/no-company/);
  await page.goto("/admin/tenants");
  await company(page, name).getByLabel(`Status for ${name}`, { exact: true }).selectOption("archived");
  await company(page, name).getByLabel(`Status reason for ${name}`, { exact: true }).fill("e2e: the company left Bugsy");
  await company(page, name).getByRole("button", { name: "Save status" }).click();
  await expect(page.getByText("Status saved: archived.")).toBeVisible();
  await company(page, name).getByLabel("Type the company's name to delete its data").fill(name);
  await company(page, name).getByRole("button", { name: "Purge" }).click();
  await expect(page.getByText(/archived less than 90 days ago/)).toBeVisible();
  await expect(company(page, name)).toBeVisible();
  await signOut(page);

  // Its owner still reads and exports, and cannot change anything.
  await signIn(page, NEW_OWNER_EMAIL, /\/$/);
  await expect(page.getByTestId("tenant-readonly")).toContainText(`${name} is archived`);
  await page.goto("/settings/branches");
  await page.locator("#name").fill("Second shop");
  await page.locator("#address").fill("2 Main St, Springfield, IL 62701");
  await page.locator("#state_code").fill("IL");
  await page.getByRole("button", { name: "Add branch" }).click();
  await expect(page.getByText("Nothing can be changed right now")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Second shop" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/platform-archived.png", fullPage: true });
  const theirs = await unzip(page, "/api/company/export.zip");
  expect(strFromU8(theirs["branches.csv"])).toContain("Springfield shop");
});
