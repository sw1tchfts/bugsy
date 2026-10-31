import Link from "next/link";
import { Card, Notice, errorMessage } from "@/components/ui";
import { dbAs } from "@/lib/auth/session";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  const { error } = await searchParams;

  const [counts] = await dbAs(session, (tx) =>
    tx<{ branches: number; members: number; invitations: number }[]>`
      select
        (select count(*)::int from public.branches where tenant_id = ${active.tenantId} and archived_at is null) as branches,
        (select count(*)::int from public.memberships where tenant_id = ${active.tenantId}) as members,
        (select count(*)::int from public.invitations where tenant_id = ${active.tenantId} and accepted_at is null and expires_at >= now()) as invitations
    `,
  );

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">{active.tenantName}</h1>
        <p className="mt-1 text-sm text-stone-600">
          You are signed in as {session.email}, role {active.roleName}. Business dates use {active.tenantTimezone}.
        </p>
      </div>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Branches" value={counts.branches} href="/settings/branches" />
        <Stat label="Users" value={counts.members} href="/settings/users" />
        <Stat label="Open invitations" value={counts.invitations} href="/settings/users" />
      </div>
      <Card title="What is set up" description="Spec 01 covers companies, branches, users, roles and the audit trail. Customers and scheduling come next.">
        <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700">
          <li>Every record belongs to one company, enforced in the database.</li>
          <li>Roles are bundles of permissions; owners can copy a default role and adjust it.</li>
          <li>Changes to users, roles, branches and company settings are written to the audit trail.</li>
        </ul>
      </Card>
    </>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="rounded-md border border-stone-200 bg-white p-4 hover:border-emerald-700">
      <p className="text-3xl font-semibold tabular-nums">{value}</p>
      <p className="text-sm text-stone-600">{label}</p>
    </Link>
  );
}
