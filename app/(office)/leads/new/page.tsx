import type { Metadata } from "next";
import { LeadForm } from "@/components/customers/lead-form";
import { Card } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

export const metadata: Metadata = { title: "New lead" };

export default async function NewLeadPage() {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "customers.write");
  const sources = await dbAs(session, (tx) =>
    tx<{ id: string; name: string }[]>`select id, name from public.lead_sources where tenant_id = ${active.tenantId} and active order by name`,
  );
  return (
    <>
      <h1 className="text-2xl font-semibold">New lead</h1>
      <Card title="Who called, and where they heard about you">
        <LeadForm tenantId={active.tenantId} sources={sources} />
      </Card>
    </>
  );
}
