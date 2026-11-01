import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Empty, Input, Notice, Table, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { formatBusinessDate, formatInstant, todayInZone } from "@/lib/dates";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { completeTask, dismissTask, runComplianceNow } from "./actions";

export const metadata: Metadata = { title: "Compliance" };

type Task = { id: string; kind: string; subject_table: string; subject_id: string; due_on: string; title: string; created_at: string };

const KIND_LABELS: Record<string, string> = {
  credential_expiring: "Credential expiring",
  license_expiring: "Business license expiring",
  record_incomplete: "Incomplete record",
  notice_overdue: "Notice overdue",
  registry_notice_due: "Registry notice due",
};

function taskHref(t: Task): string | null {
  if (t.subject_table === "application_records") return `/compliance/records/${t.subject_id}`;
  if (t.subject_table === "notices") return `/compliance/notices/${t.subject_id}`;
  if (t.subject_table === "visits") return `/dispatch/visits/${t.subject_id}`;
  if (t.subject_table === "applicator_credentials") return "/compliance/credentials";
  if (t.subject_table === "branches") return "/compliance/licenses";
  return null;
}

export default async function CompliancePage({ searchParams }: { searchParams: Promise<{ error?: string; note?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "compliance.read");
  const { error, note } = await searchParams;
  const tenantId = active.tenantId;
  const canWrite = can(active.permissions, "compliance.write");
  const today = todayInZone(active.tenantTimezone);

  const data = await dbAs(session, async (tx) => {
    const tasks = await tx<Task[]>`select id, kind, subject_table, subject_id, due_on, title, created_at from public.compliance_tasks where tenant_id = ${tenantId} and status = 'open' order by due_on, created_at`;
    const [records] = await tx<{ drafts: number; locked_today: number; next_due: string | null }[]>`
      select count(*) filter (where status = 'draft')::int as drafts,
             count(*) filter (where status = 'locked' and business_date = ${today})::int as locked_today,
             min(lock_due_at) filter (where status = 'draft')::text as next_due
      from public.application_records where tenant_id = ${tenantId}`;
    const [notices] = await tx<{ due: number; overdue: number; best_practice: number }[]>`
      select count(*) filter (where status = 'due' and required)::int as due,
             count(*) filter (where status = 'due' and required and due_by < now())::int as overdue,
             count(*) filter (where status = 'due' and not required)::int as best_practice
      from public.notices where tenant_id = ${tenantId}`;
    const [registry] = await tx<{ matched: number }[]>`select count(*)::int as matched from public.properties where tenant_id = ${tenantId} and archived_at is null and registry_matches <> '{}'::jsonb`;
    return { tasks, records, notices, registry };
  });

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Compliance</h1>
          <p className="mt-1 text-sm text-stone-600">
            Records locked from the stop, notices with proof, registries, credentials and licenses, and the inspector export. State rules come from each state&apos;s pack; none is researched yet, so the conservative defaults apply.
          </p>
        </div>
        {canWrite ? (
          <form action={runComplianceNow}>
            <input type="hidden" name="tenant_id" value={tenantId} />
            <Button type="submit" variant="secondary">
              Run the compliance job now
            </Button>
          </form>
        ) : null}
      </div>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}
      {note ? <Notice kind="success">{note}</Notice> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/compliance/records" className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-stone-600">Application records</p>
          <p className="text-2xl font-semibold" data-testid="records-draft">
            {data.records.drafts} <span className="text-sm font-normal text-stone-500">waiting to lock</span>
          </p>
          <p className="text-xs text-stone-500">{data.records.next_due ? `Next lock ${formatInstant(data.records.next_due, active.tenantTimezone)}` : "Nothing pending"}; {data.records.locked_today} locked today</p>
        </Link>
        <Link href="/compliance/notices" className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-stone-600">Notices</p>
          <p className="text-2xl font-semibold">
            {data.notices.due} <span className="text-sm font-normal text-stone-500">required and due</span>
          </p>
          <p className="text-xs text-stone-500">
            {data.notices.overdue} past due; {data.notices.best_practice} best practice (no state rule on file)
          </p>
        </Link>
        <Link href="/compliance/registries" className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-stone-600">Registry matches</p>
          <p className="text-2xl font-semibold">{data.registry.matched}</p>
          <p className="text-xs text-stone-500">properties on a notification registry</p>
        </Link>
        <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-stone-600">
            <Link href="/compliance/credentials" className="underline">
              Credentials
            </Link>{" "}
            and{" "}
            <Link href="/compliance/licenses" className="underline">
              licenses
            </Link>
          </p>
          <p className="text-2xl font-semibold">{data.tasks.filter((t) => t.kind === "credential_expiring" || t.kind === "license_expiring").length}</p>
          <p className="text-xs text-stone-500">alerts at 60 and 30 days before an expiry</p>
        </div>
      </div>

      <Card title="What needs you" description="Raised by the compliance job; closed by you or by the fact that fixes them (a renewal, a sent notice, a moved visit).">
        {data.tasks.length === 0 ? (
          <Empty>Nothing open.</Empty>
        ) : (
          <Table headers={["Due", "Kind", "What", ""]}>
            {data.tasks.map((t) => {
              const href = taskHref(t);
              return (
                <tr key={t.id} data-testid="compliance-task">
                  <td className="py-2 pr-4 tabular-nums">{t.due_on < today ? <Badge tone="bad">{formatBusinessDate(t.due_on)}</Badge> : formatBusinessDate(t.due_on)}</td>
                  <td className="py-2 pr-4">{KIND_LABELS[t.kind] ?? t.kind}</td>
                  <td className="py-2 pr-4">{href ? <Link href={href} className="underline">{t.title}</Link> : t.title}</td>
                  <td className="py-2 text-right">
                    {canWrite ? (
                      <form action={completeTask} className="flex items-center justify-end gap-2">
                        <input type="hidden" name="tenant_id" value={tenantId} />
                        <input type="hidden" name="task_id" value={t.id} />
                        <Input name="note" placeholder="Note" className="w-32" aria-label={`Note for ${t.title}`} />
                        <Button type="submit" variant="secondary">
                          Done
                        </Button>
                        <Button type="submit" variant="secondary" formAction={dismissTask}>
                          Dismiss
                        </Button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <Card title="Sections">
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          <li><Link href="/compliance/records" className="underline">Application records</Link>: every completed pesticide visit, locked and amendable.</li>
          <li><Link href="/compliance/notices" className="underline">Notices</Link>: obligations, due times, channels and proof.</li>
          <li><Link href="/compliance/registries" className="underline">Notification registries</Link>: import a state&apos;s list and see the matches.</li>
          <li><Link href="/compliance/credentials" className="underline">Credentials</Link>: certifications and licenses per person and state.</li>
          <li><Link href="/compliance/licenses" className="underline">Branch licenses</Link>: business licenses and the licensed roster per branch.</li>
          <li><Link href="/compliance/export" className="underline">Inspector export</Link>: records, notices and licenses for a date range in one file.</li>
        </ul>
      </Card>
    </>
  );
}
