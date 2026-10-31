import type { Metadata } from "next";
import { Card, Empty, Table } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

export const metadata: Metadata = { title: "Audit trail" };

type Entry = {
  id: number;
  created_at: string;
  actor_email: string | null;
  table_name: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

const TABLE_LABELS: Record<string, string> = {
  tenants: "company settings",
  branches: "branch",
  roles: "role",
  memberships: "membership",
  invitations: "invitation",
};

function describe(e: Entry): string {
  const row = e.after ?? e.before ?? {};
  const name = (row.name ?? row.email ?? row.key ?? "") as string;
  const label = TABLE_LABELS[e.table_name] ?? e.table_name;
  const verb = { insert: "created", update: "changed", delete: "removed" }[e.action] ?? e.action;
  if (e.table_name === "memberships" && e.action === "update" && e.before?.role_id !== e.after?.role_id) return `membership role changed`;
  return `${label} ${verb}${name ? `: ${name}` : ""}`;
}

export default async function AuditPage() {
  const { active } = await requireActiveTenant();
  const { session } = await requirePermission(active.tenantId, "audit.read");

  const entries = await dbAs(session, (tx) =>
    tx<Entry[]>`
      select a.id, a.created_at, d.email as actor_email, a.table_name, a.action, a.before, a.after
      from public.audit_log a
      left join app.member_directory(${active.tenantId}) d on d.user_id = a.actor_id
      where a.tenant_id = ${active.tenantId}
      order by a.created_at desc, a.id desc
      limit 200`,
  );

  return (
    <>
      <h1 className="text-2xl font-semibold">Audit trail</h1>
      <Card title="Last 200 changes" description="Changes to company settings, branches, roles, memberships and invitations, written by the database itself.">
        {entries.length === 0 ? (
          <Empty>Nothing recorded yet.</Empty>
        ) : (
          <Table headers={["When", "Who", "What", "Table", "Action"]}>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="py-2 pr-4 whitespace-nowrap text-stone-500">{new Date(e.created_at).toLocaleString("en-US")}</td>
                <td className="py-2 pr-4">{e.actor_email ?? "system"}</td>
                <td className="py-2 pr-4 font-medium">{describe(e)}</td>
                <td className="py-2 pr-4 text-stone-500">{e.table_name}</td>
                <td className="py-2 pr-4 text-stone-500">{e.action}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
