import Link from "next/link";
import { signOut } from "@/app/(auth)/sign-in/actions";
import { Button, Select } from "@/components/ui";
import { getSession } from "@/lib/auth/session";
import { portalIdentities } from "@/lib/portal/session";
import { cookies } from "next/headers";
import { PORTAL_COOKIE } from "@/lib/portal/session";
import { switchIdentity } from "./actions";

/** The customer portal's frame (spec 16): the company and account the customer works as, and the portal's pages. */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const identities = session ? await portalIdentities(session) : [];
  const wanted = (await cookies()).get(PORTAL_COOKIE)?.value;
  const identity = identities.find((i) => i.id === wanted) ?? identities[0] ?? null;
  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <Link href="/portal" className="text-base font-semibold text-emerald-900">
            {identity ? identity.tenant_name : "Customer portal"}
          </Link>
          {identity ? (
            <nav className="flex flex-wrap gap-4 text-sm" aria-label="Portal">
              <Link href="/portal" className="hover:underline">
                Home
              </Link>
              <Link href="/portal/billing" className="hover:underline">
                Billing
              </Link>
              <Link href="/portal/requests" className="hover:underline">
                Requests
              </Link>
            </nav>
          ) : null}
          <div className="ml-auto flex items-center gap-3">
            {identities.length > 1 && identity ? (
              <form action={switchIdentity} className="flex items-center gap-2">
                <Select name="portal_user_id" defaultValue={identity.id} aria-label="Account">
                  {identities.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.tenant_name}: {i.account_name}
                    </option>
                  ))}
                </Select>
                <Button type="submit" variant="secondary">
                  Open
                </Button>
              </form>
            ) : identity ? (
              <span className="text-sm text-stone-600">{identity.account_name}</span>
            ) : null}
            {session ? (
              <form action={signOut}>
                <Button type="submit" variant="secondary">
                  Sign out
                </Button>
              </form>
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-4xl gap-6 px-4 py-6">{children}</main>
    </div>
  );
}
