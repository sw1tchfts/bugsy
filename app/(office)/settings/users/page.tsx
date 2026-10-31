import type { Metadata } from "next";
import { Button, Card, Empty, Field, Input, Notice, Select, Table, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { changeMemberRole, inviteUser, removeMember, revokeInvitation } from "./actions";

export const metadata: Metadata = { title: "Users" };

type Member = {
  membership_id: string;
  user_id: string;
  email: string | null;
  role_id: string;
  role_name: string;
  branch_ids: string[] | null;
  last_sign_in_at: string | null;
};
type Role = { id: string; name: string; tenant_id: string | null };
type Branch = { id: string; name: string };
type Invitation = { id: string; email: string; role_name: string; token: string; expires_at: string };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  const { error } = await searchParams;
  const canWrite = can(active.permissions, "users.write");
  const tenantId = active.tenantId;

  const [members, roles, branches, invitations] = await dbAs(session, async (tx) => {
    const members = await tx<Member[]>`
      select m.id as membership_id, m.user_id, d.email, m.role_id, r.name as role_name, m.branch_ids, d.last_sign_in_at
      from public.memberships m
      join public.roles r on r.id = m.role_id
      left join app.member_directory(${tenantId}) d on d.user_id = m.user_id
      where m.tenant_id = ${tenantId}
      order by d.email`;
    const roles = await tx<Role[]>`
      select id, name, tenant_id from public.roles where tenant_id is null or tenant_id = ${tenantId}
      order by tenant_id nulls first, name`;
    const branches = await tx<Branch[]>`
      select id, name from public.branches where tenant_id = ${tenantId} and archived_at is null order by name`;
    const invitations = canWrite
      ? await tx<Invitation[]>`
          select i.id, i.email, r.name as role_name, i.token, i.expires_at
          from public.invitations i join public.roles r on r.id = i.role_id
          where i.tenant_id = ${tenantId} and i.accepted_at is null and i.expires_at >= now()
          order by i.created_at desc`
      : [];
    return [members, roles, branches, invitations] as const;
  });

  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "archived branch";

  return (
    <>
      <h1 className="text-2xl font-semibold">Users</h1>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      <Card title="Members" description="Everyone who can sign in to this company. A member without a branch scope sees every branch.">
        <Table headers={["Email", "Role", "Branches", "Last sign-in", ""]}>
          {members.map((m) => (
            <tr key={m.membership_id}>
              <td className="py-2 pr-4 font-medium">{m.email ?? m.user_id}</td>
              <td className="py-2 pr-4">
                {canWrite ? (
                  <form action={changeMemberRole} className="flex items-center gap-2">
                    <input type="hidden" name="tenant_id" value={tenantId} />
                    <input type="hidden" name="membership_id" value={m.membership_id} />
                    <Select name="role_id" defaultValue={m.role_id} aria-label={`Role for ${m.email ?? m.user_id}`}>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                          {r.tenant_id ? "" : " (default)"}
                        </option>
                      ))}
                    </Select>
                    <Button type="submit" variant="secondary">
                      Save
                    </Button>
                  </form>
                ) : (
                  m.role_name
                )}
              </td>
              <td className="py-2 pr-4">{m.branch_ids ? m.branch_ids.map(branchName).join(", ") : "All"}</td>
              <td className="py-2 pr-4 text-stone-500">{m.last_sign_in_at ? new Date(m.last_sign_in_at).toLocaleString("en-US") : "Never"}</td>
              <td className="py-2 text-right">
                {canWrite && m.user_id !== session.userId ? (
                  <form action={removeMember}>
                    <input type="hidden" name="tenant_id" value={tenantId} />
                    <input type="hidden" name="membership_id" value={m.membership_id} />
                    <Button type="submit" variant="danger">
                      Remove
                    </Button>
                  </form>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      {canWrite ? (
        <>
          <Card title="Invite a user" description="An invitation link is created for the email address. Until customer messaging ships, copy the link to the person yourself.">
            <form action={inviteUser} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="tenant_id" value={tenantId} />
              <Field label="Email" htmlFor="invite-email">
                <Input id="invite-email" name="email" type="email" required />
              </Field>
              <Field label="Role" htmlFor="invite-role">
                <Select id="invite-role" name="role_id" required defaultValue="">
                  <option value="" disabled>
                    Choose a role
                  </option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {r.tenant_id ? "" : " (default)"}
                    </option>
                  ))}
                </Select>
              </Field>
              {branches.length ? (
                <fieldset className="sm:col-span-2">
                  <legend className="text-sm font-medium text-stone-700">Limit to branches (optional)</legend>
                  <div className="mt-1 flex flex-wrap gap-4">
                    {branches.map((b) => (
                      <label key={b.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="branch_ids" value={b.id} /> {b.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              <div>
                <Button type="submit">Send invitation</Button>
              </div>
            </form>
          </Card>

          <Card title="Open invitations">
            {invitations.length === 0 ? (
              <Empty>No open invitations.</Empty>
            ) : (
              <Table headers={["Email", "Role", "Expires", "Link", ""]}>
                {invitations.map((i) => (
                  <tr key={i.id}>
                    <td className="py-2 pr-4 font-medium">{i.email}</td>
                    <td className="py-2 pr-4">{i.role_name}</td>
                    <td className="py-2 pr-4 text-stone-500">{new Date(i.expires_at).toLocaleDateString("en-US")}</td>
                    <td className="py-2 pr-4">
                      <code className="select-all rounded bg-stone-100 px-1.5 py-0.5 text-xs">/invite/{i.token}</code>
                    </td>
                    <td className="py-2 text-right">
                      <form action={revokeInvitation}>
                        <input type="hidden" name="tenant_id" value={tenantId} />
                        <input type="hidden" name="invitation_id" value={i.id} />
                        <Button type="submit" variant="danger">
                          Revoke
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      ) : null}
    </>
  );
}
