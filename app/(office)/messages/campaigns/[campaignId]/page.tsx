import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, Field, Input, Notice, Table, errorMessage } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { formatInstant, todayInZone } from "@/lib/dates";
import { type Audience, audience } from "@/lib/messaging/db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { cancelCampaign, scheduleCampaign, sendCampaignNow } from "../../actions";

export const metadata: Metadata = { title: "Campaign" };

type Campaign = { id: string; name: string; channel: "sms" | "email"; subject: string | null; body: string; audience: Audience; status: string; scheduled_for: Date | null; counts: { audience?: number; queued?: number; skipped?: number }; sent_at: Date | null };

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ campaignId: string }>; searchParams: Promise<{ error?: string; note?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "messages.manage");
  const { campaignId } = await params;
  const { error, note } = await searchParams;
  const data = await dbAs(session, async (tx) => {
    const [c] = await tx<Campaign[]>`select id, name, channel, subject, body, audience, status, scheduled_for, counts, sent_at from public.campaigns where id = ${campaignId} and tenant_id = ${active.tenantId}`;
    if (!c) return null;
    const members = ["draft", "scheduled"].includes(c.status) ? await audience(tx, active.tenantId, c.audience ?? {}, todayInZone(active.tenantTimezone)) : [];
    const sent = await tx<{ status: string; n: number }[]>`select status, count(*)::int as n from public.messages where campaign_id = ${campaignId} group by status order by status`;
    return { c, members, sent };
  });
  if (!data) notFound();
  const { c, members, sent } = data;
  const filters = Object.entries(c.audience ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== "");
  const open = ["draft", "scheduled"].includes(c.status);

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/messages/campaigns" className="hover:underline">
          Campaigns
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{c.name}</h1>
        <Badge>{c.channel === "sms" ? "text" : "email"}</Badge>
        <Badge tone={c.status === "sent" ? "good" : c.status === "cancelled" ? "bad" : "neutral"}>{c.status}</Badge>
      </div>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}
      {note ? <Notice kind="success">{note}</Notice> : null}
      <Card title="Message">
        {c.subject ? <p className="text-sm font-medium">{c.subject}</p> : null}
        <p className="whitespace-pre-wrap text-sm">{c.body}</p>
        <p className="mt-2 text-xs text-stone-500">Audience: {filters.length ? filters.map(([k, v]) => `${k.replace(/_/g, " ")} ${String(v).replace("_", " ")}`).join("; ") : "every active account"}.</p>
      </Card>
      {open ? (
        <Card title={`${members.length} account${members.length === 1 ? "" : "s"} selected`} description="Before consent: an account without texting consent, or opted out, is counted here and not sent to.">
          <p className="text-2xl font-semibold tabular-nums" data-testid="campaign-count">
            {members.length}
          </p>
          <Table headers={["Account", "Contact", c.channel === "sms" ? "Phone" : "Email"]}>
            {members.slice(0, 10).map((m) => (
              <tr key={m.account_id} data-testid="campaign-sample">
                <td className="py-1 pr-4">{m.account_name}</td>
                <td className="py-1 pr-4">{m.name}</td>
                <td className="py-1 pr-4">{c.channel === "sms" ? (m.phone ?? "none") : (m.email ?? "none")}</td>
              </tr>
            ))}
          </Table>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <form action={sendCampaignNow}>
              <input type="hidden" name="tenant_id" value={active.tenantId} />
              <input type="hidden" name="campaign_id" value={c.id} />
              <Button type="submit">Send now</Button>
            </form>
            <form action={scheduleCampaign} className="flex items-end gap-2">
              <input type="hidden" name="tenant_id" value={active.tenantId} />
              <input type="hidden" name="campaign_id" value={c.id} />
              <Field label="Or send at" htmlFor="cmp-at">
                <Input id="cmp-at" name="scheduled_for" type="datetime-local" required />
              </Field>
              <Button type="submit" variant="secondary">
                Schedule
              </Button>
            </form>
            <form action={cancelCampaign}>
              <input type="hidden" name="tenant_id" value={active.tenantId} />
              <input type="hidden" name="campaign_id" value={c.id} />
              <Button type="submit" variant="danger">
                Cancel
              </Button>
            </form>
          </div>
          {c.status === "scheduled" && c.scheduled_for ? <p className="mt-2 text-sm text-stone-600">Scheduled for {formatInstant(c.scheduled_for, active.tenantTimezone)}.</p> : null}
        </Card>
      ) : (
        <Card title="Sent" description={c.sent_at ? formatInstant(c.sent_at, active.tenantTimezone) : undefined}>
          <p className="text-sm" data-testid="campaign-sent">
            {c.counts.queued ?? 0} queued of {c.counts.audience ?? 0} selected ({c.counts.skipped ?? 0} with no address).
          </p>
          <Table headers={["Status", "Messages"]}>
            {sent.map((s) => (
              <tr key={s.status} data-testid="campaign-status">
                <td className="py-1 pr-4">{s.status}</td>
                <td className="py-1 pr-4 tabular-nums">{s.n}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}
