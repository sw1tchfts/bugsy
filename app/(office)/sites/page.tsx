import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, Empty, Table } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requireSession } from "@/lib/auth/session";
import { listSites } from "@/lib/commercial/db";
import { formatInstantDate, todayInZone } from "@/lib/dates";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Sites" };

/** Commercial sites: devices, recent activity, hot devices and open items (spec 14). */
export default async function SitesPage() {
  await requireSession();
  const { session, active } = await requireActiveTenant();
  if (!can(active.permissions, "customers.read") && !can(active.permissions, "visits.read")) redirect("/?error=forbidden");
  const sites = await dbAs(session, (tx) => listSites(tx, active.tenantId, todayInZone(active.tenantTimezone)));
  return (
    <>
      <h1 className="text-2xl font-semibold">Sites</h1>
      <p className="text-sm text-stone-600">Commercial accounts with a device program. A device is hot when two of its last three checks showed activity. Set up a new site from its property page.</p>
      <Card title="Device programs">
        {sites.length === 0 ? (
          <Empty>No site has devices or a floor plan yet.</Empty>
        ) : (
          <Table headers={["Site", "Devices", "Last check", "Activity, 90 days", "Hot", "Open items"]}>
            {sites.map((s) => (
              <tr key={s.property_id} data-testid="site-row">
                <td className="py-2 pr-4">
                  <Link href={`/sites/${s.property_id}`} className="font-medium underline">
                    {s.account_name}
                  </Link>
                  <div className="text-xs text-stone-500">{s.address}</div>
                </td>
                <td className="py-2 pr-4 tabular-nums">{s.devices}</td>
                <td className="py-2 pr-4">{s.last_check ? formatInstantDate(s.last_check, active.tenantTimezone) : "never"}</td>
                <td className="py-2 pr-4 tabular-nums">{s.checks_90 ? `${Math.round((s.active_90 / s.checks_90) * 100)}% of ${s.checks_90} checks` : "no checks"}</td>
                <td className="py-2 pr-4">{s.hot ? <Badge tone="bad">! {s.hot} hot</Badge> : "none"}</td>
                <td className="py-2 pr-4 text-xs">
                  {s.open_recommendations} recommendation(s){s.overdue_recommendations ? `, ${s.overdue_recommendations} overdue` : ""}; {s.open_sightings} sighting(s)
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
