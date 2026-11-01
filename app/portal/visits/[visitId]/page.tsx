import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  Field,
  Notice,
  Select,
  errorMessage,
} from "@/components/ui";
import {
  ARRIVAL_WINDOW_LABELS,
  type ArrivalWindow,
} from "@/lib/dispatch/checks";
import { formatBusinessDate, formatInstant } from "@/lib/dates";
import { portalSettings, visitDetail } from "@/lib/portal/db";
import { rescheduleDays } from "@/lib/portal/rules";
import { portalDb, requirePortal } from "@/lib/portal/session";
import { requestReschedule, rescheduleVisit } from "../../actions";

export const metadata: Metadata = { title: "Visit" };

/** One visit (spec 16): when, what was applied and where, and moving it to another day within the company's rules. */
export default async function PortalVisit({
  params,
  searchParams,
}: {
  params: Promise<{ visitId: string }>;
  searchParams: Promise<{ note?: string; error?: string; ask?: string }>;
}) {
  const { visitId } = await params;
  const q = await searchParams;
  const { session, identity } = await requirePortal();
  const data = await portalDb(session, identity, async (tx) => {
    const visit = await visitDetail(tx, identity, visitId);
    if (!visit) return null;
    const settings = await portalSettings(tx, identity.tenant_id);
    return { visit, settings };
  });
  if (!data) notFound();
  const { visit, settings } = data;
  const tz = identity.tenant_timezone;
  const r = visit.record;
  // The days offered are the window's days the office's notice rule allows; capacity and the dispatch check run on save.
  const days =
    visit.status === "scheduled" && settings.allow_reschedule
      ? rescheduleDays({
          visit,
          settings,
          stops: {},
          now: new Date(),
          timeZone: tz,
        }).filter(
          (d) =>
            !d.problems.some(
              (p) => p.includes("notice") || p.includes("Pick a day"),
            ),
        )
      : [];
  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/portal" className="hover:underline">
          Home
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">
        {visit.service}
        {visit.step_label ? `: ${visit.step_label}` : ""}
      </h1>
      <p className="text-sm text-stone-600">
        {visit.address}.{" "}
        {visit.status === "completed" && visit.completed_at
          ? `Done ${formatInstant(visit.completed_at, tz)}${visit.technician ? ` by ${visit.technician}` : ""}.`
          : visit.scheduled_for
            ? `Scheduled ${formatBusinessDate(visit.scheduled_for)}${visit.arrival_window !== "any" ? `, ${ARRIVAL_WINDOW_LABELS[visit.arrival_window as ArrivalWindow].toLowerCase()}` : ""}.`
            : `Due between ${formatBusinessDate(visit.due_start)} and ${formatBusinessDate(visit.due_end)}; the office will give it a day.`}
      </p>
      {q.note ? <Notice kind="success">{q.note}</Notice> : null}
      {q.error ? <Notice kind="error">{errorMessage(q.error)}</Notice> : null}

      {visit.status === "scheduled" && settings.allow_reschedule ? (
        <Card
          title="Need another day?"
          description={`Pick a day in this visit's window. Moves need ${settings.reschedule_notice_hours} hours notice.`}
        >
          {days.length === 0 ? (
            <p className="text-sm text-stone-600">
              No other day in this visit&apos;s window can be picked here. Send
              a request and the office will help.
            </p>
          ) : (
            <form
              action={rescheduleVisit}
              className="flex flex-wrap items-end gap-3"
            >
              <input type="hidden" name="visit_id" value={visit.id} />
              <Field label="New day" htmlFor="date">
                <Select
                  id="date"
                  name="date"
                  defaultValue={q.ask ?? days[0]?.date}
                >
                  {days.map((d) => (
                    <option key={d.date} value={d.date}>
                      {formatBusinessDate(d.date)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit">Move my visit</Button>
            </form>
          )}
          {settings.allow_requests ? (
            <form
              action={requestReschedule}
              className="mt-4 flex flex-wrap items-end gap-3 border-t border-stone-100 pt-3"
            >
              <input type="hidden" name="visit_id" value={visit.id} />
              <Field label="Or ask the office for a day" htmlFor="ask_date">
                <input
                  id="ask_date"
                  name="date"
                  type="date"
                  required
                  defaultValue={q.ask ?? ""}
                  className="rounded-md border border-stone-300 px-3 py-2 text-sm"
                />
              </Field>
              <Button type="submit" variant="secondary">
                Send request
              </Button>
            </form>
          ) : null}
        </Card>
      ) : null}

      {r ? (
        <Card
          title="What was done"
          description="From the application record kept for your state."
        >
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-stone-500">Areas treated</dt>
            <dd>{r.areas_treated.join(", ") || "none recorded"}</dd>
            <dt className="text-stone-500">Pests</dt>
            <dd>{r.target_pests.join(", ") || "none recorded"}</dd>
          </dl>
          {r.products.length ? (
            <ul className="mt-3 grid gap-2" data-testid="portal-products">
              {r.products.map((p, i) => (
                <li
                  key={i}
                  className="rounded border border-stone-200 p-2 text-sm"
                >
                  <span className="font-medium">{p.product_name}</span>{" "}
                  <span className="font-mono text-xs text-stone-500">
                    EPA {p.epa_reg_no}
                  </span>
                  <span className="block">
                    {p.amount} {p.amount_unit.replace(/_/g, " ")},{" "}
                    {p.site_treated}
                    {p.location_description
                      ? ` (${p.location_description})`
                      : ""}
                    ; for {p.target_pests.join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-stone-600">
              No products were applied.
            </p>
          )}
          {r.notes.filter((n) => n.kind === "recommendation").length ? (
            <div className="mt-3 text-sm">
              <p className="font-medium">Recommendations</p>
              <ul className="list-disc pl-5">
                {r.notes
                  .filter((n) => n.kind === "recommendation")
                  .map((n, i) => (
                    <li key={i}>{n.content}</li>
                  ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : visit.status === "completed" ? (
        <Card title="What was done">
          <p className="text-sm text-stone-600">
            The record for this visit is being finished.
          </p>
        </Card>
      ) : null}
      <p className="text-xs text-stone-500">
        Status: <Badge>{visit.status.replace(/_/g, " ")}</Badge>
      </p>
    </>
  );
}
