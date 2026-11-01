import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { addDays, todayInZone } from "../../lib/dates";
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

/** The first day of the month `offset` months from the given business date. */
function firstOfMonth(today: string, offset: number): string {
  const [y, m] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 10);
}

/** "$1,234.56" as integer cents. */
function cents(text: string | null): number {
  return Math.round(Number((text ?? "0").replace(/[^0-9.-]/g, "")) * 100);
}

function dollars(c: number): string {
  return (c / 100).toFixed(2);
}

async function balance(page: Page, accountId: string): Promise<number> {
  await page.goto(`/billing/accounts/${accountId}`);
  return cents(await page.getByTestId("account-balance").textContent());
}

/** Signs a flat monthly general pest plan for the account open on the customer page, starting on the given day. */
async function signPlan(page: Page, accountName: string, startsOn: string, note: string): Promise<{ agreementId: string; visitUrl: string }> {
  await page.getByRole("link", { name: "New agreement" }).click();
  await expect(page).toHaveURL(/\/agreements\/new\?account_id=/);
  // An account with more than one property picks the property first.
  const property = page.getByLabel("Property", { exact: true });
  if ((await property.count()) > 0 && !(await property.inputValue())) {
    await property.selectOption({ index: 1 });
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByLabel("Service type")).toBeVisible();
  }
  await page.getByLabel("Service type").selectOption({ label: "General pest plan" });
  await page.locator("#new-billing").selectOption("flat_monthly");
  await page.locator("#new-initial").fill("249.00");
  await page.locator("#new-recurring").fill("119.00");
  await page.locator("#new-starts").fill(startsOn);
  await page.locator("#new-first").fill(startsOn);
  await page.locator("#new-notes").fill(note);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/agreements\/[0-9a-f-]+$/);
  const agreementId = page.url().split("/").pop() as string;
  await page.getByLabel("Customer's typed name").fill(accountName);
  await page.getByLabel("The customer agrees to the terms above").check();
  await page.getByRole("button", { name: "Sign and activate" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
  const visitUrl = await page.getByRole("link", { name: "Visit 1 on the dispatch board" }).getAttribute("href");
  expect(visitUrl).toMatch(/\/dispatch\/visits\/[0-9a-f-]+$/);
  return { agreementId, visitUrl: visitUrl as string };
}

/** A one-off charge from the manual invoice form. Lands on the invoice page and answers its id. */
async function manualInvoice(page: Page, input: { accountId: string; amount: string; description: string; issue: boolean; issuedOn?: string; po?: string }): Promise<string> {
  await page.goto("/billing/invoices/new");
  await page.locator("#inv-account").selectOption(input.accountId);
  await page.locator("#inv-amount").fill(input.amount);
  await page.locator("#inv-description").fill(input.description);
  if (input.po) await page.locator("#inv-po").fill(input.po);
  if (input.issuedOn) await page.locator("#inv-issued").fill(input.issuedOn);
  const issueBox = page.getByLabel(/Issue now/);
  if (input.issue) await issueBox.check();
  else await issueBox.uncheck();
  await page.getByRole("button", { name: "Create invoice" }).click();
  await expect(page).toHaveURL(/\/billing\/invoices\/[0-9a-f-]+$/);
  return page.url().split("/").pop() as string;
}

async function runJob(page: Page) {
  await page.goto("/billing");
  await page.getByRole("button", { name: "Run the billing job now" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/Job run: \d+ invoice\(s\) issued/)).toBeVisible();
}

// A start well ahead of the seed and of the other tests' dates, so the hold test has a visit of its own to schedule.
const RIVERSIDE_STARTS_ON = "2027-06-01";

test("billing settings, autopay, checks, PO drafts, collections with the dispatch hold, refunds, voids, the tax report, and nothing of it for the other company", async ({ page }) => {
  test.setTimeout(300_000);
  const today = todayInZone(northwind.timezone);
  const stamp = Date.now();
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1, prepare: false, onnotice: () => {} });
  const accounts = await sql<{ id: string; name: string }[]>`
    select a.id, a.name from public.accounts a join public.tenants t on t.id = a.tenant_id where t.name = ${northwind.name} and a.name in ('Maria Lopez', 'Oakwood Properties', 'Riverside Hospitality Group')`;
  const maria = accounts.find((a) => a.name === "Maria Lopez");
  const oakwood = accounts.find((a) => a.name === "Oakwood Properties");
  const riverside = accounts.find((a) => a.name === "Riverside Hospitality Group");
  expect(maria && oakwood && riverside, "the seed gives Northwind its three accounts").toBeTruthy();
  if (!maria || !oakwood || !riverside) throw new Error("seed accounts missing");

  // The owner sets collections: a $15 late fee, no grace, and service on hold while past due.
  await signIn(page, seedUserEmail(northwind, "owner"));
  await page.goto("/billing/settings");
  await page.locator("#late-fee").fill("15.00");
  await page.locator("#late-pct").fill("0");
  await page.locator("#grace").fill("0");
  await page.getByLabel(/Hold service while an account is past due/).check();
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#late-fee")).toHaveValue("15.00");
  await expect(page.locator("#grace")).toHaveValue("0");
  await expect(page.getByLabel(/Hold service while an account is past due/)).toBeChecked();
  await page.screenshot({ path: "test-results/billing-settings.png", fullPage: true });
  await signOut(page);

  // The office puts Maria on autopay with a card ending 4242 (the local gateway keeps only the last four).
  await signIn(page, seedUserEmail(northwind, "office"));
  await page.goto(`/billing/accounts/${maria.id}`);
  await page.locator("#pm-kind").selectOption("card");
  await page.locator("#pm-number").fill("4242 4242 4242 4242");
  await page.locator("#pm-month").fill("12");
  await page.locator("#pm-year").fill("2030");
  await page.getByTestId("add-method").getByLabel("Autopay").check();
  await page.getByRole("button", { name: "Save method" }).click();
  await page.waitForLoadState("networkidle");
  const mariaCard = page.getByTestId("payment-method").filter({ hasText: "4242" });
  await expect(mariaCard).toBeVisible();
  await expect(mariaCard.getByRole("button", { name: "Turn autopay off" })).toBeVisible();
  await expect(page.getByText("4242 4242 4242 4242")).toHaveCount(0);

  // A flat monthly plan that started last month: the job issues the installments due so far and autopay pays them.
  await page.goto(`/customers/${maria.id}`);
  const plan = await signPlan(page, "Maria Lopez", firstOfMonth(today, -1), `e2e billing ${stamp}`);
  await runJob(page);
  const installments = await sql<{ id: string; number: number | null; status: string; total_cents: string }[]>`
    select id, number, status, total_cents::text from public.invoices where agreement_id = ${plan.agreementId} and source = 'installment' order by issued_on, number`;
  expect(installments.length, "last month's and this month's installments").toBeGreaterThanOrEqual(1);
  expect(installments.map((i) => i.status)).toEqual(installments.map(() => "paid"));
  expect(installments[0].total_cents).toBe("5050");
  await page.goto(`/billing/invoices/${installments[0].id}`);
  await expect(page.getByRole("heading", { name: `Invoice #${installments[0].number}` })).toBeVisible();
  await expect(page.getByText("paid", { exact: true })).toBeVisible();
  await expect(page.getByTestId("invoice-total")).toHaveText("$50.50");
  await expect(page.getByTestId("invoice-open")).toHaveText("$0.00");
  await expect(page.getByTestId("allocation-row")).toHaveCount(1);
  await expect(page.getByTestId("allocation-row")).toContainText("card");
  await expect(page.getByTestId("attempt-row").first()).toContainText(/Autopay attempt 1 .*: succeeded/);
  await page.screenshot({ path: "test-results/billing-invoice-autopay.png", fullPage: true });

  // A one-off charge paid by check: the statement balance rises on issue and falls back when the check is recorded.
  const before = await balance(page, maria.id);
  const oneOffId = await manualInvoice(page, { accountId: maria.id, amount: "85.00", description: `Wasp nest removal (e2e ${stamp})`, issue: true });
  await expect(page.getByRole("heading", { name: /Invoice #\d+/ })).toBeVisible();
  await expect(page.getByTestId("invoice-total")).toHaveText("$85.00");
  await expect(page.getByTestId("invoice-line")).toContainText(`Wasp nest removal (e2e ${stamp})`);
  expect(await balance(page, maria.id)).toBe(before + 8500);
  await page.goto(`/billing/invoices/${oneOffId}`);
  await page.locator("#pay-method").selectOption("check");
  await expect(page.locator("#pay-amount")).toHaveValue("85.00");
  await page.locator("#pay-ref").fill(`e2e check ${stamp}`);
  await page.getByRole("button", { name: "Record payment" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("invoice-open")).toHaveText("$0.00");
  await expect(page.getByText("paid", { exact: true })).toBeVisible();
  await expect(page.getByTestId("allocation-row")).toContainText(`e2e check ${stamp}`);
  expect(await balance(page, maria.id)).toBe(before);
  await expect(page.getByTestId("statement-line").filter({ hasText: "Payment (check)" }).first()).toBeVisible();
  await page.screenshot({ path: "test-results/billing-account.png", fullPage: true });

  // Oakwood needs a PO on every invoice: the draft waits for one, then issues.
  await page.goto(`/customers/${oakwood.id}`);
  await page.getByLabel("Purchase order required on invoices").check();
  await page.getByRole("button", { name: "Save account" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("Purchase order required on invoices")).toBeChecked();
  const poInvoiceId = await manualInvoice(page, { accountId: oakwood.id, amount: "300.00", description: `Bait station program (e2e ${stamp})`, issue: false });
  await expect(page.getByRole("heading", { name: "Invoice (draft)" })).toBeVisible();
  await page.goto("/billing");
  await expect(page.getByTestId("draft-row").filter({ hasText: "Oakwood Properties" }).first()).toBeVisible();
  await page.goto(`/billing/invoices/${poInvoiceId}`);
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/needs a PO number/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Invoice (draft)" })).toBeVisible();
  await page.locator("#po").fill(`PO-${stamp}`);
  await page.getByRole("button", { name: "Save PO" }).click();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: /Invoice #\d+/ })).toBeVisible();
  await expect(page.getByText(`PO PO-${stamp}`)).toBeVisible();
  await expect(page.getByText(/net 30/)).toBeVisible();

  // Riverside: a card that declines, a charge from before Bugsy already past its net 30, and a plan whose first visit
  // the dispatcher will try to schedule while the account is on hold.
  await page.goto(`/billing/accounts/${riverside.id}`);
  const riversideBefore = cents(await page.getByTestId("account-balance").textContent());
  await page.locator("#pm-kind").selectOption("card");
  await page.locator("#pm-number").fill("4000000000000002");
  await page.locator("#pm-month").fill("6");
  await page.locator("#pm-year").fill("2031");
  await page.getByTestId("add-method").getByLabel("Autopay").check();
  await page.getByRole("button", { name: "Save method" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("payment-method").filter({ hasText: "0002" })).toBeVisible();
  const staleId = await manualInvoice(page, { accountId: riverside.id, amount: "120.00", description: `Rodent exclusion, pre-Bugsy (e2e ${stamp})`, issue: true, issuedOn: addDays(today, -45) });
  await expect(page.getByText(/net 30/)).toBeVisible();
  await page.goto(`/customers/${riverside.id}`);
  const riversidePlan = await signPlan(page, "Riverside Hospitality Group", RIVERSIDE_STARTS_ON, `e2e billing hold ${stamp}`);
  await runJob(page);
  await expect(page.getByTestId("past-due-row").filter({ hasText: "Riverside Hospitality Group" })).toBeVisible();
  await expect(page.getByTestId("autopay-failure").filter({ hasText: "Riverside Hospitality Group" }).first()).toContainText("failed");
  await page.screenshot({ path: "test-results/billing-home.png", fullPage: true });
  await page.goto(`/billing/invoices/${staleId}`);
  await expect(page.getByText("past due", { exact: true })).toBeVisible();
  await expect(page.getByTestId("invoice-open")).toHaveText("$120.00");
  await expect(page.getByTestId("attempt-row").first()).toContainText(/Autopay attempt 1 .*: failed/);
  await page.goto(`/billing/accounts/${riverside.id}`);
  await expect(page.getByTestId("statement-line").filter({ hasText: "Invoice (late fee)" }).first()).toContainText("$15.00");
  expect(cents(await page.getByTestId("account-balance").textContent())).toBe(riversideBefore + 12000 + 1500);
  await signOut(page);

  // The dispatcher cannot put Riverside's visit on the board while the account is on hold.
  await signIn(page, seedUserEmail(northwind, "dispatcher"));
  await page.goto(riversidePlan.visitUrl);
  await page.getByLabel("Technician (lead)").selectOption({ label: "Sam Rivera" });
  await page.getByLabel("Date", { exact: true }).fill(RIVERSIDE_STARTS_ON);
  await page.getByRole("button", { name: "Schedule visit" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/Service is on hold until the balance is settled/)).toBeVisible();
  await expect(page.getByText("Planned", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/billing-dispatch-hold.png", fullPage: true });
  await signOut(page);

  // Back at the office: the check is refunded (the invoice opens again and the refund shows on the statement) and the
  // Oakwood invoice, unpaid, is voided with a reason.
  await signIn(page, seedUserEmail(northwind, "office"));
  await page.goto(`/billing/invoices/${oneOffId}`);
  await expect(page.getByLabel("Refund amount")).toHaveValue("85.00");
  await page.getByRole("button", { name: "Refund" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("invoice-open")).toHaveText("$85.00");
  await expect(page.getByTestId("allocation-row")).toHaveCount(0);
  await page.goto(`/billing/accounts/${maria.id}`);
  await expect(page.getByTestId("payment-row").filter({ hasText: "refund" }).first()).toBeVisible();
  await expect(page.getByTestId("statement-line").filter({ hasText: "Refund (check)" }).first()).toContainText("$85.00");
  expect(cents(await page.getByTestId("account-balance").textContent())).toBe(before + 8500);
  await page.goto(`/billing/invoices/${poInvoiceId}`);
  await page.locator("#void-reason").fill(`Billed in error (e2e ${stamp})`);
  await page.getByRole("button", { name: "Void invoice" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("void", { exact: true })).toBeVisible();
  await expect(page.getByText(`Void: Billed in error (e2e ${stamp})`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0);
  await page.goto(`/billing/invoices/${oneOffId}/print`);
  await expect(page.getByTestId("invoice-print")).toContainText("Wasp nest removal");
  await page.screenshot({ path: "test-results/billing-invoice-print.png", fullPage: true });
  await signOut(page);

  // The bookkeeper reads the tax report for Northwind and downloads the CSV, with no way to run the job.
  await signIn(page, seedUserEmail(lakeshore, "bookkeeper"));
  await page.getByLabel("Company").selectOption({ label: northwind.name });
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByRole("heading", { name: northwind.name })).toBeVisible();
  await page.goto("/billing");
  await expect(page.getByTestId("open-ar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run the billing job now" })).toHaveCount(0);
  await page.goto("/billing/tax");
  await expect(page.getByTestId("tax-csv")).toBeVisible();
  const csv = await page.request.get(`/api/billing/tax.csv?from=${addDays(today, -60)}&to=${today}`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect((await csv.text()).split("\n")[0]).toMatch(/state/i);
  await page.screenshot({ path: "test-results/billing-tax.png", fullPage: true });
  await signOut(page);

  // The other company sees none of it.
  await signIn(page, seedUserEmail(lakeshore, "office"));
  const foreign = await page.request.get(`/billing/invoices/${oneOffId}`);
  expect(foreign.status()).toBe(404);
  await page.goto("/billing");
  // Lakeshore has its own Riverside Hospitality Group, so the check is by Northwind's account, not the name.
  await expect(page.locator(`[data-testid="past-due-row"] a[href="/billing/accounts/${riverside?.id}"]`)).toHaveCount(0);
  await expect(page.getByTestId("autopay-failure")).toHaveCount(0);
  await signOut(page);

  // Cleanup so the other tests find the seed state: Riverside settles by check, Maria's wasp job is paid again, the hold
  // comes off and Oakwood no longer needs a PO.
  await signIn(page, seedUserEmail(northwind, "owner"));
  await page.goto(`/billing/accounts/${riverside.id}`);
  const owed = cents(await page.getByTestId("account-balance").textContent());
  await page.locator("#acct-method").selectOption("check");
  await page.locator("#acct-amount").fill(dollars(owed));
  await page.locator("#acct-ref").fill(`e2e settle ${stamp}`);
  await page.getByRole("button", { name: "Record payment" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("account-balance")).toHaveText("$0.00");
  await page.goto(`/billing/invoices/${oneOffId}`);
  await page.locator("#pay-method").selectOption("check");
  await page.locator("#pay-ref").fill(`e2e check again ${stamp}`);
  await page.getByRole("button", { name: "Record payment" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("invoice-open")).toHaveText("$0.00");
  await page.goto("/billing/settings");
  await page.getByLabel(/Hold service while an account is past due/).uncheck();
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel(/Hold service while an account is past due/)).not.toBeChecked();
  await page.goto(`/customers/${oakwood.id}`);
  await page.getByLabel("Purchase order required on invoices").uncheck();
  await page.getByRole("button", { name: "Save account" }).click();
  await page.waitForLoadState("networkidle");
  const [flag] = await sql<{ past_due_since: string | null }[]>`select past_due_since::text from public.accounts where id = ${riverside.id}`;
  expect(flag.past_due_since).toBeNull();
  await sql.end();
  await signOut(page);
});
