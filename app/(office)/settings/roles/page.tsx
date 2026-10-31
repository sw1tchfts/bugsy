import type { Metadata } from "next";
import { Button, Card, Empty, Field, Input, Notice, Table, errorMessage } from "@/components/ui";
import { PERMISSION_GROUPS, can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { copyDefaultRole, deleteRole, updateRole } from "./actions";

export const metadata: Metadata = { title: "Roles" };

type Role = { id: string; tenant_id: string | null; key: string; name: string; description: string | null; permissions: string[]; members: number };

export default async function RolesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  const { error } = await searchParams;
  const canWrite = can(active.permissions, "settings.write");
  const tenantId = active.tenantId;

  const roles = await dbAs(session, (tx) =>
    tx<Role[]>`
      select r.id, r.tenant_id, r.key, r.name, r.description, r.permissions,
             (select count(*)::int from public.memberships m where m.role_id = r.id and m.tenant_id = ${tenantId}) as members
      from public.roles r
      where r.tenant_id is null or r.tenant_id = ${tenantId}
      order by r.tenant_id nulls first, r.name`,
  );
  const defaults = roles.filter((r) => r.tenant_id === null);
  const own = roles.filter((r) => r.tenant_id !== null);

  return (
    <>
      <h1 className="text-2xl font-semibold">Roles</h1>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      <Card title="Default roles" description="Provided by the platform and the same for every company. Copy one to change what it allows.">
        <Table headers={["Role", "What it allows", "Members", ""]}>
          {defaults.map((r) => (
            <tr key={r.id}>
              <td className="py-2 pr-4 font-medium">{r.name}</td>
              <td className="py-2 pr-4 text-stone-600">{r.description}</td>
              <td className="py-2 pr-4 tabular-nums">{r.members}</td>
              <td className="py-2 text-right">
                {canWrite ? (
                  <form action={copyDefaultRole}>
                    <input type="hidden" name="tenant_id" value={tenantId} />
                    <input type="hidden" name="role_id" value={r.id} />
                    <Button type="submit" variant="secondary">
                      Copy to company
                    </Button>
                  </form>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Company roles" description="Roles this company made. A role with every permission makes its holders owners.">
        {own.length === 0 ? (
          <Empty>No company roles yet.</Empty>
        ) : (
          <div className="grid gap-6">
            {own.map((r) => (
              <form key={r.id} action={updateRole} className="grid gap-4 rounded border border-stone-200 p-4">
                <input type="hidden" name="tenant_id" value={tenantId} />
                <input type="hidden" name="role_id" value={r.id} />
                <div className="flex flex-wrap items-end gap-4">
                  <div className="min-w-60">
                    <Field label="Name" htmlFor={`name-${r.id}`}>
                      <Input id={`name-${r.id}`} name="name" defaultValue={r.name} required disabled={!canWrite} />
                    </Field>
                  </div>
                  <p className="text-sm text-stone-500">
                    key {r.key}, {r.members} member{r.members === 1 ? "" : "s"}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" name="permissions" value="*" defaultChecked={r.permissions.includes("*")} disabled={!canWrite} />
                  Everything (owner)
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  {PERMISSION_GROUPS.map((g) => (
                    <fieldset key={g.label}>
                      <legend className="text-sm font-medium text-stone-700">{g.label}</legend>
                      <div className="mt-1 grid gap-1">
                        {g.permissions.map((p) => (
                          <label key={p.key} className="flex items-center gap-2 text-sm">
                            <input type="checkbox" name="permissions" value={p.key} defaultChecked={r.permissions.includes(p.key)} disabled={!canWrite} />
                            {p.label}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </div>
                {canWrite ? (
                  <div className="flex gap-3">
                    <Button type="submit">Save role</Button>
                    <Button type="submit" variant="danger" formAction={deleteRole} disabled={r.members > 0}>
                      Delete
                    </Button>
                  </div>
                ) : null}
              </form>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
