import type { Metadata } from "next";
import { Button, Card, Field, Input, Notice, Table, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { routeSettings } from "@/lib/routing/db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { saveBranchPoint, saveRouteSettings } from "./actions";

export const metadata: Metadata = { title: "Routing settings" };

/** Spec 19: how routes are timed and where each branch's routes start. */
export default async function RoutingSettings({ searchParams }: { searchParams: Promise<{ note?: string; error?: string }> }) {
  const q = await searchParams;
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "settings.read");
  const write = can(active.permissions, "settings.write");
  const data = await dbAs(session, async (tx) => ({
    settings: await routeSettings(tx, active.tenantId),
    branches: await tx<{ id: string; name: string; address: string; lat: number | null; lng: number | null }[]>`
      select id, name, address, lat, lng from public.branches where tenant_id = ${active.tenantId} and archived_at is null order by name`,
  }));
  const hidden = <input type="hidden" name="tenant_id" value={active.tenantId} />;
  const s = data.settings;
  return (
    <>
      <h1 className="text-2xl font-semibold">Routing</h1>
      {q.note ? <Notice kind="success">{q.note}</Notice> : null}
      {errorMessage(q.error) ? <Notice kind="error">{errorMessage(q.error)}</Notice> : null}
      <Card title="Timing" description="Distances are straight-line miles; drive time is miles over this speed. Arrival estimates start at the day's start.">
        <form action={saveRouteSettings} className="grid gap-3 sm:grid-cols-3">
          {hidden}
          <Field label="Average speed (mph)" htmlFor="mph">
            <Input id="mph" name="average_speed_mph" inputMode="decimal" defaultValue={String(s.mph)} disabled={!write} />
          </Field>
          <Field label="Day starts" htmlFor="start">
            <Input id="start" name="day_starts_at" type="time" defaultValue={s.day_start} disabled={!write} />
          </Field>
          <Field label="Morning ends" htmlFor="morning">
            <Input id="morning" name="morning_ends_at" type="time" defaultValue={s.morning_ends} disabled={!write} />
          </Field>
          <Field label="Afternoon ends" htmlFor="afternoon">
            <Input id="afternoon" name="afternoon_ends_at" type="time" defaultValue={s.afternoon_ends} disabled={!write} />
          </Field>
          <Field label="Fill-ins within (miles)" htmlFor="fill">
            <Input id="fill" name="fill_in_miles" inputMode="decimal" defaultValue={String(s.fill_in_miles)} disabled={!write} />
          </Field>
          <Field label="Keep positions (days)" htmlFor="days">
            <Input id="days" name="position_days" inputMode="numeric" defaultValue={String(s.position_days)} disabled={!write} />
          </Field>
          {write ? (
            <div>
              <Button type="submit">Save</Button>
            </div>
          ) : null}
        </form>
      </Card>
      <Card title="Branches on the map" description="Each route starts and ends at its branch. Leave both blank and save to find the point from the branch address.">
        <Table headers={["Branch", "Latitude", "Longitude", ""]}>
          {data.branches.map((b) => (
            <tr key={b.id}>
              <td className="py-2 pr-4 text-sm">
                {b.name}
                <span className="block text-xs text-stone-500">{b.address}</span>
              </td>
              <td className="py-2 pr-4" colSpan={3}>
                <form action={saveBranchPoint} className="flex flex-wrap items-end gap-2">
                  {hidden}
                  <input type="hidden" name="branch_id" value={b.id} />
                  <input name="lat" aria-label={`${b.name} latitude`} defaultValue={b.lat ?? ""} className="w-28 rounded border border-stone-300 px-2 py-1 text-sm" disabled={!write} />
                  <input name="lng" aria-label={`${b.name} longitude`} defaultValue={b.lng ?? ""} className="w-28 rounded border border-stone-300 px-2 py-1 text-sm" disabled={!write} />
                  {write ? (
                    <button type="submit" className="rounded border border-stone-300 bg-white px-2 py-1 text-xs">
                      Save
                    </button>
                  ) : null}
                </form>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
