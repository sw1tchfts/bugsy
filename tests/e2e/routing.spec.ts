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

  // The demo day as the seed laid it out (a rerun starts from the same zigzag): the four stops in their seeded order,
  // the nearby due visit back in the pool.
  for (let n = 1; n <= 4; n += 1) {
    await sql`update public.visits set status = 'scheduled' where tenant_id = ${tenant.id} and dispatch_notes = ${`seed:route ${n}`} and status = 'en_route'`;
    await sql`update public.visits set route_position = ${n} where tenant_id = ${tenant.id} and dispatch_notes = ${`seed:route ${n}`}`;
  }
  await sql`update public.visits set status = 'planned' where tenant_id = ${tenant.id} and dispatch_notes = 'seed:route due' and status = 'scheduled'`;
  await sql`delete from public.visit_crew c using public.visits v where v.id = c.visit_id and v.tenant_id = ${tenant.id} and v.dispatch_notes = 'seed:route due' and c.role = 'lead'`;

  // 1. The dispatcher optimizes Sam's seeded zigzag day: the miles drop and the morning stop comes first.
  await signIn(page, seedUserEmail(northwind, "dispatcher"));
  await page.goto(`/dispatch/routes?day=${day}`);
  const before = await samMiles(page);
  expect(before).toBeGreaterThan(0);
  await page.getByTestId("route-tech").filter({ hasText: "Sam Rivera" }).getByRole("button", { name: "Optimize day" }).click();
  const optimized = page.getByTestId("optimized-stop");
  await expect(optimized.first()).toContainText("morning");
  await page.screenshot({ path: "test-results/routing-preview.png", fullPage: true });
  await page.getByRole("button", { name: "Use this order" }).click();
  await expect(page.getByText(/Day reordered: [\d.]+ to [\d.]+ miles\./)).toBeVisible();
  const after = await samMiles(page);
  expect(after).toBeLessThan(before);
  const [first] = await sql<{ arrival_window: string }[]>`
    select v.arrival_window from public.visits v where v.tenant_id = ${tenant.id} and v.scheduled_for = ${day} and v.dispatch_notes like 'seed:route %' and v.route_position = 1`;
  expect(first?.arrival_window).toBe("morning");
  // The suggestion is on record as taken.
  const [run] = await sql<{ applied: boolean }[]>`select applied_at is not null as applied from public.route_runs where tenant_id = ${tenant.id} and kind = 'optimize' and date = ${day} order by created_at desc limit 1`;
  expect(run.applied).toBe(true);

  // 2. A gap filled with the nearest due visit, then the rest of the day assigned: the other-state visit is refused.
  await page.getByTestId("route-tech").filter({ hasText: "Sam Rivera" }).getByRole("link", { name: "Fill this day" }).click();
  const fill = page.getByTestId("fill-in").filter({ hasText: "MIDTOWN AVE" });
  await expect(fill).toBeVisible();
  await fill.getByRole("button", { name: "Schedule" }).click();
  await expect(page.getByText(/^Scheduled as stop \d+/)).toBeVisible();
  const [midtown] = await sql<{ status: string }[]>`select status from public.visits where tenant_id = ${tenant.id} and dispatch_notes = 'seed:route due'`;
  expect(midtown.status).toBe("scheduled");
  await page.getByRole("button", { name: "Assign the day's unassigned visits" }).click();
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

  // 4. On the way to a stop today: the text carries an arrival estimate from the fresh position. The stop is made for
  // the test (earlier specs may have finished Sam's day), at a customer whose primary contact gets the text.
  await sql`update public.visits set status = 'scheduled' where tenant_id = ${tenant.id} and dispatch_notes = 'e2e:routing on the way' and status = 'en_route'`;
  await sql`update public.visits set status = 'cancelled' where tenant_id = ${tenant.id} and dispatch_notes = 'e2e:routing on the way' and status = 'scheduled'`;
  const [target] = await sql<{ property_id: string; account_id: string; branch_id: string; service_type_id: string; user_id: string }[]>`
    select p.id as property_id, p.account_id, b.id as branch_id, st.id as service_type_id, u.id as user_id
    from public.properties p join public.accounts a on a.id = p.account_id and a.status = 'active'
      join public.contacts c on c.tenant_id = p.tenant_id and c.account_id = p.account_id and c.role = 'primary' and c.archived_at is null
      join public.branches b on b.tenant_id = p.tenant_id and b.state_code = p.state_code and b.archived_at is null
      join public.service_types st on st.tenant_id = p.tenant_id and st.name = 'General pest plan'
      join auth.users u on u.email = ${seedUserEmail(northwind, "technician")}
    where p.tenant_id = ${tenant.id} and p.lat is not null and p.state_code = 'OH' order by p.created_at limit 1`;
  const [stop] = await sql<{ id: string }[]>`
    insert into public.visits (tenant_id, account_id, property_id, service_type_id, branch_id, kind, status, due_start, due_end, scheduled_for, technician_id, route_position, arrival_window, dispatch_notes)
    values (${tenant.id}, ${target.account_id}, ${target.property_id}, ${target.service_type_id}, ${target.branch_id}, 'inspection', 'scheduled', ${today}, ${today}, ${today}, ${target.user_id}, 99, 'any', 'e2e:routing on the way')
    returning id`;
  await sql`insert into public.visit_crew (tenant_id, visit_id, user_id, role) values (${tenant.id}, ${stop.id}, ${target.user_id}, 'lead')`;
  await page.goto(`/tech?visit=${stop.id}`);
  await page.getByRole("button", { name: "On my way" }).click();
  await expect(page.getByTestId("pending-count")).toHaveText("All changes synced", { timeout: 30_000 });
  await expect
    .poll(async () => (await sql<{ body: string }[]>`select body from public.messages where tenant_id = ${tenant.id} and visit_id = ${stop.id} and purpose = 'on_the_way' order by created_at desc limit 1`)[0]?.body ?? "", { timeout: 30_000 })
    .toMatch(/should arrive between \d{1,2}:\d{2} [AP]M and \d{1,2}:\d{2} [AP]M/);
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
