import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { todayInZone } from "../../lib/dates";
import { SEED_PASSWORD, SEED_TENANTS, seedUserEmail } from "../../scripts/seed-data";

const [northwind, lakeshore] = SEED_TENANTS;
const MARIA_PHONE = "614-555-0100";

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

async function settings(page: Page, values: { quietStart: string; quietEnd: string; reminderDays: string; reviews: boolean }) {
  await page.goto("/settings/messaging");
  await page.locator("#ms-quiet-start").fill(values.quietStart);
  await page.locator("#ms-quiet-end").fill(values.quietEnd);
  await page.locator("#ms-remind-days").fill(values.reminderDays);
  const reviews = page.getByLabel("Review requests");
  if (values.reviews) await reviews.check();
  else await reviews.uncheck();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Messaging settings saved.")).toBeVisible();
}

async function text(page: Page, body: string) {
  const res = await page.request.post("/api/messaging/local", { data: { tenant: northwind.name, from: MARIA_PHONE, body } });
  expect(res.status()).toBe(200);
  return (await res.json()) as { message_id: string; keyword: string | null };
}

test("an office answers customers: a reminder goes out, Maria texts back and gets a reply, STOP stops the next text, a campaign sends, and the other company sees none of it", async ({ page }) => {
  test.setTimeout(300_000);
  const today = todayInZone(northwind.timezone);
  const stamp = Date.now();
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1, prepare: false, onnotice: () => {} });
  const [maria] = await sql<{ id: string }[]>`select a.id from public.accounts a join public.tenants t on t.id = a.tenant_id where t.name = ${northwind.name} and a.name = 'Maria Lopez'`;

  // The owner lets texts go at any hour for the test, reminds the same day, and turns review requests on.
  await signIn(page, seedUserEmail(northwind, "owner"));
  await settings(page, { quietStart: "00:00", quietEnd: "00:00", reminderDays: "0", reviews: true });
  await page.screenshot({ path: "test-results/messaging-settings.png", fullPage: true });

  // A visit for Maria today, so the reminder has something to remind about.
  await page.goto(`/customers/${maria.id}`);
  await page.getByRole("link", { name: "New agreement" }).click();
  await page.getByLabel("Service type").selectOption({ label: "General pest plan" });
  await page.locator("#new-initial").fill("149.00");
  await page.locator("#new-recurring").fill("89.00");
  await page.locator("#new-starts").fill(today);
  await page.locator("#new-first").fill(today);
  await page.locator("#new-notes").fill(`e2e messaging ${stamp}`);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/agreements\/[0-9a-f-]+$/);
  await page.getByLabel("Customer's typed name").fill("Maria Lopez");
  await page.getByLabel("The customer agrees to the terms above").check();
  await page.getByRole("button", { name: "Sign and activate" }).click();
  await page.waitForLoadState("networkidle");
  const visitUrl = (await page.getByRole("link", { name: "Visit 1 on the dispatch board" }).getAttribute("href")) as string;
  await signOut(page);

  // The dispatcher schedules it for today and sends what is due: Maria's reminder goes by text.
  await signIn(page, seedUserEmail(northwind, "dispatcher"));
  await page.goto(visitUrl);
  await page.getByLabel("Technician (lead)").selectOption({ label: "Sam Rivera" });
  await page.getByLabel("Date", { exact: true }).fill(today);
  await page.getByRole("button", { name: "Schedule visit" }).click();
  await page.waitForLoadState("networkidle");
  await page.goto("/messages");
  await page.getByRole("button", { name: "Send what is due now" }).click();
  await expect(page.getByText(/reminder\(s\) and \d+ notice\(s\) queued/)).toBeVisible();
  const visitId = visitUrl.split("/").pop() as string;
  const [reminder] = await sql<{ status: string; channel: string; token: string }[]>`select status, channel, token from public.messages where visit_id = ${visitId} and purpose = 'reminder'`;
  expect(reminder).toMatchObject({ status: "delivered", channel: "sms" });
  await page.goto(`/customers/${maria.id}`);
  await expect(page.getByTestId("timeline-message").filter({ hasText: "reminder" }).first()).toContainText("delivered");

  // Maria texts back; the inbox shows it and the dispatcher answers.
  await text(page, `Running late today? ${stamp}`);
  await page.goto("/messages");
  const item = page.getByTestId("inbox-item").filter({ hasText: `Running late today? ${stamp}` });
  await expect(item).toContainText("Maria Lopez");
  await expect(item).toContainText("new");
  await item.getByRole("textbox").fill(`We will be there by two. ${stamp}`);
  await item.getByRole("button", { name: "Reply" }).click();
  await expect(page.getByText("Reply sent.")).toBeVisible();
  await page.goto(`/customers/${maria.id}`);
  await expect(page.getByTestId("timeline-message").filter({ hasText: `We will be there by two. ${stamp}` })).toContainText("delivered");
  await page.screenshot({ path: "test-results/messaging-timeline.png", fullPage: true });

  // STOP: the confirmation goes, and the next text to Maria does not.
  expect((await text(page, "STOP")).keyword).toBe("stop");
  await page.goto(`/customers/${maria.id}`);
  const send = page.getByTestId("send-message");
  await send.getByLabel("By").selectOption("sms");
  await send.getByLabel("Message").fill(`Are you home Thursday? ${stamp}`);
  await send.getByRole("button", { name: "Send" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("timeline-message").filter({ hasText: `Are you home Thursday? ${stamp}` })).toContainText("Not sent: opted out by text");
  expect((await text(page, "START")).keyword).toBe("start");
  await signOut(page);

  // The owner sends a campaign to residential accounts after seeing how many it reaches.
  await signIn(page, seedUserEmail(northwind, "owner"));
  await page.goto("/messages/campaigns");
  await page.locator("#cmp-name").fill(`Spring termite check ${stamp}`);
  await page.locator("#cmp-channel").selectOption("sms");
  await page.locator("#cmp-body").fill("{{company_name}}: free termite check this spring for {{customer_name}}. Reply YES to book.");
  await page.locator("#cmp-type").selectOption("residential");
  await page.getByRole("button", { name: "Save and preview" }).click();
  await expect(page).toHaveURL(/\/messages\/campaigns\/[0-9a-f-]+$/);
  const count = Number(await page.getByTestId("campaign-count").innerText());
  expect(count).toBeGreaterThan(0);
  await expect(page.getByTestId("campaign-sample").filter({ hasText: "Maria Lopez" })).toBeVisible();
  await page.getByRole("button", { name: "Send now" }).click();
  await expect(page.getByText(new RegExp(`queued of ${count} in the audience`))).toBeVisible();
  await expect(page.getByTestId("campaign-sent")).toBeVisible();
  await page.screenshot({ path: "test-results/messaging-campaign.png", fullPage: true });

  // The public page shows a sent message by its link alone; the unsubscribe link takes a confirming click.
  await signOut(page);
  await page.goto(`/m/${reminder.token}`);
  await expect(page.getByTestId("message-view")).toContainText("General pest plan");
  const [email] = await sql<{ token: string }[]>`select token from public.messages where account_id = ${maria.id} and channel = 'email' and status = 'delivered' order by created_at desc limit 1`;
  await page.goto(`/u/${email.token}`);
  await page.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(page.getByTestId("unsubscribe")).toContainText("You are unsubscribed");

  // The other company sees none of it.
  await signIn(page, seedUserEmail(lakeshore, "office"));
  await page.goto("/messages");
  await expect(page.getByTestId("inbox-item").filter({ hasText: String(stamp) })).toHaveCount(0);
  await signOut(page);

  // Leave the seed state as it was: Maria subscribed to email again, the settings back to their defaults.
  await sql`delete from public.message_opt_outs where address = 'maria.lopez@northwind.test'`;
  await signIn(page, seedUserEmail(northwind, "owner"));
  await settings(page, { quietStart: "08:00", quietEnd: "21:00", reminderDays: "1", reviews: false });
  await signOut(page);
  await sql.end();
});
