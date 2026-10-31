import Link from "next/link";
import { notFound } from "next/navigation";
import { VisitSummary } from "@/components/visits/visit-summary";
import { dbAs } from "@/lib/auth/session";
import { listMembers } from "@/lib/dispatch/db";
import { type Locale, t } from "@/lib/tech/i18n";
import { loadRouteVisit } from "@/lib/tech/route-db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

export const dynamic = "force-dynamic";

export default async function TechSummaryPage({ params }: { params: Promise<{ visitId: string }> }) {
  const { session, active } = await requireActiveTenant();
  const { visitId } = await params;
  const data = await dbAs(session, async (tx) => {
    const [member] = await tx<{ locale: Locale }[]>`select locale from public.memberships where id = ${active.id}`;
    const visit = await loadRouteVisit(tx, active.tenantId, visitId);
    const names = new Map((await listMembers(tx, active.tenantId)).map((m) => [m.user_id, m.name]));
    return { locale: member?.locale ?? ("en" as Locale), visit, names };
  });
  if (!data.visit) notFound();
  return (
    <div className="grid gap-3">
      <Link href={`/tech?visit=${visitId}`} className="text-sm text-emerald-800 underline">
        {t(data.locale, "app.back")}
      </Link>
      <h1 className="text-lg font-semibold">{t(data.locale, "stop.summary")}</h1>
      <div className="rounded-lg border border-stone-200 bg-white p-3">
        <VisitSummary visit={data.visit} locale={data.locale} timezone={active.tenantTimezone} names={data.names} />
      </div>
    </div>
  );
}
