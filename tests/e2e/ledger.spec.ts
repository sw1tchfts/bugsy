import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { todayInZone } from "../../lib/dates";
import { formatPeriod, lastEndedPeriod } from "../../lib/ledger/periods";
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

/** The bookkeeper keeps both companies' books: pick the one to work in. */
async function switchTo(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel("Company").selectOption({ label: name });
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

test("the bookkeeper finds the books the operations wrote, posts and reverses an entry, reads the statements, closes the month, and only the owner reopens it", async ({ page }) => {
  test.setTimeout(300_000);
  const today = todayInZone(northwind.timezone);
  const lastMonth = lastEndedPeriod(today);
  const stamp = Date.now();
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1, prepare: false, onnotice: () => {} });
  const [maria] = await sql<{ id: string }[]>`select a.id from public.accounts a join public.tenants t on t.id = a.tenant_id where t.name = ${northwind.name} and a.name = 'Maria Lopez'`;
  await sql.end();
  expect(maria, "the seed gives Northwind Maria Lopez").toBeTruthy();

  // The office issues a one-off charge, so the journal has an entry of this run's own.
  await signIn(page, seedUserEmail(northwind, "office"));
  await page.goto("/billing/invoices/new");
  await page.locator("#inv-account").selectOption(maria.id);
  await page.locator("#inv-amount").fill("40.00");
  await page.locator("#inv-description").fill(`Attic inspection (e2e ledger ${stamp})`);
  await page.getByLabel(/Issue now/).check();
  await page.getByRole("button", { name: "Create invoice" }).click();
  await expect(page).toHaveURL(/\/billing\/invoices\/[0-9a-f-]+$/);
  const heading = await page.getByRole("heading", { name: /Invoice #\d+/ }).textContent();
  const invoiceNumber = (heading ?? "").match(/#(\d+)/)?.[1] as string;
  expect(invoiceNumber).toBeTruthy();
  await signOut(page);

  // The bookkeeper, in Northwind's books: nothing waits for the job, and the invoice posted the moment it was issued.
  await signIn(page, seedUserEmail(lakeshore, "bookkeeper"));
  await switchTo(page, northwind.name);
  await page.goto("/ledger");
  await expect(page.getByRole("heading", { name: "Ledger" })).toBeVisible();
  await expect(page.getByTestId("ledger-unposted")).toHaveText("0");
  await expect(page.getByTestId("last-closed")).not.toHaveText("none");
  await page.screenshot({ path: "test-results/ledger-home.png", fullPage: true });
  await page.goto(`/ledger/journal?q=${encodeURIComponent(`Invoice #${invoiceNumber},`)}`);
  const invoiceRow = page.getByTestId("journal-row").filter({ hasText: `Invoice #${invoiceNumber},` });
  await expect(invoiceRow).toHaveCount(1);
  await invoiceRow.getByRole("link").click();
  await expect(page.getByRole("heading", { name: /Entry #\d+/ })).toBeVisible();
  await expect(page.getByTestId("journal-line")).toHaveCount(2);
  await expect(page.getByTestId("journal-line").filter({ hasText: "Accounts receivable" })).toContainText("$40.00");
  await expect(page.getByTestId("journal-line").filter({ hasText: "Other service revenue" })).toContainText("$40.00");
  for (const kind of ["visit", "payment", "payout"]) {
    await page.goto(`/ledger/journal?source_type=${kind}`);
    expect(await page.getByTestId("journal-row").count(), `the seed posts ${kind} entries`).toBeGreaterThan(0);
  }

  // A manual entry, balanced, then reversed: the original stays, both link to each other.
  await page.goto("/ledger/journal/new");
  await page.locator("#je-date").fill(today);
  await page.locator("#je-memo").fill(`Truck wash (e2e ledger ${stamp})`);
  await page.getByLabel("Account for line 1").selectOption({ label: "6400 Vehicle expense" });
  await page.getByLabel("Debit for line 1").fill("125.00");
  await page.getByLabel("Account for line 2").selectOption({ label: "1000 Operating bank account" });
  await page.getByLabel("Credit for line 2").fill("125.00");
  await page.getByRole("button", { name: "Post entry" }).click();
  await expect(page).toHaveURL(/\/ledger\/journal\/[0-9a-f-]+$/);
  const manualUrl = page.url();
  await expect(page.getByRole("heading", { name: /Entry #\d+/ })).toBeVisible();
  await expect(page.getByTestId("entry-debits")).toHaveText("$125.00");
  await expect(page.getByTestId("entry-credits")).toHaveText("$125.00");
  await page.getByRole("button", { name: "Reverse entry" }).click();
  await expect(page).not.toHaveURL(manualUrl);
  await expect(page).toHaveURL(/\/ledger\/journal\/[0-9a-f-]+$/);
  await expect(page.getByText("Reversal", { exact: true })).toBeVisible();
  await expect(page.getByTestId("entry-summary")).toContainText(/Reverses #\d+/);
  await expect(page.getByTestId("journal-line").filter({ hasText: "Vehicle expense" })).toContainText("$125.00");
  await page.goto(manualUrl);
  await expect(page.getByText("reversed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reverse entry" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/ledger-entry.png", fullPage: true });

  // The statements balance and export.
  await page.goto("/ledger/reports/trial-balance");
  await expect(page.getByText("balanced", { exact: true })).toBeVisible();
  await expect(page.getByTestId("tb-debits")).toHaveText(await page.getByTestId("tb-credits").innerText());
  const from = `${today.slice(0, 7)}-01`;
  const csv = await page.request.get(`/api/ledger/trial-balance.csv?from=${from}&to=${today}`);
  expect(csv.status()).toBe(200);
  expect((await csv.text()).split("\n")[0]).toMatch(/^number,account/);
  await page.goto("/ledger/reports/income");
  await expect(page.getByTestId("income-net")).toBeVisible();
  await page.goto("/ledger/reports/income?basis=cash");
  await expect(page.getByTestId("income-net")).toBeVisible();
  await expect(page.getByText("Receipts not yet applied to an invoice")).toBeVisible();
  await page.goto("/ledger/reports/balance-sheet");
  await expect(page.getByText("balanced", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/ledger-balance-sheet.png", fullPage: true });
  await page.goto(`/ledger/reports/contracts?from=2024-01-01&to=${today}`);
  expect(await page.getByTestId("contract-row").count(), "the seeded agreements carry contract balances").toBeGreaterThan(0);
  const journal = await page.request.get(`/api/ledger/journal.csv?from=${from}&to=${today}`);
  expect(journal.status()).toBe(200);
  expect((await journal.text()).split("\n")[0]).toMatch(/^entry,date,kind/);

  // Last month closes in order; the bookkeeper cannot reopen it.
  await page.goto("/ledger/periods");
  await page.getByRole("button", { name: `Close ${lastMonth}` }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(`${lastMonth} closed.`)).toBeVisible();
  const closedRow = page.getByTestId("period-row").filter({ hasText: formatPeriod(lastMonth) });
  await expect(closedRow).toContainText("closed");
  await closedRow.getByLabel(`Reason to reopen ${lastMonth}`).fill("bookkeeper try");
  await closedRow.getByRole("button", { name: `Reopen ${lastMonth}` }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Your role does not allow that.")).toBeVisible();
  await expect(page.getByTestId("period-row").filter({ hasText: formatPeriod(lastMonth) })).toContainText("closed");
  await page.screenshot({ path: "test-results/ledger-periods.png", fullPage: true });
  await signOut(page);

  // The owner reopens it with a reason the audit log keeps.
  await signIn(page, seedUserEmail(northwind, "owner"));
  await page.goto("/ledger/periods");
  const reason = `Late invoice found (e2e ${stamp})`;
  const ownerRow = page.getByTestId("period-row").filter({ hasText: formatPeriod(lastMonth) });
  await ownerRow.getByLabel(`Reason to reopen ${lastMonth}`).fill(reason);
  await ownerRow.getByRole("button", { name: `Reopen ${lastMonth}` }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(`${lastMonth} reopened.`)).toBeVisible();
  await expect(page.getByTestId("period-row").filter({ hasText: formatPeriod(lastMonth) })).toContainText("reopened");
  await page.goto("/settings/audit");
  await expect(page.getByText(`period ${lastMonth} reopened: ${reason}`)).toBeVisible();
  await signOut(page);

  // The other company's books hold none of it.
  await signIn(page, seedUserEmail(lakeshore, "bookkeeper"));
  await switchTo(page, lakeshore.name);
  await page.goto(`/ledger/journal?q=${encodeURIComponent(`e2e ledger ${stamp}`)}`);
  await expect(page.getByTestId("journal-row")).toHaveCount(0);
  const foreign = await page.request.get(new URL(manualUrl).pathname);
  expect(foreign.status()).toBe(404);
  await signOut(page);
});
