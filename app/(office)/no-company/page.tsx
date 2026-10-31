import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { isPlatformAdmin, requireSession } from "@/lib/auth/session";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";

export default async function NoCompanyPage() {
  const session = await requireSession();
  const { active } = await resolveActiveTenant(session);
  if (active) redirect("/");
  const admin = await isPlatformAdmin(session);

  return (
    <Card title="You are not part of a company yet" description={`${session.email} has no membership. Ask the company's owner for an invitation link, or sign in with the email the invitation was sent to.`}>
      {admin ? (
        <p className="text-sm">
          You are a platform admin. Open the{" "}
          <Link href="/admin/tenants" className="text-emerald-800 underline">
            platform console
          </Link>{" "}
          to create a company and invite its first owner.
        </p>
      ) : null}
    </Card>
  );
}
