import Link from "next/link";
import { signOut } from "@/app/(auth)/sign-in/actions";
import { Button } from "@/components/ui";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

/** The door-to-door app's frame (spec 17): a phone-sized page with the company and the way back. */
export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const { active } = await requireActiveTenant();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 bg-emerald-950 text-white">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-3 py-2 text-sm">
          <Link href="/door" className="font-semibold">
            Doors
          </Link>
          <span className="text-emerald-100">{active.tenantName}</span>
          <form action={signOut} className="ml-auto">
            <Button type="submit" variant="secondary">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto grid max-w-xl gap-4 px-3 py-4">{children}</main>
    </div>
  );
}
