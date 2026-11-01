import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Empty, Input, Notice, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { formatInstant } from "@/lib/dates";
import { inbox } from "@/lib/messaging/db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { markReadAction, replyAction, runMessagingNow } from "./actions";

export const metadata: Metadata = { title: "Messages" };

/** Texts from customers waiting for an answer, newest unread first (spec 11 stories). */
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ error?: string; note?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "messages.send");
  const { error, note } = await searchParams;
  const items = await dbAs(session, (tx) => inbox(tx, active.tenantId));
  const unread = items.filter((i) => !i.read_at).length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Messages</h1>
          <p className="mt-1 text-sm text-stone-600">Texts from customers. Every message to and from an account is also on its page.</p>
        </div>
        <div className="flex items-center gap-3">
          {can(active.permissions, "messages.manage") ? (
            <Link href="/messages/campaigns" className="text-sm text-emerald-800 underline">
              Campaigns
            </Link>
          ) : null}
          <form action={runMessagingNow}>
            <input type="hidden" name="tenant_id" value={active.tenantId} />
            <Button type="submit" variant="secondary">
              Send what is due now
            </Button>
          </form>
        </div>
      </div>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}
      {note ? <Notice kind="success">{note}</Notice> : null}
      <Card title={`${unread} waiting for a reply`}>
        {items.length === 0 ? (
          <Empty>No texts from customers in the last 60 days.</Empty>
        ) : (
          <ul className="grid gap-3">
            {items.map((m) => (
              <li key={m.id} className="rounded-md border border-stone-200 p-3" data-testid="inbox-item">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {m.read_at ? <Badge>read</Badge> : <Badge tone="warn">new</Badge>}
                  <span className="font-medium">{m.contact_name ?? m.from_address}</span>
                  {m.account_id ? (
                    <Link href={`/customers/${m.account_id}`} className="text-emerald-800 underline">
                      {m.account_name}
                    </Link>
                  ) : (
                    <span className="text-stone-500">no matching customer</span>
                  )}
                  <span className="text-xs text-stone-500">{formatInstant(m.created_at, active.tenantTimezone)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <form action={replyAction} className="flex flex-1 gap-2">
                    <input type="hidden" name="tenant_id" value={active.tenantId} />
                    <input type="hidden" name="message_id" value={m.id} />
                    <Input name="body" placeholder="Reply by text" aria-label={`Reply to ${m.contact_name ?? m.from_address}`} className="flex-1" />
                    <Button type="submit">Reply</Button>
                  </form>
                  {!m.read_at ? (
                    <form action={markReadAction}>
                      <input type="hidden" name="tenant_id" value={active.tenantId} />
                      <input type="hidden" name="message_id" value={m.id} />
                      <Button type="submit" variant="secondary">
                        Mark read
                      </Button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
