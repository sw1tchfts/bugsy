import Link from "next/link";
import { signOut } from "@/app/(auth)/sign-in/actions";
import { Button } from "@/components/ui";

/** Header and page frame for the platform console, which sits outside every tenant. */
export function PlatformShell({ email, children }: { email: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-6 px-4 py-3">
          <span className="text-base font-semibold text-emerald-900">Bugsy platform console</span>
          <nav className="flex flex-wrap items-center gap-4 text-sm" aria-label="Platform">
            <Link href="/admin/tenants" className="text-stone-700 hover:text-stone-900">
              Companies
            </Link>
            <Link href="/admin/products" className="text-stone-700 hover:text-stone-900">
              Products
            </Link>
            <Link href="/" className="text-stone-700 hover:text-stone-900">
              Office app
            </Link>
          </nav>
          <form action={signOut} className="ml-auto flex items-center gap-3 text-sm text-stone-600">
            <span>{email}</span>
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
