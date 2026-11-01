import type { Metadata } from "next";
import { PlatformShell } from "@/components/platform-shell";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Table, Textarea, errorMessage } from "@/components/ui";
import { dbAs, requirePlatformAdmin } from "@/lib/auth/session";
import { type OverviewRow, daysToFirstRoute, myGrants, platformOverview } from "@/lib/platform/db";
import { progress } from "@/lib/platform/onboarding";
import { MAX_HOURS, STATE_LABELS } from "@/lib/platform/support";
import { createTenant, endMySupport, openSupportCompany, purgeCompany, requestSupportAccess, setTenantStatus } from "./actions";

export const metadata: Metadata = { title: "Platform console" };

type Invite = { tenant_id: string; email: string; token: string; expires_at: string };
type Purge = { name: string; archived_at: Date | null; purged_at: Date };

const TIMEZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];

const when = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "never");

function Company({ t, invite }: { t: OverviewRow; invite: Invite | undefined }) {
  const setup = progress(t.onboarding);
  const days = daysToFirstRoute(t);
  return (
    <div className="grid gap-3 rounded-lg border border-stone-200 bg-white p-4" data-testid="company" data-name={t.name}>
      <div className="flex flex-wrap items-baseline gap-3">
        <h3 className="text-lg font-semibold">{t.name}</h3>
        <Badge tone={t.status === "active" ? "good" : t.status === "suspended" ? "warn" : "bad"}>{t.status}</Badge>
        {t.status_reason ? <span className="text-sm text-stone-600">{t.status_reason}</span> : null}
        {t.open_support ? <Badge tone="warn">support open</Badge> : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <div><dt className="text-stone-500">Created</dt><dd>{when(t.created_at)}</dd></div>
        <div><dt className="text-stone-500">People</dt><dd>{t.members}</dd></div>
        <div><dt className="text-stone-500">Accounts</dt><dd>{t.accounts}</dd></div>
        <div><dt className="text-stone-500">Active agreements</dt><dd>{t.active_agreements}</dd></div>
        <div><dt className="text-stone-500">Visits, 30 days</dt><dd>{t.visits_30}</dd></div>
        <div><dt className="text-stone-500">Last activity</dt><dd>{when(t.last_activity)}</dd></div>
        <div><dt className="text-stone-500">Setup</dt><dd data-testid="company-setup">{setup.done} of {setup.total}</dd></div>
        <div><dt className="text-stone-500">Import to first route</dt><dd>{days === null ? "not yet" : `${days} day(s)`}</dd></div>
        {t.archived_at ? <div><dt className="text-stone-500">Archived</dt><dd>{when(t.archived_at)}</dd></div> : null}
      </dl>
      {invite ? (
        <p className="text-sm">
          Owner invitation for {invite.email}: <code className="select-all rounded bg-stone-100 px-1.5 py-0.5 text-xs" data-testid="owner-invite">/invite/{invite.token}</code>
        </p>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        <form action={setTenantStatus} className="grid gap-2 rounded border border-stone-200 p-3">
          <p className="text-sm font-medium">Status</p>
          <input type="hidden" name="tenant_id" value={t.tenant_id} />
          <Select name="status" defaultValue={t.status} aria-label={`Status for ${t.name}`}>
            <option value="active">active</option>
            <option value="suspended">suspended: read only, no jobs</option>
            <option value="archived">archived: the company has left</option>
          </Select>
          <Input name="reason" placeholder="Why (shown to the company)" aria-label={`Status reason for ${t.name}`} defaultValue={t.status_reason ?? ""} />
          <div>
            <Button type="submit" variant="secondary">Save status</Button>
          </div>
        </form>
        <form action={requestSupportAccess} className="grid gap-2 rounded border border-stone-200 p-3">
          <p className="text-sm font-medium">Ask for support access</p>
          <input type="hidden" name="tenant_id" value={t.tenant_id} />
          <div className="flex gap-2">
            <Select name="access" defaultValue="read" aria-label={`Access for ${t.name}`}>
              <option value="read">read only</option>
              <option value="write">read and change</option>
            </Select>
            <Input name="hours" type="number" min={1} max={MAX_HOURS} defaultValue={2} aria-label={`Hours for ${t.name}`} className="w-24" />
          </div>
          <Textarea name="reason" rows={2} placeholder="What you need to look at, and why (the owner reads this)" aria-label={`Reason for ${t.name}`} />
          <div>
            <Button type="submit" variant="secondary">Send request</Button>
          </div>
        </form>
      </div>
      {t.status === "archived" ? (
        <form action={purgeCompany} className="flex flex-wrap items-end gap-2 rounded border border-red-200 p-3">
          <input type="hidden" name="tenant_id" value={t.tenant_id} />
          <input type="hidden" name="name" value={t.name} />
          <Field label="Type the company's name to delete its data" htmlFor={`purge-${t.tenant_id}`} hint="Allowed 90 days after archiving, once every application record is past retention.">
            <Input id={`purge-${t.tenant_id}`} name="confirm" />
          </Field>
          <Button type="submit" variant="danger">Purge</Button>
        </form>
      ) : null}
    </div>
  );
}

export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ error?: string; note?: string }> }) {
  const session = await requirePlatformAdmin();
  const { error, note } = await searchParams;

  const { overview, invites, grants, purges } = await dbAs(session, async (tx) => ({
    overview: await platformOverview(tx),
    invites: await tx<Invite[]>`
      select i.tenant_id, i.email, i.token, i.expires_at
      from public.invitations i join public.roles r on r.id = i.role_id
      where r.tenant_id is null and r.key = 'owner' and i.accepted_at is null and i.expires_at >= now()`,
    grants: (await myGrants(tx)).filter((g) => g.state === "pending" || g.state === "live"),
    purges: await tx<Purge[]>`select name, archived_at, purged_at from public.tenant_purges order by purged_at desc limit 20`,
  }));

  return (
    <PlatformShell email={session.email}>
      <h1 className="text-2xl font-semibold">Companies</h1>
      {note ? <Notice kind="success">{note}</Notice> : null}
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      <Card title="Your support access" description="You see a company's data only while an owner's approval is live. Every page you open there is logged for the company.">
        {grants.length === 0 ? (
          <Empty>No requests open and no live access.</Empty>
        ) : (
          <Table headers={["Company", "Access", "State", "Ends", ""]}>
            {grants.map((g) => (
              <tr key={g.id} data-testid="my-grant">
                <td className="py-2 pr-4 font-medium">{g.tenant_name}</td>
                <td className="py-2 pr-4">{g.access === "read" ? "read only" : "read and change"}, {g.hours} h</td>
                <td className="py-2 pr-4">{STATE_LABELS[g.state]}</td>
                <td className="py-2 pr-4">{g.expires_at ? g.expires_at.toISOString().replace("T", " ").slice(0, 16) + " UTC" : ""}</td>
                <td className="py-2 text-right">
                  <div className="flex justify-end gap-2">
                    {g.state === "live" ? (
                      <form action={openSupportCompany}>
                        <input type="hidden" name="tenant_id" value={g.tenant_id} />
                        <Button type="submit" data-testid="open-company">Open company</Button>
                      </form>
                    ) : null}
                    <form action={endMySupport}>
                      <input type="hidden" name="grant_id" value={g.id} />
                      <Button type="submit" variant="secondary">{g.state === "live" ? "End" : "Withdraw"}</Button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="All companies" description="Counts and dates only: platform staff see no company's customers, records or money without a grant.">
        {overview.length === 0 ? (
          <Empty>No companies yet.</Empty>
        ) : (
          <div className="grid gap-4">
            {overview.map((t) => (
              <Company key={t.tenant_id} t={t} invite={invites.find((i) => i.tenant_id === t.tenant_id)} />
            ))}
          </div>
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

      <Card title="Purged companies" description="Companies whose data was deleted after retention ran out.">
        {purges.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <Table headers={["Company", "Archived", "Purged"]}>
            {purges.map((p) => (
              <tr key={`${p.name}-${p.purged_at.toISOString()}`}>
                <td className="py-2 pr-4">{p.name}</td>
                <td className="py-2 pr-4">{when(p.archived_at)}</td>
                <td className="py-2 pr-4">{when(p.purged_at)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </PlatformShell>
  );
}
