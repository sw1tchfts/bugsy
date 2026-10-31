import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Empty, Field, Input, Notice, Table, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { type LeadStage, OPEN_STAGES, STAGE_LABELS } from "@/lib/customers/pipeline";
import { formatInstant } from "@/lib/dates";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { createLeadSource, toggleLeadSource } from "./actions";

export const metadata: Metadata = { title: "Leads" };

type Lead = { id: string; name: string; stage: LeadStage; source_name: string; phone: string | null; city: string | null; inspection_at: string | null; created_at: string; lost_reason: string | null };
type Source = { id: string; key: string; name: string; active: boolean; leads: number };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  const { error } = await searchParams;
  const tenantId = active.tenantId;
  const canWrite = can(active.permissions, "customers.write");

  const [leads, sources] = await dbAs(session, async (tx) => {
    const leads = await tx<Lead[]>`
      select l.id, l.name, l.stage, s.name as source_name, l.phone, l.city, l.inspection_at, l.created_at, l.lost_reason
      from public.leads l join public.lead_sources s on s.id = l.source_id
      where l.tenant_id = ${tenantId}
      order by case l.stage when 'inspection_booked' then 0 else 1 end, l.inspection_at nulls last, l.created_at desc
      limit 500`;
    const sources = await tx<Source[]>`
      select s.id, s.key, s.name, s.active, (select count(*)::int from public.leads l where l.source_id = s.id) as leads
      from public.lead_sources s where s.tenant_id = ${tenantId} order by s.active desc, s.name`;
    return [leads, sources] as const;
  });

  const byStage = (stage: LeadStage) => leads.filter((l) => l.stage === stage);
  const closed = leads.filter((l) => l.stage === "won" || l.stage === "lost").slice(0, 25);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Leads</h1>
        {canWrite ? (
          <Link href="/leads/new">
            <Button type="button">New lead</Button>
          </Link>
        ) : null}
      </div>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {OPEN_STAGES.map((stage) => (
          <section key={stage} className="rounded-md border border-stone-200 bg-white p-4">
            <h2 className="mb-3 flex items-center justify-between text-base font-semibold">
              {STAGE_LABELS[stage]} <Badge>{byStage(stage).length}</Badge>
            </h2>
            {byStage(stage).length === 0 ? (
              <p className="text-sm text-stone-500">None</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {byStage(stage).map((l) => (
                  <li key={l.id} className="py-2 text-sm">
                    <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                      {l.name}
                    </Link>
                    <p className="text-stone-500">
                      {l.source_name}
                      {l.city ? `, ${l.city}` : ""}
                      {l.inspection_at ? `, inspection ${formatInstant(l.inspection_at, active.tenantTimezone)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <Card title="Recently closed">
        {closed.length === 0 ? (
          <Empty>No won or lost leads yet.</Empty>
        ) : (
          <Table headers={["Lead", "Outcome", "Source", "Reason", "Created"]}>
            {closed.map((l) => (
              <tr key={l.id}>
                <td className="py-2 pr-4 font-medium">
                  <Link href={`/leads/${l.id}`} className="hover:underline">
                    {l.name}
                  </Link>
                </td>
                <td className="py-2 pr-4">
                  <Badge tone={l.stage === "won" ? "good" : "bad"}>{STAGE_LABELS[l.stage]}</Badge>
                </td>
                <td className="py-2 pr-4">{l.source_name}</td>
                <td className="py-2 pr-4 text-stone-600">{l.lost_reason ?? ""}</td>
                <td className="py-2 pr-4 text-stone-500">{new Date(l.created_at).toLocaleDateString("en-US")}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Lead sources" description="Every lead records one. Deactivate a source to hide it from new leads; sources in use cannot be deleted.">
        <Table headers={["Source", "Leads", "Status", ""]}>
          {sources.map((s) => (
            <tr key={s.id}>
              <td className="py-2 pr-4 font-medium">{s.name}</td>
              <td className="py-2 pr-4 tabular-nums">{s.leads}</td>
              <td className="py-2 pr-4">{s.active ? <Badge tone="good">active</Badge> : <Badge>inactive</Badge>}</td>
              <td className="py-2 text-right">
                {canWrite ? (
                  <form action={toggleLeadSource}>
                    <input type="hidden" name="tenant_id" value={tenantId} />
                    <input type="hidden" name="source_id" value={s.id} />
                    <input type="hidden" name="active" value={s.active ? "false" : "true"} />
                    <Button type="submit" variant="secondary">
                      {s.active ? "Deactivate" : "Activate"}
                    </Button>
                  </form>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
        {canWrite ? (
          <form action={createLeadSource} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="tenant_id" value={tenantId} />
            <Field label="New source" htmlFor="source-name">
              <Input id="source-name" name="name" required maxLength={60} />
            </Field>
            <Button type="submit" variant="secondary">
              Add source
            </Button>
          </form>
        ) : null}
      </Card>
    </>
  );
}
