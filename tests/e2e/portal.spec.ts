import { expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import postgres from "postgres";
import { addDays, todayInZone } from "../../lib/dates";
import { PG_TYPES } from "../../lib/pg-types";
import { SEED_PASSWORD, SEED_TENANTS, portalCustomerEmail, seedUserEmail } from "../../scripts/seed-data";

const [northwind, lakeshore] = SEED_TENANTS;

async function signIn(page: Page, email: string, password = SEED_PASSWORD, landing: RegExp = /\/(tech|portal)?$/) {
  await page.goto("/sign-in");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(landing);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
}

test("the customer portal: an invited customer pays, asks for a re-service and moves a visit; a restaurant logs a sighting and takes its binder; a prospect books from the website", async ({ page }) => {
  test.setTimeout(300_000);
  const stamp = Date.now();
  const today = todayInZone(northwind.timezone);
  const email = `maria+${stamp}@example.test`;
  const password = `portal-${stamp}`;
  // A charge of this run's own, so a rerun on the same data still finds exactly one.
  const amount = (60 + (stamp % 3000) / 100).toFixed(2);
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1, prepare: false, onnotice: () => {}, types: PG_TYPES });
  const [maria] = await sql<{ id: string }[]>`select a.id from public.accounts a join public.tenants t on t.id = a.tenant_id where t.name = ${northwind.name} and a.name = 'Maria Lopez'`;
  const [bistroInvoice] = await sql<{ id: string }[]>`
    select i.id from public.invoices i join public.accounts a on a.id = i.account_id join public.tenants t on t.id = a.tenant_id
    where t.name = ${northwind.name} and a.name <> 'Maria Lopez' and i.status <> 'draft' limit 1`;
  const [form] = await sql<{ key: string }[]>`select f.key from public.lead_forms f join public.tenants t on t.id = f.tenant_id where t.name = ${northwind.name} and f.name = 'Book a visit'`;
  // A visit of Maria's that can be moved: planned, its window starting at least two days out.
  const [movable] = await sql<{ id: string; due_start: string; due_end: string; status: string }[]>`
    select v.id, v.due_start::text, v.due_end::text, v.status from public.visits v left join public.branches b on b.id = v.branch_id
    where v.account_id = ${maria.id} and v.status in ('planned', 'scheduled') and v.kind in ('initial', 'recurring')
      and v.due_start >= ${addDays(today, 3)}::date and v.due_end > v.due_start + 2
      -- Dispatch refuses a day after the branch's license lapses, so the visit sits wholly before that.
      and (b.license_expires_on is null or b.license_expires_on > v.due_start + 7)
    order by v.due_start limit 1`;
  expect(maria && bistroInvoice && form && movable, "the seed has Maria, another account's invoice, the booking form and a visit to move").toBeTruthy();

  // 1. The office: a charge for Maria, her next visit on the board, and a portal invitation.
  await signIn(page, seedUserEmail(northwind, "owner"));
  await page.goto("/billing/invoices/new");
  await page.locator("#inv-account").selectOption(maria.id);
  await page.locator("#inv-amount").fill(amount);
  await page.locator("#inv-description").fill(`Wasp nest removal (e2e portal ${stamp})`);
  await page.getByLabel(/Issue now/).check();
  await page.getByRole("button", { name: "Create invoice" }).click();
  await expect(page).toHaveURL(/\/billing\/invoices\/[0-9a-f-]+$/);
  const invoiceId = page.url().split("/").pop() as string;
  if (movable.status === "planned") {
    await page.goto(`/dispatch/visits/${movable.id}`);
    await page.getByLabel("Technician (lead)").selectOption({ label: "Sam Rivera" });
    // Early in its window, so the day it moves to stays clear of anything that changes later in the month.
    await page.getByLabel("Date").fill(addDays(movable.due_start, 3));
    await page.getByRole("button", { name: "Schedule visit" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/lead Sam Rivera/)).toBeVisible();
  }
  await page.goto(`/customers/${maria.id}#portal`);
  await page.locator("#portal-email").fill(email);
  await page.getByRole("button", { name: "Send portal invitation" }).click();
  await page.waitForLoadState("networkidle");
  const row = page.getByTestId("portal-user").filter({ hasText: email });
  await expect(row).toContainText("invited");
  // Staff never see the link: it is read from the message sent to Maria.
  await expect(row.getByText("/portal/invite/")).toHaveCount(0);
  const [message] = await sql<{ body: string }[]>`select body from public.messages where lower(to_address) = ${email} order by created_at desc limit 1`;
  const link = message?.body.match(/\/portal\/invite\/[0-9a-f-]{36}/)?.[0] as string;
  expect(link).toMatch(/^\/portal\/invite\/[0-9a-f-]{36}$/);
  await signOut(page);

  // 2. Maria sets her password from the link and lands on her portal.
  await page.goto(link);
  await page.getByLabel("Choose a password").fill(password);
  await page.getByLabel("Type it again").fill(password);
  await page.getByRole("button", { name: "Create my login" }).click();
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByRole("heading", { name: "Maria Lopez" })).toBeVisible();
  await expect(page.getByTestId("portal-upcoming")).toBeVisible();
  await expect(page.getByTestId("portal-open-invoice").filter({ hasText: `$${amount}` })).toHaveCount(1);
  await page.screenshot({ path: "test-results/portal-home.png", fullPage: true });

  // 3. A card, then the invoice paid with it.
  await page.getByRole("link", { name: "Billing", exact: true }).click();
  await page.getByLabel("Card number").fill("4242 4242 4242 4242");
  await page.getByLabel("Month").fill("12");
  await page.getByLabel("Year").fill("2031");
  await page.getByRole("button", { name: "Save card" }).click();
  await expect(page.getByTestId("portal-card").filter({ hasText: "4242" })).toBeVisible();
  await page.goto(`/portal/invoices/${invoiceId}`);
  await page.getByRole("button", { name: "Pay now" }).click();
  await expect(page.getByText("Paid. Thank you.")).toBeVisible();
  await expect(page.getByTestId("portal-invoice-open")).toContainText("open $0.00");
  await page.screenshot({ path: "test-results/portal-paid.png", fullPage: true });

  // 4. A re-service request, and the next visit moved inside its window (and refused outside it).
  await page.goto("/portal/requests");
  await page.getByLabel("What are you seeing, and where?").fill(`Ants by the back door again (${stamp})`);
  await page.getByRole("button", { name: "Ask for a re-service" }).click();
  await expect(page.getByText(/Request sent/)).toBeVisible();
  await page.goto(`/portal/visits/${movable.id}`);
  await page.locator("#date").evaluate((el, d) => {
    const o = document.createElement("option");
    o.value = d;
    o.textContent = d;
    (el as HTMLSelectElement).appendChild(o);
    (el as HTMLSelectElement).value = d;
  }, addDays(movable.due_end, 5));
  await page.getByRole("button", { name: "Move my visit" }).click();
  await expect(page.getByText(/Pick a day from \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}\./)).toBeVisible();
  const firstDay = await page.locator("#date option").first().getAttribute("value");
  await page.locator("#date").selectOption(firstDay as string);
  await page.getByRole("button", { name: "Move my visit" }).click();
  await expect(page.getByText("Moved. We will see you then.")).toBeVisible();
  const [moved] = await sql<{ scheduled_for: string }[]>`select scheduled_for::text from public.visits where id = ${movable.id}`;
  expect(moved.scheduled_for).toBe(firstDay);
  // Maria cannot open another account's invoice.
  expect((await page.goto(`/portal/invoices/${bistroInvoice.id}`))?.status()).toBe(404);
  await page.goto("/portal");
  await signOut(page);

  // 5. The office sees the payment and books the re-service from the inbox; Maria sees the answer.
  await signIn(page, seedUserEmail(northwind, "owner"));
  await page.goto(`/billing/invoices/${invoiceId}`);
  await expect(page.getByText("paid", { exact: true }).first()).toBeVisible();
  await page.goto("/requests");
  const request = page.getByTestId("request-row").filter({ hasText: `(${stamp})` });
  await request.getByRole("button", { name: "Book re-service" }).click();
  await expect(page.getByText("Re-service booked; it is on the dispatch board.")).toBeVisible();
  await page.screenshot({ path: "test-results/portal-requests-office.png", fullPage: true });
  await signOut(page);
  await signIn(page, email, password, /\/portal$/);
  await page.goto("/portal/requests");
  await expect(page.getByTestId("portal-request").filter({ hasText: `(${stamp})` })).toContainText("Booked");
  await signOut(page);

  // 6. Corner Bistro's manager: the site map, a sighting, and the binder holding it.
  await signIn(page, portalCustomerEmail(northwind), SEED_PASSWORD, /\/portal$/);
  await page.getByRole("link", { name: "Restaurant", exact: true }).click();
  await expect(page).toHaveURL(/\/portal\/sites\/[0-9a-f-]+/);
  await expect(page.getByTestId("portal-site-map").first()).toBeVisible();
  await page.getByLabel("What did you see?").fill(`Fruit flies (${stamp})`);
  await page.getByLabel("Where?").fill("Bar drains");
  await page.getByRole("button", { name: "Log sighting" }).click();
  await expect(page.getByTestId("portal-sighting").filter({ hasText: `Fruit flies (${stamp})` })).toBeVisible();
  const binderHref = (await page.getByTestId("portal-binder").getAttribute("href")) as string;
  const binder = await page.request.get(binderHref);
  expect(binder.status()).toBe(200);
  const files = unzipSync(new Uint8Array(await binder.body()));
  expect(strFromU8(files["sightings.csv"])).toContain(`Fruit flies (${stamp})`);
  expect(Object.keys(files)).toContain("devices.csv");
  await page.screenshot({ path: "test-results/portal-site.png", fullPage: true });
  await signOut(page);

  // 7. A prospect books from the company's website; the office sees the lead with what was asked.
  await page.goto(`/f/${form.key}`);
  await page.getByLabel("Your name").fill(`Robin Prospect ${stamp}`);
  await page.getByLabel("Email").fill(`robin+${stamp}@example.test`);
  await page.getByLabel("Service address").fill("12 Elm Street");
  await page.getByLabel("City").fill("Columbus");
  await page.getByLabel("State").fill("OH");
  await page.getByLabel("Preferred day").fill(addDays(today, 7));
  await page.getByLabel("What are you seeing?").fill("Mice in the garage.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("form-thanks")).toBeVisible();
  await page.screenshot({ path: "test-results/portal-booking-form.png", fullPage: true });
  await signIn(page, seedUserEmail(northwind, "owner"));
  await page.goto("/leads");
  await page.getByRole("link", { name: `Robin Prospect ${stamp}` }).click();
  await expect(page.getByText(/From the "Book a visit" form/)).toBeVisible();
  await signOut(page);

  // 8. Another company sees none of it.
  await signIn(page, seedUserEmail(lakeshore, "owner"));
  await page.goto("/requests?show=all");
  await expect(page.getByTestId("request-row").filter({ hasText: `(${stamp})` })).toHaveCount(0);
  expect((await page.goto(`/customers/${maria.id}`))?.status()).toBe(404);
  await page.goto("/");
  await signOut(page);
  await sql.end();
});
