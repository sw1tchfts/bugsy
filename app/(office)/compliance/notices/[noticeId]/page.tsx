import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, Field, Input, Notice, Select, Textarea, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { NOTICE_KIND_LABELS, type NoticeKind } from "@/lib/compliance/notices";
import { formatBusinessDate, formatInstant } from "@/lib/dates";
import { listMembers } from "@/lib/dispatch/db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { recordNoticeProof, waiveNotice } from "../../actions";

export const metadata: Metadata = { title: "Notice" };

type NoticeRow = {
  id: string;
  kind: NoticeKind;
  rule_key: string;
  required: boolean;
  visit_id: string | null;
  agreement_id: string | null;
  property_id: string;
  recipient_name: string;
  recipient_address: string | null;
  recipient_email: string | null;
  recipient_phone: string | null;
  channel: string;
  due_by: string | null;
  for_scheduled_for: string | null;
  status: string;
  sent_at: string | null;
  proof: Record<string, unknown>;
  waived_reason: string | null;
  created_at: string;
  address: string;
};

export default async function NoticePage({ params, searchParams }: { params: Promise<{ noticeId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "compliance.read");
  const { noticeId } = await params;
  const { error } = await searchParams;
  const tenantId = active.tenantId;
  const tz = active.tenantTimezone;
  const canProve = can(active.permissions, "compliance.write") || can(active.permissions, "dispatch.write");
  const canWaive = can(active.permissions, "compliance.write");

  const data = await dbAs(session, async (tx) => {
    const [notice] = await tx<NoticeRow[]>`
      select n.*, concat_ws(', ', concat_ws(' ', p.line1, p.line2), p.city, concat_ws(' ', p.state_code, p.postal_code)) as address
      from public.notices n join public.properties p on p.id = n.property_id where n.id = ${noticeId} and n.tenant_id = ${tenantId}`;
    if (!notice) return null;
    return { notice, members: await listMembers(tx, tenantId) };
  });
  if (!data) notFound();
  const { notice, members } = data;
  const nameOf = (id: unknown) => (typeof id === "string" ? (members.find((m) => m.user_id === id)?.name ?? id) : "");
  const proof = notice.proof;
  const open = notice.status === "due" || notice.status === "failed";

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/compliance" className="hover:underline">
          Compliance
        </Link>{" "}
        /{" "}
        <Link href="/compliance/notices" className="hover:underline">
          Notices
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{NOTICE_KIND_LABELS[notice.kind]}</h1>
        {notice.required ? <Badge tone="warn">required by {notice.rule_key}</Badge> : <Badge>best practice, no state rule on file</Badge>}
        {notice.status === "sent" ? <Badge tone="good">sent</Badge> : notice.status === "waived" ? <Badge>waived</Badge> : notice.status === "failed" ? <Badge tone="bad">failed</Badge> : <Badge tone="warn">due</Badge>}
      </div>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      <Card
        title="The obligation"
        actions={
          <Link href={`/compliance/notices/${notice.id}/print`} className="text-sm text-emerald-800 underline">
            Print view
          </Link>
        }
      >
        <dl className="grid gap-2 text-sm sm:grid-cols-2" data-testid="notice-detail">
          <div>
            <dt className="text-stone-500">Recipient</dt>
            <dd>
              {notice.recipient_name}
              {notice.recipient_address ? <span className="block text-xs text-stone-600">{notice.recipient_address}</span> : null}
              {notice.recipient_email ? <span className="block text-xs text-stone-600">{notice.recipient_email}</span> : null}
              {notice.recipient_phone ? <span className="block text-xs text-stone-600">{notice.recipient_phone}</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-stone-500">Property</dt>
            <dd>
              {notice.address}
              {notice.visit_id ? (
                <>
                  {" "}
                  <Link href={`/dispatch/visits/${notice.visit_id}`} className="underline">
                    visit
                  </Link>
                </>
              ) : null}
              {notice.for_scheduled_for ? <span className="block text-xs text-stone-600">for the visit on {formatBusinessDate(notice.for_scheduled_for)}</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-stone-500">Channel</dt>
            <dd>{notice.channel}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Due</dt>
            <dd>{notice.due_by ? formatInstant(notice.due_by, tz) : "no legal due time"}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Created</dt>
            <dd>{formatInstant(notice.created_at, tz)}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Proof</dt>
            <dd data-testid="notice-proof">
              {notice.status === "sent" ? (
                <>
                  Sent {notice.sent_at ? formatInstant(notice.sent_at, tz) : ""} by {String(proof.method ?? notice.channel)}
                  {proof.recorded_by ? `, recorded by ${nameOf(proof.recorded_by)}` : ""}
                  {proof.spoke_with ? `, spoke with ${String(proof.spoke_with)}` : ""}
                  {proof.note ? `: ${String(proof.note)}` : ""}
                  {proof.message_id ? ` (message ${String(proof.message_id)})` : ""}
                </>
              ) : notice.status === "waived" ? (
                `Waived: ${notice.waived_reason}`
              ) : (
                "none yet"
              )}
            </dd>
          </div>
        </dl>
      </Card>

      {open && canProve ? (
        <Card title="Record proof" description="When the notice went out by paper, mail, phone or a posted sign, say how and when. Email and text proof arrives from messaging on its own.">
          <form action={recordNoticeProof} className="grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="tenant_id" value={tenantId} />
            <input type="hidden" name="notice_id" value={notice.id} />
            <Field label="How" htmlFor="proof-channel">
              <Select id="proof-channel" name="channel" defaultValue={["email", "sms"].includes(notice.channel) ? "print" : notice.channel}>
                <option value="print">Printed and handed over</option>
                <option value="mail">Mailed</option>
                <option value="phone">By phone</option>
                <option value="posted">Posted at the property</option>
                <option value="email">Emailed by hand</option>
                <option value="sms">Texted by hand</option>
              </Select>
            </Field>
            <Field label="When (blank for now)" htmlFor="proof-when">
              <Input id="proof-when" name="sent_at" type="datetime-local" />
            </Field>
            <Field label="Spoke with" htmlFor="proof-spoke">
              <Input id="proof-spoke" name="spoke_with" />
            </Field>
            <Field label="Note" htmlFor="proof-note">
              <Input id="proof-note" name="note" />
            </Field>
            <div className="sm:col-span-4">
              <Button type="submit">Record as sent</Button>
            </div>
          </form>
        </Card>
      ) : null}

      {open && canWaive ? (
        <Card title="Waive" description="Only with a reason that an inspector will accept: the obligation did not apply, or delivery was impossible for a documented cause.">
          <form action={waiveNotice} className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="tenant_id" value={tenantId} />
            <input type="hidden" name="notice_id" value={notice.id} />
            <div className="sm:col-span-2">
              <Field label="Reason" htmlFor="waive-reason">
                <Textarea id="waive-reason" name="reason" rows={2} required />
              </Field>
            </div>
            <div className="self-end">
              <Button type="submit" variant="secondary">
                Waive
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
