import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, Empty, Notice, Table, errorMessage } from "@/components/ui";
import { ARRIVAL_WINDOW_LABELS, type ArrivalWindow } from "@/lib/dispatch/checks";
import { formatBusinessDate, formatInstantDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { headers } from "next/headers";
import { overview, referralFor } from "@/lib/portal/db";
import { portalDb, requirePortal } from "@/lib/portal/session";
import { AskBox } from "@/components/portal/ask-box";

export const metadata: Metadata = { title: "Your account" };

const STATUS: Record<string, string> = { planned: "To be scheduled", scheduled: "Scheduled", en_route: "On the way", in_progress: "In progress", completed: "Done" };
const NOTICE: Record<string, string> = {
  post_application: "After-treatment notice",
  pre_application_offer: "Before-treatment notice offer",
  resident_notice: "Resident notice",
  posting_sign: "Posting sign",
  registry_advance: "Advance notice",
  other: "Notice",
};

/** The customer's home page (spec 16): what comes next, what is owed, what was done, and what they asked for. */
export default async function PortalHome({ searchParams }: { searchParams: Promise<{ note?: string; error?: string }> }) {
  const q = await searchParams;
  const { session, identity } = await requirePortal();
  const [data, referral, questions] = await portalDb(session, identity, (tx) =>
    Promise.all([
      overview(tx, identity),
      referralFor(tx, identity),
      tx<{ id: string; question: string; answer: string | null; status: string; office_answer: string | null; created_at: Date }[]>`
        select id, question, answer, status, office_answer, created_at from public.portal_questions
        where tenant_id = ${identity.tenant_id} and portal_user_id = ${identity.id}
          and (status <> 'answered' or created_at > now() - interval '30 days')
        -- An office answer comes back to the top when it arrives, so it is always seen.
        order by coalesce(answered_at, created_at) desc limit 10`,
    ]),
  );
  const h = await headers();
  const origin = h.get("origin") ?? (h.get("host") ? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}` : (process.env.NEXT_PUBLIC_SITE_URL ?? ""));
  const tz = identity.tenant_timezone;
  const multi = data.properties.length > 1;
  const sites = data.properties.filter((p) => p.has_site);
  const visitDay = (v: (typeof data.upcoming)[number]) =>
    v.scheduled_for
      ? `${formatBusinessDate(v.scheduled_for)}${v.arrival_window !== "any" ? `, ${ARRIVAL_WINDOW_LABELS[v.arrival_window as ArrivalWindow].toLowerCase()}` : ""}`
      : `between ${formatBusinessDate(v.due_start)} and ${formatBusinessDate(v.due_end)}`;
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">{identity.account_name}</h1>
        <p className="text-sm text-stone-600">
          {data.properties.map((p) => p.name ?? p.address).join("; ")}
        </p>
      </div>
      {q.note ? <Notice kind="success">{q.note}</Notice> : null}
      {errorMessage(q.error) ? <Notice kind="error">{errorMessage(q.error)}</Notice> : null}

      <Card title="Ask a question" description="About your visits, what was applied, your bill or your plan. Answers come from your own records; anything else goes to our office.">
        <AskBox />
        {questions.length ? (
          <ul className="mt-3 grid gap-2 text-sm" data-testid="my-questions">
            {questions.map((x) => (
              <li key={x.id} className="rounded border border-stone-100 p-2" data-testid="my-question">
                <p className="font-medium">{x.question}</p>
                {x.status === "answered_by_office" ? (
                  <p className="mt-1">
                    <span className="text-xs text-stone-500">From the office: </span>
                    {x.office_answer}
                  </p>
                ) : x.status === "waiting" ? (
                  <p className="mt-1 text-stone-600">Waiting for the office.</p>
                ) : (
                  <p className="mt-1">{x.answer}</p>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card title="Next visits">
        {data.upcoming.length === 0 ? (
          <Empty>No visits coming up.</Empty>
        ) : (
          <ul className="grid gap-2" data-testid="portal-upcoming">
            {data.upcoming.map((v) => (
              <li key={v.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stone-100 pb-2">
                <span>
                  <Link href={`/portal/visits/${v.id}`} className="font-medium underline">
                    {v.service}
                  </Link>
                  {v.step_label ? <span className="text-sm text-stone-600"> ({v.step_label})</span> : null}
                  {v.kind === "reservice" ? <span className="text-sm text-stone-600"> (re-service)</span> : null}
                  {multi ? <span className="block text-xs text-stone-500">{v.address}</span> : null}
                </span>
                <span className="text-sm">
                  {visitDay(v)} <Badge tone={v.status === "planned" ? "neutral" : "good"}>{STATUS[v.status] ?? v.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title={data.balance_cents > 0 ? `You owe ${formatCents(data.balance_cents)}` : "Nothing owed"}
        actions={
          <Link href="/portal/billing" className="text-sm text-emerald-800 underline">
            Cards and autopay
          </Link>
        }
      >
        {data.open.length === 0 ? (
          <Empty>No open invoices.</Empty>
        ) : (
          <Table headers={["Invoice", "Issued", "Due", "Open", ""]}>
            {data.open.map((i) => (
              <tr key={i.id} data-testid="portal-open-invoice">
                <td className="py-2 pr-4">#{i.number}</td>
                <td className="py-2 pr-4">{i.issued_on ? formatBusinessDate(i.issued_on) : ""}</td>
                <td className="py-2 pr-4">{i.due_on ? formatBusinessDate(i.due_on) : ""}</td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(i.total_cents - i.paid_cents)}</td>
                <td className="py-2 pr-4">
                  <Link href={`/portal/invoices/${i.id}`} className="text-emerald-800 underline">
                    {i.status === "past_due" ? "Past due: pay" : "View and pay"}
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {sites.length ? (
        <Card title="Your sites" description="Device maps, activity, recommendations and the audit binder.">
          <ul className="grid gap-1">
            {sites.map((s) => (
              <li key={s.id}>
                <Link href={`/portal/sites/${s.id}`} className="underline">
                  {s.name ?? s.address}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title="Past visits" description="What was done and what was applied.">
        {data.recent.length === 0 ? (
          <Empty>No visits yet.</Empty>
        ) : (
          <ul className="grid gap-1">
            {data.recent.map((v) => (
              <li key={v.id} className="flex justify-between gap-2 text-sm">
                <Link href={`/portal/visits/${v.id}`} className="underline">
                  {v.service}
                  {multi ? `, ${v.address}` : ""}
                </Link>
                <span>{v.completed_at ? formatInstantDate(v.completed_at, tz) : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 sm:grid-cols-2">
        <Card
          title="Your requests"
          actions={
            <Link href="/portal/requests" className="text-sm text-emerald-800 underline">
              Ask for a visit
            </Link>
          }
        >
          {data.requests.length === 0 ? (
            <Empty>No requests.</Empty>
          ) : (
            <ul className="grid gap-1 text-sm">
              {data.requests.slice(0, 5).map((r) => (
                <li key={r.id}>
                  {r.kind === "reservice" ? "Re-service" : r.kind === "booking" ? (r.service ?? "Booking") : "New day"}: <Badge tone={r.status === "open" ? "warn" : r.status === "done" ? "good" : "bad"}>{r.status}</Badge>
                  {r.response ? <span className="block text-xs text-stone-600">{r.response}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {referral ? (
          <Card title="Refer a friend" description={`When a friend you send signs a plan, you get ${formatCents(referral.credit_cents)} off your next invoice.`}>
            <p className="break-all text-sm" data-testid="portal-referral-link">
              {origin}/r/{referral.code}
            </p>
          </Card>
        ) : null}
        <Card title="Notices sent to you">
          {data.notices.length === 0 ? (
            <Empty>No notices.</Empty>
          ) : (
            <ul className="grid gap-1 text-sm">
              {data.notices.map((n) => (
                <li key={n.id}>
                  {NOTICE[n.kind] ?? n.kind.replace(/_/g, " ")}, {formatInstantDate(n.sent_at ?? n.created_at, tz)}
                  {n.channel ? ` by ${n.channel}` : ""}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
