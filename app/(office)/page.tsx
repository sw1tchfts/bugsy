import Link from "next/link";
import { Card, Empty, Notice, Table, errorMessage } from "@/components/ui";
import { dbAs } from "@/lib/auth/session";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

type SourceRow = { source: string; leads: number; won: number; lost: number };

export default async function HomePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  const { error } = await searchParams;
  const tenantId = active.tenantId;

  const [counts, bySource] = await dbAs(session, async (tx) => {
    const [counts] = await tx<{ accounts: number; properties: number; open_leads: number; inspections: number; sent_quotes: number; branches: number; members: number }[]>`
      select
        (select count(*)::int from public.accounts where tenant_id = ${tenantId} and archived_at is null and status = 'active') as accounts,
        (select count(*)::int from public.properties where tenant_id = ${tenantId} and archived_at is null) as properties,
        (select count(*)::int from public.leads where tenant_id = ${tenantId} and stage in ('new', 'inspection_booked', 'quoted')) as open_leads,
        (select count(*)::int from public.leads where tenant_id = ${tenantId} and stage = 'inspection_booked' and inspection_at >= now()) as inspections,
        (select count(*)::int from public.quotes where tenant_id = ${tenantId} and status = 'sent') as sent_quotes,
        (select count(*)::int from public.branches where tenant_id = ${tenantId} and archived_at is null) as branches,
        (select count(*)::int from public.memberships where tenant_id = ${tenantId}) as members`;
    const bySource = await tx<SourceRow[]>`
      select s.name as source, count(l.id)::int as leads,
             count(l.id) filter (where l.stage = 'won')::int as won, count(l.id) filter (where l.stage = 'lost')::int as lost
      from public.lead_sources s left join public.leads l on l.source_id = s.id and l.created_at >= now() - interval '90 days'
      where s.tenant_id = ${tenantId}
      group by s.name having count(l.id) > 0
      order by count(l.id) desc`;
    return [counts, bySource] as const;
  });

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">{active.tenantName}</h1>
        <p className="mt-1 text-sm text-stone-600">
          You are signed in as {session.email}, role {active.roleName}. Business dates use {active.tenantTimezone}.
        </p>
      </div>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Active accounts" value={counts.accounts} href="/customers" />
        <Stat label="Properties" value={counts.properties} href="/customers" />
        <Stat label="Open leads" value={counts.open_leads} href="/leads" />
        <Stat label="Upcoming inspections" value={counts.inspections} href="/leads" />
        <Stat label="Quotes awaiting answer" value={counts.sent_quotes} href="/leads" />
      </div>

      <Card title="Close rate by lead source" description="Leads created in the last 90 days.">
        {bySource.length === 0 ? (
          <Empty>No leads in the last 90 days.</Empty>
        ) : (
          <Table headers={["Source", "Leads", "Won", "Lost", "Close rate"]}>
            {bySource.map((r) => (
              <tr key={r.source}>
                <td className="py-2 pr-4 font-medium">{r.source}</td>
                <td className="py-2 pr-4 tabular-nums">{r.leads}</td>
                <td className="py-2 pr-4 tabular-nums">{r.won}</td>
                <td className="py-2 pr-4 tabular-nums">{r.lost}</td>
                <td className="py-2 pr-4 tabular-nums">{r.won + r.lost > 0 ? `${Math.round((r.won / (r.won + r.lost)) * 100)}%` : "open"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <p className="text-sm text-stone-500">
        {counts.branches} branch{counts.branches === 1 ? "" : "es"}, {counts.members} user{counts.members === 1 ? "" : "s"}.{" "}
        <Link href="/settings/branches" className="underline">
          Settings
        </Link>
      </p>
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
