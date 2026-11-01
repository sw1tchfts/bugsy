import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { todayInZone } from "../../lib/dates";
import { PG_TYPES } from "../../lib/pg-types";
import { SEED_PASSWORD, SEED_TENANTS, seedUserEmail } from "../../scripts/seed-data";
import { routingDemoDay } from "../../scripts/seed-routing";

const [northwind, lakeshore] = SEED_TENANTS;

async function signIn(page: Page, email: string, landing: RegExp = /\/(tech)?$/) {
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

const samMiles = async (page: Page) => Number((await page.getByTestId("route-tech").filter({ hasText: "Sam Rivera" }).getByTestId("route-miles").textContent())?.trim());

test("routing: a zigzag day optimized with its morning stop first, a gap filled, a day assigned with a refusal, a truck on the map, and an arrival estimate in the on-the-way text", async ({ page, context }) => {
  test.setTimeout(240_000);
  const today = todayInZone(northwind.timezone);
  const day = routingDemoDay(today);
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1, prepare: false, onnotice: () => {}, types: PG_TYPES });
  const [tenant] = await sql<{ id: string }[]>`select id from public.tenants where name = ${northwind.name}`;

  // 1. The dispatcher optimizes Sam's seeded zigzag day.
  await signIn(page, seedUserEmail(northwind, "dispatcher"));
  await page.goto(`/dispatch/routes?day=${day}`);
  const before = await samMiles(page);
  expect(before).toBeGreaterThan(0);
  await page.getByTestId("route-tech").filter({ hasText: "Sam Rivera" }).getByRole("link", { name: "Optimize day" }).click();
  const optimized = page.getByTestId("optimized-stop");
  await expect(optimized.first()).toContainText("morning");
  await page.screenshot({ path: "test-results/routing-preview.png", fullPage: true });
  await page.getByRole("button", { name: "Use this order" }).click();
  await expect(page.getByText(/Day reordered: [\d.]+ to [\d.]+ miles\./)).toBeVisible();
  const after = await samMiles(page);
  // A rerun finds the day already optimized; the order never gets longer.
  expect(after).toBeLessThanOrEqual(before);
  const [first] = await sql<{ arrival_window: string }[]>`
    select v.arrival_window from public.visits v where v.tenant_id = ${tenant.id} and v.scheduled_for = ${day} and v.dispatch_notes like 'seed:route %' and v.route_position = 1`;
  if (first) expect(first.arrival_window).toBe("morning");

  // 2. A gap filled with the nearest due visit, then the rest of the day assigned: the other-state visit is refused.
  await page.getByTestId("route-tech").filter({ hasText: "Sam Rivera" }).getByRole("link", { name: "Fill this day" }).click();
  const fill = page.getByTestId("fill-in").filter({ hasText: "MIDTOWN AVE" });
  const [pending] = await sql<{ status: string }[]>`select status from public.visits where tenant_id = ${tenant.id} and dispatch_notes = 'seed:route due'`;
  if (pending.status === "planned") {
    await expect(fill).toBeVisible();
    await fill.getByRole("button", { name: "Schedule" }).click();
    await expect(page.getByText(/^Scheduled/)).toBeVisible();
  }
  const [midtown] = await sql<{ status: string }[]>`select status from public.visits where tenant_id = ${tenant.id} and dispatch_notes = 'seed:route due'`;
  expect(midtown.status).toBe("scheduled");
  await page.getByRole("link", { name: "Assign the day's unassigned visits" }).click();
  await expect(page.getByTestId("assign-unplaced")).toContainText("STATELINE AVE");
  await page.screenshot({ path: "test-results/routing-assign.png", fullPage: true });
  await signOut(page);

  // 3. Sam's phone shares where he is once he clocks in; the board shows it.
  await signIn(page, seedUserEmail(northwind, "technician"));
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 39.9652, longitude: -82.9935 });
  await page.goto("/tech");
  if ((await page.getByTestId("clock-state").textContent())?.includes("Not clocked in")) await page.getByRole("button", { name: "Clock in" }).click();
  await expect(page.getByTestId("position-shared")).toBeVisible();
  await expect
    .poll(async () => (await sql<{ n: number }[]>`select count(*)::int as n from public.technician_positions p join auth.users u on u.id = p.user_id where p.tenant_id = ${tenant.id} and u.email = ${seedUserEmail(northwind, "technician")} and p.recorded_at > now() - interval '2 minutes'`)[0].n, { timeout: 30_000 })
    .toBeGreaterThan(0);

  // 4. On the way to a stop today: the text carries an arrival estimate.
  const [stop] = await sql<{ id: string }[]>`
    select v.id from public.visits v join auth.users u on u.id = v.technician_id
    where v.tenant_id = ${tenant.id} and u.email = ${seedUserEmail(northwind, "technician")} and v.scheduled_for = ${today} and v.status = 'scheduled' order by v.route_position limit 1`;
  if (stop) {
    await page.goto(`/tech?visit=${stop.id}`);
    await page.getByRole("button", { name: "On my way" }).click();
    await expect(page.getByTestId("pending-count")).toHaveText("All changes synced", { timeout: 30_000 });
    await expect
      .poll(async () => (await sql<{ body: string }[]>`select body from public.messages where tenant_id = ${tenant.id} and visit_id = ${stop.id} and purpose = 'on_the_way' order by created_at desc limit 1`)[0]?.body ?? "", { timeout: 30_000 })
      .toMatch(/should arrive (between \d{1,2}:\d{2} [AP]M and \d{1,2}:\d{2} [AP]M|shortly)/);
  }
  await page.goto("/tech");
  await page.getByRole("button", { name: "Clock out" }).click();
  await signOut(page);

  await signIn(page, seedUserEmail(northwind, "dispatcher"));
  await page.goto(`/dispatch/routes?day=${today}`);
  await expect(page.getByTestId("route-tech").filter({ hasText: "Sam Rivera" }).getByTestId("last-seen")).toContainText("min ago");
  await expect(page.getByTestId("route-map-position").filter({ hasText: "Sam Rivera" })).toHaveCount(1);
  await page.screenshot({ path: "test-results/routing-map.png", fullPage: true });
  await signOut(page);

  // 5. Another company sees none of it.
  await signIn(page, seedUserEmail(lakeshore, "dispatcher"));
  await page.goto(`/dispatch/routes?day=${today}`);
  await expect(page.getByTestId("route-tech").filter({ hasText: "Sam Rivera" })).toHaveCount(0);
  await signOut(page);
  await sql.end();
});
