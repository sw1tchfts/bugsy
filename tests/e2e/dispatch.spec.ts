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

// A week well ahead of the seed, so the board state is this test's own. The test makes its own agreement first.
const STARTS_ON = "2027-03-01";
const WEEK = "2027-03-01";
const DAY = "2027-03-02";
const NEXT_DAY = "2027-03-03";

test("a dispatcher schedules a due visit, is refused for an uncredentialed technician, moves a whole day, builds a crew, and a licensed manager unblocks the dispatcher", async ({ page }) => {
  const stamp = Date.now();

  // Setup as the owner: Casey (a dispatcher who can also run visits) holds no OH credential, and Maria has a fresh
  // signed agreement whose first visit is due in March 2027.
  await signIn(page, seedUserEmail(northwind, "owner"));
  await page.goto("/compliance/credentials");
  const caseyCredential = page.locator("form", { has: page.locator("span.font-medium", { hasText: "Casey Morgan" }) });
  while ((await caseyCredential.count()) > 0) {
    await caseyCredential.first().getByRole("button", { name: "Archive" }).click();
    await page.waitForLoadState("networkidle");
  }
  await page.goto("/customers?q=Maria");
  await page.getByRole("link", { name: "Maria Lopez" }).click();
  await page.getByRole("link", { name: "New agreement" }).click();
  await page.getByLabel("Service type").selectOption({ label: "General pest plan" });
  await page.locator("#new-initial").fill("249.00");
  await page.locator("#new-recurring").fill("119.00");
  await page.locator("#new-starts").fill(STARTS_ON);
  await page.locator("#new-first").fill(STARTS_ON);
  await page.locator("#new-notes").fill(`e2e dispatch ${stamp}`);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/agreements\/[0-9a-f-]+$/);
  await page.getByLabel("Customer's typed name").fill("Maria Lopez");
  await page.getByLabel("The customer agrees to the terms above").check();
  await page.getByRole("button", { name: "Sign and activate" }).click();
  await page.waitForLoadState("networkidle");
  const visitHref = await page.getByRole("link", { name: "Visit 1 on the dispatch board" }).getAttribute("href");
  expect(visitHref).toMatch(/\/dispatch\/visits\/[0-9a-f-]+$/);
  const visitUrl = visitHref as string;
  const visitId = visitUrl.split("/").pop() as string;
  await signOut(page);

  // The dispatcher puts the due visit on Sam Rivera's Tuesday through the card's form.
  await signIn(page, seedUserEmail(northwind, "dispatcher"));
  await page.goto(`/dispatch?week=${WEEK}&day=${DAY}`);
  await expect(page.getByRole("heading", { name: "Dispatch" })).toBeVisible();
  const dueCard = page.locator(`aside [data-visit="${visitId}"]`);
  await expect(dueCard).toBeVisible();
  await dueCard.locator("summary").click();
  await dueCard.getByLabel("Technician").selectOption({ label: "Sam Rivera" });
  await dueCard.getByLabel("Date").fill(DAY);
  await dueCard.getByRole("button", { name: "Schedule" }).click();
  await page.waitForLoadState("networkidle");
  const samRow = page.getByRole("row", { name: /Sam Rivera/ });
  await expect(samRow.locator(`[data-visit="${visitId}"]`)).toBeVisible();
  await expect(page.locator(`aside [data-visit="${visitId}"]`)).toHaveCount(0);
  await page.screenshot({ path: "test-results/dispatch-board.png", fullPage: true });

  // The visit page shows Sam as lead; Casey, without a credential, is refused.
  await page.goto(visitUrl);
  await expect(page.getByText(/lead Sam Rivera/)).toBeVisible();
  await page.getByLabel("Technician (lead)").selectOption({ label: "Casey Morgan" });
  await page.getByRole("button", { name: "Move visit" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/Casey Morgan no credential in this state \(OH\)/)).toBeVisible();
  await expect(page.getByText(/lead Sam Rivera/)).toBeVisible();

  // Crew and arrival window.
  await page.getByLabel("Add to crew").selectOption({ label: "Jordan Ellis" });
  await page.getByLabel("Role").selectOption("helper");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("row", { name: /Jordan Ellis.*Helper/ })).toBeVisible();
  await page.getByLabel("Window").selectOption("morning");
  await page.getByRole("button", { name: "Save window" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("Window")).toHaveValue("morning");
  await page.screenshot({ path: "test-results/dispatch-visit.png", fullPage: true });

  // Weather: Sam's whole Tuesday moves to Wednesday.
  await page.goto(`/dispatch?week=${WEEK}&day=${DAY}`);
  const cell = page.locator(`[data-cell$="|${DAY}"]`, { has: page.locator(`[data-visit="${visitId}"]`) });
  await cell.locator("summary", { hasText: "Move day" }).click();
  await cell.getByLabel(`Move ${DAY} to`).fill(NEXT_DAY);
  await cell.getByText("append if that day has stops").click();
  await cell.getByRole("button", { name: "Move whole day" }).click();
  await page.waitForLoadState("networkidle");
  await page.goto(visitUrl);
  await expect(page.getByText(/Scheduled 3\/3\/2027/)).toBeVisible();
  await signOut(page);

  // The licensed manager gives Casey an OH credential; now the move succeeds.
  await signIn(page, seedUserEmail(northwind, "compliance_manager"));
  await page.goto("/compliance/credentials");
  await page.locator("#new-user").selectOption({ label: "Casey Morgan" });
  await page.locator("#new-state").fill("OH");
  await page.locator("#new-cert").fill(`OH-E2E-${stamp}`);
  await page.locator("#new-cats").fill("7A, 7F");
  await page.locator("#new-cert-exp").fill("2028-12-31");
  await page.getByRole("button", { name: "Add credential" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.locator("span.font-medium", { hasText: "Casey Morgan" })).toBeVisible();
  await page.screenshot({ path: "test-results/credentials.png", fullPage: true });
  await signOut(page);

  await signIn(page, seedUserEmail(northwind, "dispatcher"));
  await page.goto(visitUrl);
  await page.getByLabel("Technician (lead)").selectOption({ label: "Casey Morgan" });
  await page.getByRole("button", { name: "Move visit" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/lead Casey Morgan/)).toBeVisible();
  await signOut(page);

  // The other company cannot open the visit.
  await signIn(page, seedUserEmail(lakeshore, "owner"));
  await page.goto(visitUrl);
  await expect(page.getByText("This page could not be found")).toBeVisible();
});
