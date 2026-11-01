import { expect, type Page, test } from "@playwright/test";
import { unzipSync } from "fflate";
import { addMonths, endOfMonth, todayInZone } from "../../lib/dates";
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

const digits = (s: string | null) => (s ?? "").replace(/[^0-9-]/g, "");

test("the owner reads the dashboard and every report, builds and shares a custom report, exports the data, and the other company sees none of it", async ({ page }) => {
  test.setTimeout(300_000);
  const stamp = Date.now();
  const today = todayInZone(northwind.timezone);
  const month = today.slice(0, 7);
  const startsOn = addMonths(`${month}-01`, 1);

  // The dashboard: each tile is there for the owner and opens its report.
  await signIn(page, seedUserEmail(northwind, "owner"));
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
  for (const tile of ["tile-active", "tile-attrition", "tile-retention", "tile-revenue", "tile-receivables", "tile-contracts", "tile-visits", "tile-density", "tile-reservices", "tile-compliance"]) {
    await expect(page.getByTestId(tile)).toBeVisible();
  }
  await page.screenshot({ path: "test-results/reports-dashboard.png", fullPage: true });
  const reports: [string, string][] = [
    ["tile-retention", "Retention and churn"],
    ["tile-density", "Technician productivity"],
    ["tile-revenue", "Revenue by service line"],
    ["tile-receivables", "Receivables aging"],
    ["tile-reservices", "Re-services"],
  ];
  for (const [tile, heading] of reports) {
    await page.goto("/reports");
    await page.getByTestId(tile).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page.getByTestId("report-csv")).toBeVisible();
  }
  await page.goto("/reports");
  await page.getByRole("link", { name: "Sales report" }).click();
  await expect(page.getByRole("heading", { name: "Sales by source" })).toBeVisible();
  await expect(page.getByTestId("sales-row").filter({ hasText: "All sources" })).toBeVisible();

  // A plan signed and cancelled with a reason shows in the retention report's reasons and its list of losses.
  await page.goto("/customers?q=Maria");
  await page.getByRole("link", { name: "Maria Lopez" }).click();
  await page.getByRole("link", { name: "New agreement" }).click();
  await page.getByLabel("Service type").selectOption({ label: "General pest plan" });
  await page.locator("#new-initial").fill("199.00");
  await page.locator("#new-recurring").fill("99.00");
  await page.locator("#new-starts").fill(startsOn);
  await page.locator("#new-first").fill(startsOn);
  await page.locator("#new-notes").fill(`e2e reports ${stamp}`);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/agreements\/[0-9a-f-]+$/);
  const heading = await page.getByRole("heading", { name: /Agreement #\d+/ }).textContent();
  const number = (heading ?? "").match(/#(\d+)/)?.[1] as string;
  await page.getByLabel("Customer's typed name").fill("Maria Lopez");
  await page.getByLabel("The customer agrees to the terms above").check();
  await page.getByRole("button", { name: "Sign and activate" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Reason").selectOption({ label: "Moved away" });
  await page.getByRole("button", { name: "Cancel agreement" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();

  await page.goto("/reports/retention");
  await expect(page.getByTestId("lost-reason").filter({ hasText: "Moved away" })).toBeVisible();
  await expect(page.getByTestId("lost-agreement").filter({ hasText: `#${number}` })).toContainText("Moved away");
  await expect(page.getByTestId("month-bars")).toBeVisible();
  await expect(page.getByTestId("cohort-table")).toBeVisible();
  await page.screenshot({ path: "test-results/reports-retention.png", fullPage: true });

  // Technicians: Sam Rivera led completed stops.
  await page.goto("/reports/technicians");
  await expect(page.getByTestId("technician-row").filter({ hasText: "Sam Rivera" })).toBeVisible();
  await page.screenshot({ path: "test-results/reports-technicians.png", fullPage: true });

  // Last month's revenue equals the income statement's revenue for the same days.
  const last = addMonths(`${month}-01`, -1).slice(0, 7);
  const lastEnd = endOfMonth(`${last}-01`);
  await page.goto(`/reports/revenue?from=${last}-01&to=${lastEnd}`);
  const reportTotal = digits(await page.getByTestId(`revenue-total-${last}`).textContent());
  await page.screenshot({ path: "test-results/reports-revenue.png", fullPage: true });
  await page.goto(`/ledger/reports/income?from=${last}-01&to=${lastEnd}`);
  const incomeTotal = digits(await page.getByTestId("income-revenue").textContent());
  expect(reportTotal).not.toBe("");
  expect(reportTotal).toBe(incomeTotal);

  // A custom report: completed visits grouped by technician, saved, shared and downloaded.
  const name = `e2e visits by technician ${stamp}`;
  await page.goto("/reports/custom");
  await page.locator("#dataset").selectOption("visits");
  await page.getByRole("button", { name: "Choose" }).click();
  await page.getByTestId("f0-col").selectOption("status");
  await page.getByTestId("f0-op").selectOption("eq");
  await page.getByTestId("f0-val").fill("completed");
  await page.getByTestId("group-technician").check();
  await page.getByTestId("a0-fn").selectOption("count");
  await page.getByTestId("a1-fn").selectOption("sum");
  await page.getByTestId("a1-col").selectOption("price");
  await page.getByTestId("report-preview").click();
  await expect(page.getByTestId("report-row").filter({ hasText: "Sam Rivera" })).toBeVisible();
  await page.locator("#name").fill(name);
  await page.getByTestId("report-shared").check();
  await page.getByTestId("report-save").click();
  await expect(page).toHaveURL(/\/reports\/custom\/[0-9a-f-]+\?note=/);
  const reportId = new URL(page.url()).pathname.split("/").pop() as string;
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("Shared", { exact: true })).toBeVisible();
  await expect(page.getByTestId("report-row").filter({ hasText: "Sam Rivera" })).toBeVisible();
  await page.screenshot({ path: "test-results/reports-custom.png", fullPage: true });
  const csv = await page.request.get(`/api/reports/custom/${reportId}`);
  expect(csv.status()).toBe(200);
  const csvText = await csv.text();
  expect(csvText.split("\r\n")[0]).toBe("technician,count,sum_price");
  expect(csvText).toContain("Sam Rivera");

  // The export: one CSV per dataset the owner can read, and a README.
  const zip = await page.request.get("/api/reports/export.zip");
  expect(zip.status()).toBe(200);
  const files = Object.keys(unzipSync(new Uint8Array(await zip.body())));
  expect(files.sort()).toEqual(["README.txt", "accounts.csv", "agreements.csv", "invoices.csv", "journal_lines.csv", "leads.csv", "messages.csv", "payments.csv", "properties.csv", "visits.csv"]);
  await signOut(page);

  // The dispatcher sees the shared report and no money tiles; their export has no ledger or invoices.
  await signIn(page, seedUserEmail(northwind, "dispatcher"));
  await page.goto("/reports");
  await expect(page.getByTestId("tile-visits")).toBeVisible();
  await expect(page.getByTestId("tile-revenue")).toHaveCount(0);
  await expect(page.getByTestId("tile-receivables")).toHaveCount(0);
  await page.screenshot({ path: "test-results/reports-dispatcher.png", fullPage: true });
  await page.goto("/reports/custom");
  await page.getByTestId("saved-report").filter({ hasText: name }).getByRole("link").click();
  await expect(page.getByTestId("report-row").filter({ hasText: "Sam Rivera" })).toBeVisible();
  await expect(page.getByTestId("report-share-toggle")).toHaveCount(0);
  await expect(page.getByTestId("report-delete")).toHaveCount(0);
  expect((await page.request.get("/reports/revenue")).url()).toContain("error=forbidden");
  const theirs = Object.keys(unzipSync(new Uint8Array(await (await page.request.get("/api/reports/export.zip")).body())));
  expect(theirs).not.toContain("journal_lines.csv");
  expect(theirs).not.toContain("invoices.csv");
  expect(theirs).toContain("visits.csv");
  expect((await page.request.get(`/api/reports/revenue?from=${month}-01&to=${today}`)).status()).toBe(403);
  await signOut(page);

  // The other company sees none of it.
  await signIn(page, seedUserEmail(lakeshore, "owner"));
  await page.goto("/reports/custom");
  await expect(page.getByTestId("saved-report").filter({ hasText: name })).toHaveCount(0);
  expect((await page.request.get(`/api/reports/custom/${reportId}`)).status()).toBe(404);
  await page.goto("/reports/retention");
  await expect(page.getByTestId("lost-agreement").filter({ hasText: "Maria Lopez" }).filter({ hasText: "Moved away" })).toHaveCount(0);
});
