import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { PG_TYPES } from "../../lib/pg-types";
import { SEED_PASSWORD, SEED_TENANTS, portalCustomerEmail, seedUserEmail } from "../../scripts/seed-data";

const [northwind, lakeshore] = SEED_TENANTS;

async function signIn(page: Page, email: string, landing: RegExp = /\/(tech|portal)?$/) {
  await page.goto("/sign-in");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(landing);
}

async function signOut(page: Page) {
  if (!(await page.getByRole("button", { name: "Sign out" }).isVisible())) await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
}

test("AI: a drafted note, label rates read and saved by a person, an unusual amount flagged, plans at risk with reasons, and portal questions answered from the records or by the office", async ({ page }) => {
  test.setTimeout(240_000);
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1, prepare: false, onnotice: () => {}, types: PG_TYPES });
  const [tenant] = await sql<{ id: string }[]>`select id from public.tenants where name = ${northwind.name}`;
  const run = Date.now().toString().slice(-6);

  // 1. The technician's draft of the customer's note comes from the stop's own capture (no key here: the local provider).
  await signIn(page, seedUserEmail(northwind, "technician"));
  const [visit] = await sql<{ id: string }[]>`select id from public.visits where tenant_id = ${tenant.id} and status = 'completed' order by completed_at desc limit 1`;
  const draft = await page.request.post("/api/tech/summary-draft", {
    data: { visit_id: visit.id, language: "en", capture: { notes: ["sealed two gaps by the garage door"], conditions: [], recommendations: ["keep the mulch a foot from the foundation"], areas: ["perimeter"], pests: ["ants"], products: ["Talstar P"] } },
  });
  const drafted = (await draft.json()) as { text?: string };
  expect(drafted.text).toContain("Sealed two gaps by the garage door.");
  expect(drafted.text).toContain("We recommend: keep the mulch a foot from the foundation.");
  expect(drafted.text).not.toContain("Talstar");
  await signOut(page);

  // 2. The owner reads a label's rates into a new product; they are kept only because the owner saves the product.
  await signIn(page, seedUserEmail(northwind, "owner"));
  await page.goto("/catalog/products");
  const reader = page.getByTestId("label-reader").last();
  await reader.locator("summary").click();
  await reader.getByLabel("Label directions for use").fill("DIRECTIONS FOR USE\nPerimeter: 0.2 to 0.8 fl oz per gallon of water.\nIndoor crack and crevice - apply 0.5 to 1 fl oz per gallon.");
  await reader.getByRole("button", { name: "Read the rates" }).click();
  await expect(reader.getByTestId("label-rows")).toContainText("perimeter: 0.2 to 0.8 fl_oz/gal");
  await reader.getByRole("button", { name: "Use these rates in the form" }).click();
  await expect(page.locator("#new-rates")).toHaveValue(/indoor crack and crevice/);
  const name = `E2E Label ${run}`;
  await page.locator("#new-name").fill(name);
  await page.locator("#new-epa").fill(`9999-${run.slice(-3)}`);
  await page.screenshot({ path: "test-results/ai-label.png", fullPage: true });
  await page.getByRole("button", { name: "Add product" }).click();
  await expect.poll(async () => (await sql<{ rates: { site: string }[] }[]>`select label_rates as rates from public.products where tenant_id = ${tenant.id} and name = ${name}`)[0]?.rates.map((r) => r.site) ?? []).toEqual(["perimeter", "indoor crack and crevice"]);

  // 3. An application above the label is flagged on the compliance home for a licensed manager to review.
  const [done] = await sql<{ visit_id: string; product_id: string; user_id: string }[]>`
    select vp.visit_id, vp.product_id, c.user_id from public.visit_products vp join public.visit_crew c on c.visit_id = vp.visit_id and c.role = 'lead'
    where vp.tenant_id = ${tenant.id} order by vp.recorded_at desc limit 1`;
  const [flagged] = await sql<{ id: string }[]>`
    insert into public.visit_products (tenant_id, visit_id, product_id, applied_by, site_treated, location_description, amount, amount_unit, carrier_amount, carrier_unit, target_pests, label_check, recorded_at)
    values (${tenant.id}, ${done.visit_id}, ${done.product_id}, ${done.user_id}, 'perimeter', ${`e2e amount check ${run}`}, 9, 'fl_oz', 1, 'gal', ${["ants"]},
            ${sql.json({ status: "above_label", reason: "9 fl_oz/gal is above the label" })}, now())
    returning id`;
  await page.goto("/compliance");
  await expect(page.getByTestId("amount-flag").filter({ hasText: "above the label" }).first()).toBeVisible();
  await sql`delete from public.visit_products where id = ${flagged.id}`;

  // 4. The plans most at risk, each with its reasons; the account shows its risk.
  await page.goto("/reports/churn-risk");
  const green = page.getByTestId("churn-row").filter({ hasText: "Green Residence" }).first();
  await expect(green).toContainText("Wrote in about cancelling");
  await expect(green).toContainText("Rated a visit 4 out of 10");
  await page.screenshot({ path: "test-results/ai-churn.png", fullPage: true });
  await green.getByRole("link", { name: "Green Residence" }).click();
  await expect(page.getByTestId("churn-badge")).toContainText("Churn risk");
  await page.goto("/settings/ai");
  await expect(page.getByText("No AI key is set")).toBeVisible();
  await signOut(page);

  // 5. A portal customer asks: their next visit is answered from their records; a question the records cannot answer
  //    waits for the office.
  await signIn(page, portalCustomerEmail(northwind), /\/portal$/);
  const ask = page.getByTestId("ask-box");
  await ask.getByLabel("Your question").fill("When is my next visit?");
  await ask.getByRole("button", { name: "Ask" }).click();
  await expect(ask.getByTestId("ask-answer")).toContainText(/Your next visit|no visit scheduled/);
  const offRecord = `Could you also look at the loading dock door seal? (${run})`;
  await ask.getByLabel("Your question").fill(offRecord);
  await ask.getByRole("button", { name: "Ask" }).click();
  await expect(ask.getByTestId("ask-answer")).toContainText("sent your question to the office");
  await page.goto("/portal");
  await expect(page.getByTestId("my-question").filter({ hasText: offRecord })).toContainText("Waiting for the office");
  await page.screenshot({ path: "test-results/ai-portal.png", fullPage: true });
  await signOut(page);

  // 6. The office answers it, and the customer sees the answer.
  await signIn(page, seedUserEmail(northwind, "office"));
  await page.goto("/requests");
  const waiting = page.getByTestId("portal-question").filter({ hasText: offRecord });
  await waiting.getByRole("textbox").fill("Yes, the technician will check the dock door seal on the next visit.");
  await waiting.getByRole("button", { name: "Answer" }).click();
  await expect(page.getByText("Answered. The customer sees it in the portal.")).toBeVisible();
  await signOut(page);
  await signIn(page, portalCustomerEmail(northwind), /\/portal$/);
  await expect(page.getByTestId("my-question").filter({ hasText: offRecord })).toContainText("will check the dock door seal");
  await signOut(page);

  // 7. Another company sees none of it.
  await signIn(page, seedUserEmail(lakeshore, "owner"));
  await page.goto("/requests");
  await expect(page.getByTestId("portal-question").filter({ hasText: offRecord })).toHaveCount(0);
  await page.goto("/compliance");
  await expect(page.getByTestId("amount-flag").filter({ hasText: `e2e amount check ${run}` })).toHaveCount(0);
  const [nwGreen] = await sql<{ id: string }[]>`select id from public.accounts where tenant_id = ${tenant.id} and name = 'Green Residence'`;
  await page.goto("/reports/churn-risk");
  await expect(page.locator(`a[href="/customers/${nwGreen.id}"]`)).toHaveCount(0);
  await signOut(page);
  await sql.end();
});
