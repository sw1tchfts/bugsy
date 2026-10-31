import type { Metadata } from "next";
import { AccountForm } from "@/components/customers/account-form";
import { Card } from "@/components/ui";
import { requirePermission } from "@/lib/auth/session";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

export const metadata: Metadata = { title: "New account" };

export default async function NewAccountPage() {
  const { active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "customers.write");
  return (
    <>
      <h1 className="text-2xl font-semibold">New account</h1>
      <Card title="Account, first property and primary contact" description="One form for the common case. More properties and contacts can be added on the account page.">
        <AccountForm tenantId={active.tenantId} />
      </Card>
    </>
  );
}
