import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Table, Textarea, errorMessage } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { SERVICE_LINES } from "@/lib/catalog/service-lines";
import { formatInstant } from "@/lib/dates";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { createCampaign } from "../actions";

export const metadata: Metadata = { title: "Campaigns" };

const TONE = { draft: "neutral", scheduled: "warn", sending: "warn", sent: "good", cancelled: "bad" } as const;

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "messages.manage");
  const { error } = await searchParams;
  const rows = await dbAs(session, (tx) =>
    tx<{ id: string; name: string; channel: string; status: keyof typeof TONE; counts: { queued?: number; audience?: number }; created_at: Date; sent_at: Date | null }[]>`
      select id, name, channel, status, counts, created_at, sent_at from public.campaigns where tenant_id = ${active.tenantId} order by created_at desc limit 100`,
  );
  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/messages" className="hover:underline">
          Messages
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Campaigns</h1>
      <p className="text-sm text-stone-600">One message to every account a filter selects. Texts go only to people who agreed to them, never in quiet hours; email carries an unsubscribe link.</p>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}
      <Card title="New campaign" description="Variables: {{customer_name}}, {{company_name}}, {{company_phone}}, {{property_address}}, and for email {{unsubscribe_url}}.">
        <form action={createCampaign} className="grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="tenant_id" value={active.tenantId} />
          <Field label="Name" htmlFor="cmp-name">
            <Input id="cmp-name" name="name" required />
          </Field>
          <Field label="Channel" htmlFor="cmp-channel">
            <Select id="cmp-channel" name="channel" defaultValue="sms">
              <option value="sms">Text</option>
              <option value="email">Email</option>
            </Select>
          </Field>
          <Field label="Email subject" htmlFor="cmp-subject">
            <Input id="cmp-subject" name="subject" />
          </Field>
          <div className="sm:col-span-3">
            <Field label="Message" htmlFor="cmp-body">
              <Textarea id="cmp-body" name="body" rows={4} required defaultValue={"{{company_name}}: "} />
            </Field>
          </div>
          <Field label="Account type" htmlFor="cmp-type">
            <Select id="cmp-type" name="account_type" defaultValue="">
              <option value="">Any</option>
              <option value="residential">Residential</option>
              <option value="commercial">Commercial</option>
              <option value="property_manager">Property manager</option>
            </Select>
          </Field>
          <Field label="Service line of an active agreement" htmlFor="cmp-line">
            <Select id="cmp-line" name="service_line" defaultValue="">
              <option value="">Any</option>
              {SERVICE_LINES.map((l) => (
                <option key={l} value={l}>
                  {l.replace("_", " ")}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="State" htmlFor="cmp-state">
            <Input id="cmp-state" name="state_code" maxLength={2} placeholder="any" />
          </Field>
          <Field label="No completed visit in (days)" htmlFor="cmp-novisit">
            <Input id="cmp-novisit" name="no_visit_days" inputMode="numeric" />
          </Field>
          <Field label="Agreement ending within (days)" htmlFor="cmp-ending">
            <Input id="cmp-ending" name="ending_within_days" inputMode="numeric" />
          </Field>
          <div className="flex items-end">
            <Button type="submit">Save and preview</Button>
          </div>
        </form>
      </Card>
      <Card title="Campaigns">
        {rows.length === 0 ? (
          <Empty>No campaigns yet.</Empty>
        ) : (
          <Table headers={["Name", "Channel", "Status", "Queued", "When", ""]}>
            {rows.map((c) => (
              <tr key={c.id} data-testid="campaign-row">
                <td className="py-2 pr-4">{c.name}</td>
                <td className="py-2 pr-4">{c.channel === "sms" ? "text" : "email"}</td>
                <td className="py-2 pr-4">
                  <Badge tone={TONE[c.status]}>{c.status}</Badge>
                </td>
                <td className="py-2 pr-4 tabular-nums">{c.counts?.queued ?? ""}</td>
                <td className="py-2 pr-4">{formatInstant(c.sent_at ?? c.created_at, active.tenantTimezone)}</td>
                <td className="py-2 pr-4">
                  <Link href={`/messages/campaigns/${c.id}`} className="underline">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
