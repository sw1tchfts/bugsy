import Link from "next/link";
import { can } from "@/lib/auth/permissions";
import { signOut } from "@/app/(auth)/sign-in/actions";
import { Button, Select } from "@/components/ui";
import { dbAs, isPlatformAdmin, requireSession } from "@/lib/auth/session";
import { formatInstant } from "@/lib/dates";
import { type Grant, grantsFor } from "@/lib/platform/db";
import { endSupportAccess } from "./settings/support/actions";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";
import { switchTenant } from "./actions";

export default async function OfficeLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const { memberships, active } = await resolveActiveTenant(session);
  const admin = await isPlatformAdmin(session);
  // Owners and audit.read members see any support request or live access on every page (spec 13 rule 6).
  const support: Grant[] =
    active && !active.support && can(active.permissions, "audit.read")
      ? (await dbAs(session, (tx) => grantsFor(tx, active.tenantId))).filter((g) => g.state === "pending" || g.state === "live")
      : [];

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
                {can(active.permissions, "reports.read") ? (
                  <Link href="/reports" className="text-stone-700 hover:text-stone-900">
                    Reports
                  </Link>
                ) : null}
                <Link href="/catalog/service-types" className="text-stone-700 hover:text-stone-900">
                  Catalog
                </Link>
                <Link href="/settings/company" className="text-stone-700 hover:text-stone-900">
                  Company
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
                {can(active.permissions, "audit.read") ? (
                  <Link href="/settings/support" className="text-stone-700 hover:text-stone-900">
                    Support access
                  </Link>
                ) : null}
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
      {active && active.tenantStatus !== "active" ? (
        <div className="border-b border-amber-300 bg-amber-50" data-testid="tenant-readonly">
          <p className="mx-auto max-w-6xl px-4 py-2 text-sm text-amber-900">
            {active.tenantName} is {active.tenantStatus}. Everything is read only: you can still read, run reports and download your data.
          </p>
        </div>
      ) : null}
      {active?.support ? (
        <div className="border-b border-sky-300 bg-sky-50" data-testid="support-banner">
          <form action={endSupportAccess} className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2 text-sm text-sky-950">
            <span>
              Support session in {active.tenantName}, {active.support.access === "read" ? "read only" : "read and change"}, until {formatInstant(active.support.expiresAt, active.tenantTimezone)}. Every page you open is logged for the
              company to see.
            </span>
            <input type="hidden" name="tenant_id" value={active.tenantId} />
            <input type="hidden" name="grant_id" value={active.support.grantId} />
            <input type="hidden" name="return_to" value="/admin/tenants" />
            <Button type="submit" variant="secondary">
              End my access
            </Button>
          </form>
        </div>
      ) : null}
      {active && support.length ? (
        <div className="border-b border-sky-300 bg-sky-50" data-testid="support-request-banner">
          <p className="mx-auto max-w-6xl px-4 py-2 text-sm text-sky-950">
            {support.map((g) =>
              g.state === "pending"
                ? `Platform support (${g.user_email}) asks for ${g.access === "read" ? "read-only" : "read and change"} access for ${g.hours} hour${g.hours === 1 ? "" : "s"}. `
                : `Platform support (${g.user_email}) can see this company's data until ${formatInstant(g.expires_at ?? new Date(), active.tenantTimezone)}. `,
            )}
            <Link href="/settings/support" className="font-medium underline">
              Review support access
            </Link>
          </p>
        </div>
      ) : null}
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8">{children}</main>
    </div>
  );
}
