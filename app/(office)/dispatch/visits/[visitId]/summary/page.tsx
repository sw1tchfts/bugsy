import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { VisitSummary } from "@/components/visits/visit-summary";
import { Card } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { listMembers } from "@/lib/dispatch/db";
import { loadRouteVisit } from "@/lib/tech/route-db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

export const metadata: Metadata = { title: "Visit summary" };

export default async function VisitSummaryPage({ params }: { params: Promise<{ visitId: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "dispatch.read");
  const { visitId } = await params;
  const data = await dbAs(session, async (tx) => ({
    visit: await loadRouteVisit(tx, active.tenantId, visitId),
    names: new Map((await listMembers(tx, active.tenantId)).map((m) => [m.user_id, m.name])),
  }));
  if (!data.visit) notFound();
  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href={`/dispatch/visits/${visitId}`} className="hover:underline">
          Visit
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Visit summary</h1>
      <Card title={`${data.visit.account.name}, ${data.visit.property.address}`} description="What the technician recorded. Messaging sends this to the customer; compliance locks the same facts into the record.">
        <VisitSummary visit={data.visit} locale="en" timezone={active.tenantTimezone} names={data.names} />
      </Card>
    </>
  );
}
