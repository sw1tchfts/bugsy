import type { Metadata } from "next";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Table, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { addDays, fromTenantLocal, isIsoDate, todayInZone } from "@/lib/dates";
import { entriesBetween, longOpen, openEntry, refusedClockChanges } from "@/lib/payroll/db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { addAction, clockAction, correctAction } from "./actions";

export const metadata: Metadata = { title: "Time" };

function wall(d: Date | null, tz: string): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

const hours = (a: Date, b: Date | null) => (b ? Math.round(((b.getTime() - a.getTime()) / 3_600_000) * 100) / 100 : null);

/** The time clock in the office (spec 18 rules 6 and 7): my clock, and for payroll the team's time with corrections. */
export default async function Time({ searchParams }: { searchParams: Promise<{ note?: string; error?: string; from?: string; to?: string }> }) {
  const q = await searchParams;
  const { session, active } = await requireActiveTenant();
  const tz = active.tenantTimezone;
  const today = todayInZone(tz);
  const to = q.to && isIsoDate(q.to) ? q.to : today;
  const from = q.from && isIsoDate(q.from) && q.from <= to ? q.from : addDays(to, -13);
  const team = can(active.permissions, "payroll.read");
  const write = can(active.permissions, "payroll.write");
  const data = await dbAs(session, async (tx) => {
    const mine = await openEntry(tx, active.tenantId, session.userId);
    const entries = await entriesBetween(tx, active.tenantId, fromTenantLocal(`${from}T00:00`, tz) as Date, fromTenantLocal(`${addDays(to, 1)}T00:00`, tz) as Date, team ? null : session.userId);
    const stale = team ? await longOpen(tx, active.tenantId, new Date()) : [];
    const refused = team ? await refusedClockChanges(tx, active.tenantId) : [];
    const people = write ? await tx<{ user_id: string; name: string | null }[]>`select user_id, display_name as name from public.memberships where tenant_id = ${active.tenantId} order by 2` : [];
    return { mine, entries, stale, people, refused };
  });
  const hidden = <input type="hidden" name="tenant_id" value={active.tenantId} />;
  const at = (d: Date) => d.toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <>
      <h1 className="text-2xl font-semibold">Time</h1>
      {q.note ? <Notice kind="success">{q.note}</Notice> : null}
      {errorMessage(q.error) ? <Notice kind="error">{errorMessage(q.error)}</Notice> : null}
      <Card title="My clock">
        <form action={clockAction} className="flex flex-wrap items-center gap-3">
          {hidden}
          <input type="hidden" name="direction" value={data.mine ? "out" : "in"} />
          <span className="text-sm" data-testid="my-clock">
            {data.mine ? `Clocked in since ${at(data.mine.started_at)}` : "Not clocked in"}
          </span>
          <Button type="submit">{data.mine ? "Clock out" : "Clock in"}</Button>
        </form>
      </Card>
      {data.stale.length ? (
        <Notice kind="error">
          Left open more than 16 hours: {data.stale.map((e) => `${e.name ?? "Member"} since ${at(e.started_at)}`).join("; ")}. Close each with a reason below.
        </Notice>
      ) : null}
      {data.refused.length ? (
        <Card title="Clock changes refused" description="Sent from a phone and not saved: add the time by hand, with its reason, in the right period.">
          <ul className="grid gap-1 text-sm" data-testid="refused-clock">
            {data.refused.map((r) => (
              <li key={r.id}>
                {r.name}, {at(r.applied_at)}: {r.error}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card title={team ? "Team time" : "My time"} description={`${from} to ${to}`}>
        <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
          <Field label="From" htmlFor="from">
            <Input id="from" name="from" type="date" defaultValue={from} />
          </Field>
          <Field label="To" htmlFor="to">
            <Input id="to" name="to" type="date" defaultValue={to} />
          </Field>
          <Button type="submit" variant="secondary">
            Show
          </Button>
        </form>
        {data.entries.length === 0 ? (
          <Empty>No time in these days.</Empty>
        ) : (
          <Table headers={team ? ["Person", "In", "Out", "Hours", "", write ? "Correct" : ""] : ["In", "Out", "Hours", ""]}>
            {data.entries.map((e) => (
              <tr key={e.id} data-testid="time-row">
                {team ? <td className="py-2 pr-4 text-sm">{e.name ?? "Member"}</td> : null}
                <td className="py-2 pr-4 text-sm">{at(e.started_at)}</td>
                <td className="py-2 pr-4 text-sm">{e.ended_at ? at(e.ended_at) : <Badge tone="warn">open</Badge>}</td>
                <td className="py-2 pr-4 text-sm tabular-nums">{hours(e.started_at, e.ended_at) ?? ""}</td>
                <td className="py-2 pr-4 text-xs text-stone-600">
                  {e.source === "app" ? "phone" : "office"}
                  {e.edit_reason ? `; corrected: ${e.edit_reason}` : ""}
                  {e.pay_period_id ? "; exported" : ""}
                </td>
                {team && write ? (
                  <td className="py-2 pr-4">
                    {e.pay_period_id ? null : (
                      <form action={correctAction} className="flex flex-wrap items-end gap-1">
                        {hidden}
                        <input type="hidden" name="entry_id" value={e.id} />
                        <input name="started_at" type="datetime-local" defaultValue={wall(e.started_at, tz)} aria-label="In" className="rounded border border-stone-300 px-1 text-xs" />
                        <input name="ended_at" type="datetime-local" defaultValue={wall(e.ended_at, tz)} aria-label="Out" className="rounded border border-stone-300 px-1 text-xs" />
                        <input name="reason" required placeholder="Reason" aria-label="Reason" className="w-28 rounded border border-stone-300 px-1 text-xs" />
                        <button type="submit" className="rounded border border-stone-300 bg-white px-2 text-xs">
                          Save
                        </button>
                      </form>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {write ? (
        <Card title="Add time" description="For a shift no one clocked; the reason stays with the entry.">
          <form action={addAction} className="grid gap-3 sm:grid-cols-5">
            {hidden}
            <Field label="Person" htmlFor="a-user">
              <Select id="a-user" name="user_id">
                {data.people.map((p) => (
                  <option key={p.user_id} value={p.user_id}>
                    {p.name ?? "Member"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="In" htmlFor="a-start">
              <Input id="a-start" name="started_at" type="datetime-local" required />
            </Field>
            <Field label="Out" htmlFor="a-end">
              <Input id="a-end" name="ended_at" type="datetime-local" required />
            </Field>
            <Field label="Reason" htmlFor="a-reason">
              <Input id="a-reason" name="reason" required />
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="secondary">
                Add
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
