import type { Metadata } from "next";
import Link from "next/link";
import { RouteMap } from "@/components/dispatch/route-map";
import { Badge, Button, Card, Empty, Notice, Table, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { isIsoDate, todayInZone } from "@/lib/dates";
import { hasPoint } from "@/lib/routing/geo";
import { type RouteRun, fieldTechnicians, fillIns, latestPositions, loadDay, loadRun } from "@/lib/routing/db";
import { routeMiles } from "@/lib/routing/optimize";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { applyAssignAction, applyOptimizeAction, fillInAction, proposeAssignAction, proposeOptimizeAction } from "./actions";

export const metadata: Metadata = { title: "Routes" };

type Search = { day?: string; branch?: string; run?: string; fill?: string; note?: string; error?: string };

const ago = (d: Date, now: Date) => {
  const m = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60_000));
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

/** A day's routes (spec 19): each technician's miles and order, the optimizer's preview, assignment and fill-ins, positions. */
export default async function Routes({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "dispatch.read");
  const write = can(active.permissions, "dispatch.write");
  const t = active.tenantId;
  const today = todayInZone(active.tenantTimezone);
  const day = q.day && isIsoDate(q.day) ? q.day : today;
  const now = new Date();
  const data = await dbAs(session, async (tx) => {
    const branches = await tx<{ id: string; name: string }[]>`select id, name from public.branches where tenant_id = ${t} and archived_at is null order by name`;
    // Without a choice, the branch with the most visits that day.
    const [busiest] = await tx<{ branch_id: string }[]>`
      select branch_id from public.visits where tenant_id = ${t} and scheduled_for = ${day} and branch_id is not null group by branch_id order by count(*) desc limit 1`;
    const branch = q.branch && branches.some((b) => b.id === q.branch) ? q.branch : (busiest?.branch_id ?? branches[0]?.id ?? null);
    const techs = await fieldTechnicians(tx, t, branch);
    const days = [];
    for (const tech of techs) days.push({ tech, day: await loadDay(tx, t, tech.user_id, day) });
    // A suggestion is a recorded run (rule 6): what it proposed, and whether it was taken.
    const run: RouteRun | null = q.run && /^[0-9a-f-]{36}$/i.test(q.run) ? await loadRun(tx, t, q.run) : null;
    const optimize = run?.kind === "optimize" && run.date === day ? run : null;
    const assign = run?.kind === "assign" && run.date === day ? run : null;
    const fill = q.fill && techs.some((x) => x.user_id === q.fill) ? await fillIns(tx, t, q.fill, day) : null;
    const positions = await latestPositions(tx, t);
    return { branches, branch, days, optimize, assign, fill, positions };
  });
  const base = (extra: Record<string, string>) => `/dispatch/routes?${new URLSearchParams({ day, ...(data.branch ? { branch: data.branch } : {}), ...extra }).toString()}`;
  const hidden = (
    <>
      <input type="hidden" name="tenant_id" value={t} />
      <input type="hidden" name="date" value={day} />
      {data.branch ? <input type="hidden" name="branch" value={data.branch} /> : null}
    </>
  );
  // The map follows one technician: the one being optimized or filled, else the first with stops.
  const focus = data.days.find((d) => d.tech.user_id === (data.optimize?.technician_id ?? q.fill)) ?? data.days.find((d) => d.day.stops.length) ?? null;
  const start = focus?.day.start ?? null;
  const shown = data.optimize ? data.optimize.after.stops : focus ? [...focus.day.stops].sort((a, b) => a.position - b.position) : [];
  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/dispatch" className="hover:underline">
          Dispatch
        </Link>
      </p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Routes for {day}</h1>
        <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
          <input type="date" name="day" defaultValue={day} aria-label="Day" className="rounded border border-stone-300 px-2 py-1" />
          <select name="branch" defaultValue={data.branch ?? ""} aria-label="Branch" className="rounded border border-stone-300 bg-white px-2 py-1">
            {data.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded border border-stone-300 bg-white px-2 py-1">
            Show
          </button>
        </form>
      </div>
      {q.note ? <Notice kind="success">{q.note}</Notice> : null}
      {errorMessage(q.error) ? <Notice kind="error">{errorMessage(q.error)}</Notice> : null}

      <Card title="Technicians" description="Miles are straight-line from the branch, around the stops and back, at the company's average speed.">
        {data.days.length === 0 ? (
          <Empty>No technicians work from this branch.</Empty>
        ) : (
          <Table headers={["Technician", "Stops", "Miles", "Last seen", ""]}>
            {data.days.map(({ tech, day: d }) => {
              const pos = data.positions.find((p) => p.user_id === tech.user_id);
              return (
                <tr key={tech.user_id} data-testid="route-tech">
                  <td className="py-2 pr-4 text-sm">{tech.name}</td>
                  <td className="py-2 pr-4 text-sm tabular-nums">{d.stops.length}</td>
                  <td className="py-2 pr-4 text-sm tabular-nums" data-testid="route-miles">
                    {routeMiles(d.start, [...d.stops].sort((a, b) => a.position - b.position))}
                  </td>
                  <td className="py-2 pr-4 text-sm" data-testid="last-seen">
                    {pos ? ago(pos.recorded_at, now) : "not sharing"}
                  </td>
                  <td className="py-2 pr-4 text-sm">
                    <div className="flex flex-wrap items-center gap-3">
                      {write && d.stops.length > 1 ? (
                        <form action={proposeOptimizeAction}>
                          {hidden}
                          <input type="hidden" name="technician_id" value={tech.user_id} />
                          <button type="submit" className="text-emerald-800 underline">
                            Optimize day
                          </button>
                        </form>
                      ) : null}
                      {write ? (
                        <Link href={base({ fill: tech.user_id })} className="text-emerald-800 underline">
                          Fill this day
                        </Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
        {write && data.branch ? (
          <form action={proposeAssignAction} className="mt-3 text-sm">
            {hidden}
            <button type="submit" className="text-emerald-800 underline">
              Assign the day&apos;s unassigned visits
            </button>
          </form>
        ) : null}
      </Card>

      {data.optimize ? (
        <Card
          title="Optimized order"
          description={`${data.optimize.miles_before} miles now, ${data.optimize.miles_after} miles in this order. Morning stops stay first, no stop is reached before its window opens, and started stops keep their place.`}
        >
          <Table headers={["#", "Stop", "Window", "Arrives", "Leaves", ""]}>
            {data.optimize.after.stops.map((s, i) => {
              const eta = s;
              return (
                <tr key={s.id} data-testid="optimized-stop">
                  <td className="py-1 pr-4 text-sm">{i + 1}</td>
                  <td className="py-1 pr-4 text-sm">
                    {s.account_name}
                    <span className="block text-xs text-stone-500">{s.address}</span>
                  </td>
                  <td className="py-1 pr-4 text-sm">{s.window}</td>
                  <td className="py-1 pr-4 text-sm tabular-nums">{eta.arrive}</td>
                  <td className="py-1 pr-4 text-sm tabular-nums">{eta.depart}</td>
                  <td className="py-1 pr-4 text-sm">
                    {eta.missed ? <Badge tone="bad">misses its window</Badge> : null}
                    {eta.wait_minutes > 0 ? <Badge tone="neutral">{`waits ${eta.wait_minutes} min for its window`}</Badge> : null}
                    {eta.no_location ? <Badge tone="warn">no location</Badge> : null}
                    {s.started ? <Badge tone="neutral">started</Badge> : null}
                  </td>
                </tr>
              );
            })}
          </Table>
          {data.optimize.applied_at ? (
            <p className="mt-3 text-sm text-stone-600">This order was applied.</p>
          ) : write ? (
            <form action={applyOptimizeAction} className="mt-3">
              {hidden}
              <input type="hidden" name="run_id" value={data.optimize.id} />
              <Button type="submit">Use this order</Button>
            </form>
          ) : null}
        </Card>
      ) : null}

      {data.assign ? (
        <Card
          title="Suggested assignments"
          description={`Each passed the dispatch check for that technician and day and fits the day's stop limit; the least added miles, with busy days spared. ${data.assign.miles_before} miles across the branch now, ${data.assign.miles_after} with these.`}
        >
          {data.assign.after.placements.length === 0 ? <Empty>Nothing to assign.</Empty> : null}
          {data.assign.after.placements.length && data.assign.applied_at ? (
            <p className="text-sm text-stone-600">{`Applied: ${data.assign.after.taken?.length ?? 0} of ${data.assign.after.placements.length} taken.`}</p>
          ) : null}
          {data.assign.after.placements.length && !data.assign.applied_at ? (
            <form action={applyAssignAction} className="grid gap-2">
              {hidden}
              <input type="hidden" name="run_id" value={data.assign.id} />
              {data.assign.after.placements.map((p) => (
                <label key={p.visit_id} className="flex items-center gap-2 text-sm" data-testid="assign-row">
                  <input type="checkbox" name="placement" value={p.visit_id} defaultChecked disabled={!write} />
                  {p.account_name} to {p.technician_name} as stop {p.position} (+{p.added_miles} mi)
                </label>
              ))}
              {write ? (
                <div>
                  <Button type="submit">Assign these</Button>
                </div>
              ) : null}
            </form>
          ) : null}
          {data.assign.after.unplaced.length ? (
            <ul className="mt-3 grid gap-1 text-sm text-red-900" data-testid="assign-unplaced">
              {data.assign.after.unplaced.map((u) => (
                <li key={u.visit_id}>
                  {u.account_name}: {u.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {data.fill ? (
        <Card title="Fill this day" description="Visits due today first, then customers near the route whose next visit could come forward, each by the driving it adds.">
          {data.fill.length === 0 ? (
            <Empty>Nothing near enough is due.</Empty>
          ) : (
            <Table headers={["Visit", "Due", "Adds", ""]}>
              {data.fill.map((f) => (
                <tr key={f.visit_id} data-testid="fill-in">
                  <td className="py-1 pr-4 text-sm">
                    {f.account_name}
                    <span className="block text-xs text-stone-500">{f.address}</span>
                  </td>
                  <td className="py-1 pr-4 text-sm">
                    {f.due_start} to {f.due_end}
                    {f.kind === "pull_forward" ? <span className="block text-xs text-amber-800">brought forward</span> : null}
                  </td>
                  <td className="py-1 pr-4 text-sm tabular-nums">{f.detour_miles === null ? "no location" : `${f.detour_miles} mi`}</td>
                  <td className="py-1 pr-4 text-sm">
                    <form action={fillInAction}>
                      {hidden}
                      <input type="hidden" name="technician_id" value={q.fill} />
                      <input type="hidden" name="visit_id" value={f.visit_id} />
                      <button type="submit" className="rounded border border-stone-300 bg-white px-2 py-0.5 text-xs">
                        Schedule
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      ) : null}

      <Card title={focus ? `Map: ${focus.tech.name}` : "Map"}>
        <RouteMap
          start={start}
          stops={shown.filter(hasPoint).map((s) => ({ id: s.id, lat: s.lat as number, lng: s.lng as number, label: `${s.account_name}, ${s.address}` }))}
          positions={data.positions.filter((p) => data.days.some((d) => d.tech.user_id === p.user_id)).map((p) => ({ id: p.user_id, lat: Number(p.lat), lng: Number(p.lng), label: p.name, age: ago(p.recorded_at, now) }))}
        />
      </Card>
    </>
  );
}
