import type { Metadata } from "next";
import { Badge, Button, Card, Empty, Notice, Table, errorMessage } from "@/components/ui";
import { isOwnerRole } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { formatInstant } from "@/lib/dates";
import { accessLog, grantsFor } from "@/lib/platform/db";
import { STATE_LABELS } from "@/lib/platform/support";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { decideSupportRequest, endSupportAccess } from "./actions";

export const metadata: Metadata = { title: "Support access" };

/** Who from platform support asked for access, what the owner decided, and every page they opened (spec 13 rule 5). */
export default async function SupportAccessPage({ searchParams }: { searchParams: Promise<{ note?: string; error?: string }> }) {
  const { active } = await requireActiveTenant();
  const { session } = await requirePermission(active.tenantId, "audit.read");
  const { note, error } = await searchParams;
  const tz = active.tenantTimezone;
  const owner = !active.support && isOwnerRole(active.permissions);
  const { grants, log } = await dbAs(session, async (tx) => ({ grants: await grantsFor(tx, active.tenantId), log: await accessLog(tx, active.tenantId) }));
  const open = grants.filter((g) => g.state === "pending" || g.state === "live");
  const past = grants.filter((g) => g.state !== "pending" && g.state !== "live");

  return (
    <>
      <h1 className="text-2xl font-semibold">Support access</h1>
      <p className="text-sm text-stone-600">
        Bugsy staff cannot see your company&apos;s data unless an owner lets them, for a set number of hours. Every page they open is listed below.
      </p>
      {note ? <Notice kind="success">{note}</Notice> : null}
      {errorMessage(error) ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      <Card title="Requests and live access">
        {open.length === 0 ? (
          <Empty>Nobody from support is asking for or holding access.</Empty>
        ) : (
          <div className="grid gap-4">
            {open.map((g) => (
              <div key={g.id} className="rounded border border-stone-200 p-3 text-sm" data-testid="support-open">
                <p className="font-medium">
                  {g.user_email} {g.state === "live" ? "has" : "asks for"} {g.access === "read" ? "read-only" : "read and change"} access for {g.hours} hour{g.hours === 1 ? "" : "s"}{" "}
                  <Badge tone={g.state === "live" ? "warn" : "neutral"}>{STATE_LABELS[g.state]}</Badge>
                </p>
                <p className="mt-1 text-stone-700">&ldquo;{g.reason}&rdquo;</p>
                <p className="mt-1 text-xs text-stone-500">
                  Asked {formatInstant(g.requested_at, tz)}
                  {g.state === "live" && g.expires_at ? `; ends ${formatInstant(g.expires_at, tz)}` : ""}
                </p>
                {owner ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {g.state === "pending" ? (
                      <>
                        <form action={decideSupportRequest}>
                          <input type="hidden" name="tenant_id" value={active.tenantId} />
                          <input type="hidden" name="grant_id" value={g.id} />
                          <input type="hidden" name="decision" value="approve" />
                          <Button type="submit" data-testid="support-approve">
                            Approve for {g.hours} hour{g.hours === 1 ? "" : "s"}
                          </Button>
                        </form>
                        <form action={decideSupportRequest}>
                          <input type="hidden" name="tenant_id" value={active.tenantId} />
                          <input type="hidden" name="grant_id" value={g.id} />
                          <input type="hidden" name="decision" value="deny" />
                          <Button type="submit" variant="secondary" data-testid="support-deny">
                            Deny
                          </Button>
                        </form>
                      </>
                    ) : (
                      <form action={endSupportAccess}>
                        <input type="hidden" name="tenant_id" value={active.tenantId} />
                        <input type="hidden" name="grant_id" value={g.id} />
                        <Button type="submit" variant="danger" data-testid="support-end">
                          End access now
                        </Button>
                      </form>
                    )}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-stone-500">An owner approves, denies or ends support access.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Pages support opened" description="One line per page, download or action, newest first.">
        {log.length === 0 ? (
          <Empty>Support has not opened anything.</Empty>
        ) : (
          <Table headers={["When", "Who", "Access", "What"]}>
            {log.map((l, i) => (
              <tr key={i} data-testid="support-log">
                <td className="py-1 pr-4 whitespace-nowrap">{formatInstant(l.at, tz)}</td>
                <td className="py-1 pr-4">{l.user_email}</td>
                <td className="py-1 pr-4">{l.access === "read" ? "read only" : "read and change"}</td>
                <td className="py-1 pr-4 font-mono text-xs">
                  {l.method === "GET" ? "" : `${l.method} `}
                  {l.path}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Earlier requests">
        {past.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <Table headers={["Asked", "Who", "Access", "Reason", "Outcome"]}>
            {past.map((g) => (
              <tr key={g.id} data-testid="support-past">
                <td className="py-1 pr-4 whitespace-nowrap">{formatInstant(g.requested_at, tz)}</td>
                <td className="py-1 pr-4">{g.user_email}</td>
                <td className="py-1 pr-4">
                  {g.access}, {g.hours} h
                </td>
                <td className="py-1 pr-4">{g.reason}</td>
                <td className="py-1 pr-4">{STATE_LABELS[g.state]}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
