import { Suspense } from "react";
import { TechApp } from "@/components/tech/app";
import { dbAs } from "@/lib/auth/session";
import { todayInZone } from "@/lib/dates";
import type { Locale } from "@/lib/tech/i18n";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

export const dynamic = "force-dynamic";

export default async function TechPage() {
  const { session, active } = await requireActiveTenant();
  const [member] = await dbAs(session, (tx) => tx<{ locale: Locale }[]>`select locale from public.memberships where id = ${active.id}`);
  return (
    <Suspense fallback={null}>
      <TechApp tenantId={active.tenantId} userId={session.userId} locale={member?.locale ?? "en"} today={todayInZone(active.tenantTimezone)} timezone={active.tenantTimezone} />
    </Suspense>
  );
}
