import { expect, type Page, test } from "@playwright/test";
import { PLATFORM_ADMIN_EMAIL, SEED_PASSWORD, SEED_TENANTS, seedUserEmail } from "../../scripts/seed-data";

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

test("an owner adds a branch and invites a technician, the audit log records both, and the other company cannot see them", async ({ page }) => {
  const stamp = Date.now();
  const branchName = `West branch ${stamp}`;
  const inviteEmail = `tech-${stamp}@northwind.test`;

  await signIn(page, seedUserEmail(northwind, "owner"));
  await expect(page.getByRole("heading", { name: northwind.name })).toBeVisible();

  await page.goto("/settings/branches");
  await page.getByLabel("Name").fill(branchName);
  await page.getByLabel("Address").fill("1 West Ave, Dayton, OH 45402");
  await page.getByLabel("State").fill("OH");
  await page.getByRole("button", { name: "Add branch" }).click();
  await expect(page.getByRole("cell", { name: branchName })).toBeVisible();
  await page.screenshot({ path: "test-results/branch-added.png", fullPage: true });

  await page.goto("/settings/users");
  await page.locator("#invite-email").fill(inviteEmail);
  await page.locator("#invite-role").selectOption({ label: "Technician (default)" });
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("cell", { name: inviteEmail })).toBeVisible();
  await page.screenshot({ path: "test-results/technician-invited.png", fullPage: true });

  await page.goto("/settings/audit");
  await expect(page.getByText(`branch created: ${branchName}`)).toBeVisible();
  await expect(page.getByText(`invitation created: ${inviteEmail}`)).toBeVisible();
  await page.screenshot({ path: "test-results/audit-log.png", fullPage: true });

  await signOut(page);

  await signIn(page, seedUserEmail(lakeshore, "owner"));
  await expect(page.getByRole("heading", { name: lakeshore.name })).toBeVisible();
  await page.goto("/settings/branches");
  await expect(page.getByRole("cell", { name: lakeshore.branches[0].name })).toBeVisible();
  await expect(page.getByRole("cell", { name: branchName })).toHaveCount(0);
  await page.screenshot({ path: "test-results/lakeshore-branches.png", fullPage: true });
});

test("a technician sees branches but cannot add one", async ({ page }) => {
  await signIn(page, seedUserEmail(northwind, "technician"));
  await page.goto("/settings/branches");
  await expect(page.getByRole("cell", { name: northwind.branches[0].name })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add branch" })).toHaveCount(0);
});

test("a user outside every company sees the no-company page", async ({ page }) => {
  await page.goto("/sign-in");
  await page.locator("#email").fill(PLATFORM_ADMIN_EMAIL);
  await page.locator("#password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/no-company/);
  await expect(page.getByRole("heading", { name: "You are not part of a company yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Platform console", exact: true })).toBeVisible();
});
