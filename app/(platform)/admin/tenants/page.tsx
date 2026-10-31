import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/app/(auth)/sign-in/actions";
import { Button, Card, Empty, Field, Input, Notice, Select, Table, errorMessage } from "@/components/ui";
import { dbAs, requirePlatformAdmin } from "@/lib/auth/session";
import { createTenant, setTenantStatus } from "./actions";

export const metadata: Metadata = { title: "Platform console" };

type Tenant = { id: string; name: string; legal_name: string | null; timezone: string; status: string; created_at: string };
type Invite = { tenant_id: string; email: string; token: string; expires_at: string };

const TIMEZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];

export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await requirePlatformAdmin();
  const { error } = await searchParams;

  const [tenants, invites] = await dbAs(session, async (tx) => {
    const tenants = await tx<Tenant[]>`select id, name, legal_name, timezone, status, created_at from public.tenants order by name`;
    const invites = await tx<Invite[]>`
      select i.tenant_id, i.email, i.token, i.expires_at
      from public.invitations i join public.roles r on r.id = i.role_id
      where r.tenant_id is null and r.key = 'owner' and i.accepted_at is null and i.expires_at >= now()`;
    return [tenants, invites] as const;
  });

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-6 px-4 py-3">
          <span className="text-base font-semibold text-emerald-900">Bugsy platform console</span>
          <Link href="/" className="text-sm text-stone-700 hover:text-stone-900">
            Office app
          </Link>
          <form action={signOut} className="ml-auto flex items-center gap-3 text-sm text-stone-600">
            <span>{session.email}</span>
            <Button type="submit" variant="secondary">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8">
        <h1 className="text-2xl font-semibold">Companies</h1>
        {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

        <Card title="All companies" description="Platform admins see the list of companies, not their data. Support access to a company's data is a separate, logged grant (spec 13).">
          {tenants.length === 0 ? (
            <Empty>No companies yet.</Empty>
          ) : (
            <Table headers={["Company", "Legal name", "Time zone", "Status", "Owner invitation", ""]}>
              {tenants.map((t) => {
                const invite = invites.find((i) => i.tenant_id === t.id);
                return (
                  <tr key={t.id}>
                    <td className="py-2 pr-4 font-medium">{t.name}</td>
                    <td className="py-2 pr-4">{t.legal_name ?? ""}</td>
                    <td className="py-2 pr-4">{t.timezone}</td>
                    <td className="py-2 pr-4">{t.status}</td>
                    <td className="py-2 pr-4">
                      {invite ? (
                        <span>
                          {invite.email}: <code className="select-all rounded bg-stone-100 px-1.5 py-0.5 text-xs">/invite/{invite.token}</code>
                        </span>
                      ) : (
                        <span className="text-stone-500">none open</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <form action={setTenantStatus} className="flex items-center justify-end gap-2">
                        <input type="hidden" name="tenant_id" value={t.id} />
                        <Select name="status" defaultValue={t.status} aria-label={`Status for ${t.name}`}>
                          <option value="active">active</option>
                          <option value="suspended">suspended</option>
                          <option value="archived">archived</option>
                        </Select>
                        <Button type="submit" variant="secondary">
                          Save
                        </Button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>

        <Card title="Create a company" description="The first owner gets an invitation link. Send it to them; when they accept, they become the company's owner.">
          <form action={createTenant} className="grid gap-4 sm:grid-cols-2">
            <Field label="Company name" htmlFor="name">
              <Input id="name" name="name" required maxLength={120} />
            </Field>
            <Field label="Legal name" htmlFor="legal_name">
              <Input id="legal_name" name="legal_name" maxLength={160} />
            </Field>
            <Field label="Time zone" htmlFor="timezone" hint="Business dates such as visit days use this zone.">
              <Select id="timezone" name="timezone" required defaultValue="America/New_York">
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="First owner's email" htmlFor="owner_email">
              <Input id="owner_email" name="owner_email" type="email" required />
            </Field>
            <div>
              <Button type="submit">Create company</Button>
            </div>
          </form>
        </Card>
      </main>
    </div>
  );
}
