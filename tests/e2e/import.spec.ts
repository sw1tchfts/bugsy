import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { SEED_PASSWORD, SEED_TENANTS, seedUserEmail } from "../../scripts/seed-data";

const [northwind, lakeshore] = SEED_TENANTS;
const DIR = path.join(__dirname, "..", "..", "fixtures", "import");
const KINDS = ["accounts", "properties", "contacts", "agreements", "balances"] as const;

type Expected = { cutover_on: string; counts: Record<(typeof KINDS)[number], number>; agreements: { external_id: string; done_sequences: number[]; opening_position_cents: number; warning: boolean }[] };
const expected = JSON.parse(readFileSync(path.join(DIR, "expected.json"), "utf8")) as Expected;

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

/** The fixture files with every old-system id made unique to this run, so the test can run again. */
function files(stamp: string, mutate: Partial<Record<(typeof KINDS)[number], (text: string) => string>> = {}) {
  return KINDS.map((k) => {
    let text = readFileSync(path.join(DIR, `${k}.csv`), "utf8").replace(/\b([APCG])-(\d+)\b/g, `$1-${stamp}-$2`);
    text = text.replace(/\b(INV|CR)-(\d+)\b/g, `$1-${stamp}-$2`);
    if (mutate[k]) text = (mutate[k] as (t: string) => string)(text);
    return { kind: k, file: { name: `${k}.csv`, mimeType: "text/csv", buffer: Buffer.from(text) } };
  });
}

