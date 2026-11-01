import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { signOut } from "@/app/(auth)/sign-in/actions";
import { SwRegister } from "@/components/tech/sw-register";
import { can } from "@/lib/auth/permissions";
import { dbAs, requireSession } from "@/lib/auth/session";
import { formatInstant } from "@/lib/dates";
import { LOCALES, type Locale, t } from "@/lib/tech/i18n";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { setLocale } from "./actions";

export const metadata: Metadata = { title: "Bugsy Tech", manifest: "/manifest.webmanifest" };
export const viewport: Viewport = { themeColor: "#064e3b", width: "device-width", initialScale: 1 };

/** The technician shell: one narrow column, big targets, the language toggle, and the service worker. */
export default async function TechLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  const { session, active } = await requireActiveTenant();
  const [member] = await dbAs(session, (tx) => tx<{ locale: Locale }[]>`select locale from public.memberships where id = ${active.id}`);
  const locale: Locale = member?.locale ?? "en";
  const canWork = can(active.permissions, "visits.write") || can(active.permissions, "visits.read");

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900" lang={locale}>
      <SwRegister />
      <header className="sticky top-0 z-10 border-b border-emerald-900/20 bg-emerald-900 text-white">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-3 py-2 text-sm">
          <Link href="/tech" className="font-semibold">
            {t(locale, "app.title")}
          </Link>
          <span className="truncate text-emerald-100">{active.tenantName}</span>
          <form action={setLocale} className="ml-auto flex items-center gap-1">
            <input type="hidden" name="tenant_id" value={active.tenantId} />
            <label htmlFor="tech-locale" className="sr-only">
              {t(locale, "app.language")}
            </label>
            <select id="tech-locale" name="locale" defaultValue={locale} className="rounded bg-emerald-800 px-1 py-0.5 text-white" aria-label={t(locale, "app.language")}>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {l === "en" ? "English" : "Espanol"}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded bg-emerald-700 px-2 py-0.5">
              OK
            </button>
          </form>
          <form action={signOut}>
            <button type="submit" className="rounded border border-emerald-700 px-2 py-0.5">
              {t(locale, "app.signOut")}
            </button>
          </form>
        </div>
      </header>
      {active.support ? (
        <p className="border-b border-sky-300 bg-sky-50 px-3 py-2 text-center text-sm text-sky-950" data-testid="support-banner">
          Support session, {active.support.access === "read" ? "read only" : "read and change"}, until {formatInstant(active.support.expiresAt, active.tenantTimezone)}. Every page you open is logged for
          the company to see.
        </p>
      ) : null}
      {active.tenantStatus !== "active" ? (
        <p className="border-b border-amber-300 bg-amber-50 px-3 py-2 text-center text-sm text-amber-900" data-testid="tenant-readonly">
          {active.tenantName} is {active.tenantStatus}: read only.
        </p>
      ) : null}
      <main className="mx-auto max-w-xl px-3 py-3">
        {canWork ? children : <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">This account cannot run visits. Ask the office for a technician role.</p>}
      </main>
    </div>
  );
}
