import type { Metadata } from "next";
import Link from "next/link";
import { Card, Empty } from "@/components/ui";
import { dbAs } from "@/lib/auth/session";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

export const metadata: Metadata = { title: "Doors" };

/** A rep's territories (spec 17 rule 2): only the ones they are assigned to. */
export default async function DoorHome() {
  const { session, active } = await requireActiveTenant();
  const territories = await dbAs(session, (tx) => tx<{ id: string; name: string; knocks: number; sold: number }[]>`
    select t.id, t.name,
           (select count(*)::int from public.knocks k where k.territory_id = t.id and k.rep_id = ${session.userId}) as knocks,
           (select count(*)::int from public.knocks k where k.territory_id = t.id and k.rep_id = ${session.userId} and k.outcome = 'sold') as sold
    from public.territories t where t.tenant_id = ${active.tenantId} and t.active and ${session.userId}::uuid = any(t.rep_ids) order by t.name`);
  return (
    <Card title="Your territories" description="Pick where you are knocking today.">
      {territories.length === 0 ? (
        <Empty>No territory is assigned to you. Ask your sales manager.</Empty>
      ) : (
        <ul className="grid gap-2">
          {territories.map((t) => (
            <li key={t.id}>
              <Link href={`/door/${t.id}`} className="flex items-center justify-between rounded border border-stone-200 bg-white p-3" data-testid="door-territory">
                <span className="font-medium">{t.name}</span>
                <span className="text-sm text-stone-600">
                  {t.knocks} doors, {t.sold} sold
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