async function upload(page: Page, set: ReturnType<typeof files>, mode: "Dry run" | "Import") {
  await page.goto("/settings/import");
  await page.locator("#cutover").fill(expected.cutover_on);
  for (const f of set) await page.locator(`#file-${f.kind}`).setInputFiles(f.file);
  await page.getByRole("button", { name: mode, exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/import\/[0-9a-f-]+$/);
}

test("the owner goes live from spreadsheets: row errors with nothing written, a dry run, the import, a second run that skips, and history files kept", async ({ page }) => {
  test.setTimeout(300_000);
  const stamp = String(Date.now()).slice(-7);
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1, prepare: false, onnotice: () => {} });
  const [tenant] = await sql<{ id: string }[]>`select id from public.tenants where name = ${northwind.name}`;
  const count = async (ext: string) => (await sql<{ n: number }[]>`select count(*)::int as n from public.accounts where tenant_id = ${tenant.id} and external_id = ${ext}`)[0].n;

  await signIn(page, seedUserEmail(northwind, "owner"));

  // The templates download with their header row.
  await page.goto("/settings/import");
  await expect(page.getByTestId("template")).toHaveCount(5);
  const template = await page.request.get("/api/import/templates/agreements.csv");
  expect(template.status()).toBe(200);
  expect((await template.text()).split("\n")[0]).toMatch(/^external_id,account_external_id,property_external_id,service_type,cadence,billing_mode,starts_on/);

  // A broken properties file: the import fails whole, names each row and column, and writes nothing.
  const broken = files(stamp, {
    properties: (t) => t.replace(",Columbus,OH,43215,apartment_building,,,18,", ",Columbus,Ohio,43215,apartment_building,,,18,").replace("P-" + stamp + "-2004,A-" + stamp + "-1003,Home,\"88 Maple Ave, Unit 2\",,Columbus,oh,43205,townhouse", "P-" + stamp + "-2004,A-" + stamp + "-1003,Home,\"88 Maple Ave, Unit 2\",,Columbus,oh,,barn"),
  });
  await upload(page, broken, "Import");
  await expect(page.getByTestId("batch-title")).toHaveText(/Not imported/);
  const errorsList = page.getByTestId("row-error");
  await expect(errorsList.filter({ hasText: "properties.csv" }).filter({ hasText: "state" })).toContainText('"Ohio" is not a two-letter state');
  await expect(errorsList.filter({ hasText: "postal_code" })).toContainText("is required");
  await expect(errorsList.filter({ hasText: "property_type" })).toContainText('"barn"');
  // References to the broken properties fail too, row by row.
  await expect(errorsList.filter({ hasText: "agreements.csv" }).first()).toContainText(/no property P-\d+-2004/);
  expect(await count(`A-${stamp}-1001`)).toBe(0);
  await page.screenshot({ path: "test-results/import-errors.png", fullPage: true });

  // The dry run of the good files counts what the fixture says and still writes nothing.
  const good = files(stamp);
  await upload(page, good, "Dry run");
  await expect(page.getByTestId("batch-title")).toHaveText(/Dry run/);
  for (const k of KINDS) await expect(page.getByTestId(`created-${k}`)).toHaveText(String(expected.counts[k]));
  await expect(page.getByTestId("row-error")).toHaveCount(0);
  const warned = expected.agreements.filter((a) => a.warning).map((a) => a.external_id.replace("G-", `G-${stamp}-`));
  await expect(page.getByTestId("row-warning").filter({ hasText: "billed to date" })).toHaveCount(warned.length);
  expect(await count(`A-${stamp}-1001`)).toBe(0);

  // The import writes exactly that.
  await upload(page, good, "Import");
  await expect(page.getByTestId("batch-title")).toHaveText("Imported");
  for (const k of KINDS) await expect(page.getByTestId(`created-${k}`)).toHaveText(String(expected.counts[k]));
  await expect(page.getByTestId("kept-template")).toHaveCount(5);
  await page.screenshot({ path: "test-results/import-report.png", fullPage: true });
  expect(await count(`A-${stamp}-1001`)).toBe(1);

  // The mid-term flat monthly plan: three visits done before Bugsy, the October visit next.
  const g1 = expected.agreements.find((a) => a.external_id === "G-1")!;
  const [agreement] = await sql<{ id: string; number: number }[]>`select id, number from public.agreements where tenant_id = ${tenant.id} and external_id = ${`G-${stamp}-1`}`;
  await page.goto(`/agreements/${agreement.id}`);
  await expect(page.getByTestId("agreement-visit").filter({ hasText: "done before Bugsy" })).toHaveCount(g1.done_sequences.length);
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: "test-results/import-agreement.png", fullPage: true });

  // The opening invoice is on the bistro's statement, and the opening entries are in the journal.
  const [bistro] = await sql<{ id: string }[]>`select id from public.accounts where tenant_id = ${tenant.id} and external_id = ${`A-${stamp}-1004`}`;
  await page.goto(`/billing/accounts/${bistro.id}`);
  await expect(page.getByTestId("statement-line").filter({ hasText: "Invoice (opening)" })).toContainText("$41.66");
  await page.goto(`/ledger/journal?source_type=opening&q=${encodeURIComponent(`agreement #${agreement.number}:`)}`);
  await expect(page.getByTestId("journal-row")).toHaveCount(1);
  await page.getByTestId("journal-row").getByRole("link").click();
  await expect(page.getByTestId("journal-line").filter({ hasText: "Deferred revenue" })).toContainText(`$${(-g1.opening_position_cents / 100).toFixed(2)}`);

  // The same files again: every row is skipped.
  await upload(page, good, "Import");
  await expect(page.getByTestId("batch-title")).toHaveText("Imported");
  for (const k of KINDS) {
    await expect(page.getByTestId(`created-${k}`)).toHaveText("0");
  }
  for (const k of ["accounts", "properties", "contacts", "agreements", "balances"] as const) await expect(page.getByTestId(`skipped-${k}`)).toHaveText(String(expected.counts[k]));

  // Records from before Bugsy, kept with a batch of their own.
  await page.goto("/settings/import");
  await page.locator("#cutover").fill(expected.cutover_on);
  await page.locator("#file-history").setInputFiles({ name: `old-records-${stamp}.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% old application records\n") });
  await page.locator("#history-label").fill("2025 application records");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/import\/[0-9a-f-]+$/);
  await expect(page.getByTestId("kept-history")).toContainText(`old-records-${stamp}.pdf`);
  await expect(page.getByTestId("retention")).toContainText("OH:");
  await signOut(page);

  // The other company sees none of it.
  await signIn(page, seedUserEmail(lakeshore, "owner"));
  await page.goto(`/customers?q=${encodeURIComponent("Corner Bistro")}`);
  const foreign = await page.request.get(`/agreements/${agreement.id}`);
  expect(foreign.status()).toBe(404);
  await signOut(page);
  await sql.end();
});
