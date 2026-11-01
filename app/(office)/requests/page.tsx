import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, Empty, Input, Notice, Table, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { formatBusinessDate, formatInstant, todayInZone } from "@/lib/dates";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { answerPortalQuestion, answerRequest, bookRequestedReservice } from "./actions";

export const metadata: Metadata = { title: "Requests" };

type Row = {
  id: string;
  kind: string;
  status: string;
  created_at: Date;
  account_id: string;
  account_name: string;
  property_id: string;
  address: string;
  details: string | null;
  preferred_date: string | null;
  arrival_window: string | null;
  service: string | null;
  visit_id: string | null;
  result_visit_id: string | null;
  response: string | null;
};

const KIND: Record<string, string> = { reservice: "Re-service", booking: "Booking", reschedule: "New day" };

/** What customers asked for in the portal (spec 16 rule 4): book it, mark it done, or decline with a note. */
export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ note?: string; error?: string; show?: string }> }) {
  const q = await searchParams;
  const { session, active } = await requireActiveTenant();
  if (!can(active.permissions, "customers.read") && !can(active.permissions, "dispatch.read")) redirect("/?error=forbidden");
  const canAct = can(active.permissions, "customers.write") || can(active.permissions, "dispatch.write");
  const showAll = q.show === "all";
  const rows = await dbAs(session, (tx) => tx<Row[]>`
    select r.id, r.kind, r.status, r.created_at, r.account_id, a.name as account_name, r.property_id, p.normalized_address as address, r.details,
           r.preferred_date::text, r.arrival_window, st.name as service, r.visit_id, r.result_visit_id, r.response
    from public.service_requests r join public.accounts a on a.id = r.account_id join public.properties p on p.id = r.property_id
      left join public.service_types st on st.id = r.service_type_id
    where r.tenant_id = ${active.tenantId} and (${showAll} or r.status = 'open')
    order by r.status = 'open' desc, r.created_at desc limit 200`);
  const today = todayInZone(active.tenantTimezone);
  const hidden = <input type="hidden" name="tenant_id" value={active.tenantId} />;
  // Spec 21 rule 7: portal questions the assistant could not answer from the customer's records.
  const questions = can(active.permissions, "customers.read")
    ? await dbAs(session, (tx) => tx<{ id: string; account_id: string; account_name: string; question: string; answer: string | null; created_at: Date }[]>`
        select q.id, q.account_id, a.name as account_name, q.question, q.answer, q.created_at
        from public.portal_questions q join public.accounts a on a.id = q.account_id
        where q.tenant_id = ${active.tenantId} and q.status = 'waiting' order by q.created_at limit 50`)
    : [];
  return (
    <>
      <h1 className="text-2xl font-semibold">Customer requests</h1>
      <p className="text-sm text-stone-600">
        Re-services, bookings and new days customers asked for in the portal.{" "}
        <Link href={showAll ? "/requests" : "/requests?show=all"} className="text-emerald-800 underline">
          {showAll ? "Show open only" : "Show answered too"}
        </Link>
      </p>
      {q.note ? <Notice kind="success">{q.note}</Notice> : null}
      {errorMessage(q.error) ? <Notice kind="error">{errorMessage(q.error)}</Notice> : null}
      <Card title={showAll ? "All requests" : "Open requests"}>
        {rows.length === 0 ? (
          <Empty>Nothing waiting.</Empty>
        ) : (
          <Table headers={["Asked", "Customer", "What", "", ""]}>
            {rows.map((r) => (
              <tr key={r.id} data-testid="request-row">
                <td className="py-2 pr-4 align-top text-sm">{formatInstant(r.created_at, active.tenantTimezone)}</td>
                <td className="py-2 pr-4 align-top">
                  <Link href={`/customers/${r.account_id}`} className="underline">
                    {r.account_name}
                  </Link>
                  <span className="block text-xs text-stone-500">{r.address}</span>
                </td>
                <td className="py-2 pr-4 align-top text-sm">
                  <Badge tone={r.status === "open" ? "warn" : r.status === "done" ? "good" : "bad"}>{KIND[r.kind] ?? r.kind}</Badge> {r.service ?? ""}
                  {r.preferred_date ? <span className="block">wants {formatBusinessDate(r.preferred_date)}{r.arrival_window && r.arrival_window !== "any" ? `, ${r.arrival_window}` : ""}</span> : null}
                  {r.details ? <span className="block text-stone-700">{r.details}</span> : null}
                  {r.response ? <span className="block text-xs text-stone-500">Answer: {r.response}</span> : null}
                </td>
                <td className="py-2 pr-4 align-top text-sm">
                  {r.visit_id ? (
                    <Link href={`/dispatch/visits/${r.visit_id}`} className="underline">
                      The visit
                    </Link>
                  ) : null}
                  {r.result_visit_id ? (
                    <Link href={`/dispatch/visits/${r.result_visit_id}`} className="underline">
                      Booked visit
                    </Link>
                  ) : null}
                  {r.kind === "booking" && r.status === "open" ? (
                    <Link href={`/agreements/new?account_id=${r.account_id}&property_id=${r.property_id}`} className="underline">
                      Start an agreement
                    </Link>
                  ) : null}
                </td>
                <td className="py-2 align-top">
                  {canAct && r.status === "open" ? (
                    <div className="grid gap-2">
                      {r.kind === "reservice" ? (
                        <form action={bookRequestedReservice} className="flex gap-2">
                          {hidden}
                          <input type="hidden" name="request_id" value={r.id} />
                          <Input name="due_start" type="date" defaultValue={today} aria-label="Due from" className="w-36" />
                          <Button type="submit">Book re-service</Button>
                        </form>
                      ) : null}
                      <form action={answerRequest} className="flex gap-2">
                        {hidden}
                        <input type="hidden" name="request_id" value={r.id} />
                        <Input name="response" placeholder="Answer for the customer" aria-label="Answer for the customer" className="w-48" />
                        <Button type="submit" name="status" value="done" variant="secondary">
                          Done
                        </Button>
                        <Button type="submit" name="status" value="declined" variant="secondary">
                          Decline
                        </Button>
                      </form>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title="Questions from the portal" description="Customers asked these in the portal and their own records did not answer them. Your answer shows in their portal.">
        {questions.length === 0 ? (
          <Empty>No questions waiting.</Empty>
        ) : (
          <ul className="grid gap-3">
            {questions.map((x) => (
              <li key={x.id} className="rounded border border-stone-200 p-3 text-sm" data-testid="portal-question">
                <p>
                  <Link href={`/customers/${x.account_id}`} className="font-medium underline">
                    {x.account_name}
                  </Link>{" "}
                  <span className="text-xs text-stone-500">{formatInstant(x.created_at, active.tenantTimezone)}</span>
                </p>
                <p className="mt-1">{x.question}</p>
                {canAct ? (
                  <form action={answerPortalQuestion} className="mt-2 grid gap-2">
                    {hidden}
                    <input type="hidden" name="question_id" value={x.id} />
                    <textarea name="office_answer" rows={2} required maxLength={4000} aria-label={`Answer for ${x.account_name}`} className="rounded border border-stone-300 px-2 py-1" />
                    <div>
                      <Button type="submit" variant="secondary">
                        Answer
                      </Button>
                    </div>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
