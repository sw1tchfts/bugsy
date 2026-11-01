import Link from "next/link";
import { signOut } from "@/app/(auth)/sign-in/actions";
import { Button, Select } from "@/components/ui";
import { isPlatformAdmin, requireSession } from "@/lib/auth/session";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";
import { switchTenant } from "./actions";

export default async function OfficeLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const { memberships, active } = await resolveActiveTenant(session);
  const admin = await isPlatformAdmin(session);

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <Link href="/" className="text-base font-semibold text-emerald-900">
            Bugsy
          </Link>

          {memberships.length > 1 ? (
            <form action={switchTenant} className="flex items-center gap-2">
              <label htmlFor="tenant_id" className="sr-only">
                Company
              </label>
              <Select id="tenant_id" name="tenant_id" defaultValue={active?.tenantId} aria-label="Company">
                {memberships.map((m) => (
                  <option key={m.tenantId} value={m.tenantId}>
                    {m.tenantName}
                  </option>
                ))}
              </Select>
              <Button type="submit" variant="secondary">
                Switch
              </Button>
            </form>
          ) : active ? (
            <span className="text-sm font-medium text-stone-700">{active.tenantName}</span>
          ) : null}

          <nav className="flex flex-wrap items-center gap-4 text-sm" aria-label="Main">
            {active ? (
              <>
                <Link href="/" className="text-stone-700 hover:text-stone-900">
                  Home
                </Link>
                <Link href="/customers" className="text-stone-700 hover:text-stone-900">
                  Customers
                </Link>
                <Link href="/leads" className="text-stone-700 hover:text-stone-900">
                  Leads
                </Link>
                <Link href="/agreements" className="text-stone-700 hover:text-stone-900">
                  Agreements
                </Link>
                <Link href="/dispatch" className="text-stone-700 hover:text-stone-900">
                  Dispatch
                </Link>
                <Link href="/compliance" className="text-stone-700 hover:text-stone-900">
                  Compliance
                </Link>
                <Link href="/messages" className="text-stone-700 hover:text-stone-900">
                  Messages
                </Link>
                <Link href="/billing" className="text-stone-700 hover:text-stone-900">
                  Billing
                </Link>
                <Link href="/ledger" className="text-stone-700 hover:text-stone-900">
                  Ledger
                </Link>
                <Link href="/catalog/service-types" className="text-stone-700 hover:text-stone-900">
                  Catalog
                </Link>
                <Link href="/settings/branches" className="text-stone-700 hover:text-stone-900">
                  Branches
                </Link>
                <Link href="/settings/users" className="text-stone-700 hover:text-stone-900">
                  Users
                </Link>
                <Link href="/settings/roles" className="text-stone-700 hover:text-stone-900">
                  Roles
                </Link>
                <Link href="/settings/audit" className="text-stone-700 hover:text-stone-900">
                  Audit
                </Link>
                <Link href="/settings/messaging" className="text-stone-700 hover:text-stone-900">
                  Messaging
                </Link>
                <Link href="/settings/import" className="text-stone-700 hover:text-stone-900">
                  Import
                </Link>
              </>
            ) : null}
            {admin ? (
              <Link href="/admin/tenants" className="text-emerald-800 hover:text-emerald-900">
                Platform console
              </Link>
            ) : null}
          </nav>

          <form action={signOut} className="ml-auto flex items-center gap-3 text-sm text-stone-600">
            <span>{session.email}</span>
            <Button type="submit" variant="secondary">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8">{children}</main>
    </div>
  );
}
