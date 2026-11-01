import type { Metadata } from "next";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Table, Textarea, errorMessage } from "@/components/ui";
import { ARRIVAL_WINDOWS, ARRIVAL_WINDOW_LABELS } from "@/lib/dispatch/checks";
import { formatBusinessDate, formatInstantDate, todayInZone } from "@/lib/dates";
import { overview } from "@/lib/portal/db";
import { portalDb, requirePortal } from "@/lib/portal/session";
import { requestBooking, requestReservice } from "../actions";

export const metadata: Metadata = { title: "Requests" };

const KIND: Record<string, string> = { reservice: "Re-service", booking: "Booking", reschedule: "New day" };

/** Re-service and booking requests (spec 16 rule 4), and the office's answers. */
export default async function PortalRequests({ searchParams }: { searchParams: Promise<{ note?: string; error?: string }> }) {
  const q = await searchParams;
  const { session, identity } = await requirePortal();
  const data = await portalDb(session, identity, (tx) => overview(tx, identity));
  const withPlan = data.properties.filter((p) => p.agreement_id);
  const tz = identity.tenant_timezone;
  const propertyLabel = (id: string) => {
    const p = data.properties.find((x) => x.id === id);
    return p ? (p.name ?? p.address) : "";
  };
  return (
    <>
      <h1 className="text-2xl font-semibold">Requests</h1>
      {q.note ? <Notice kind="success">{q.note}</Notice> : null}
      {q.error ? <Notice kind="error">{errorMessage(q.error)}</Notice> : null}
      {!data.settings.allow_requests ? <Notice kind="info">Call the office to ask for a visit.</Notice> : null}
      {data.settings.allow_requests && withPlan.length ? (
        <Card title="Pests are back" description="Re-services between visits are part of your plan. Tell us what you see and where; the office books the visit.">
          <form action={requestReservice} className="grid gap-3">
            {withPlan.length > 1 ? (
              <Field label="Property" htmlFor="rs-property">
                <Select id="rs-property" name="property_id">
                  {withPlan.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name ?? p.address}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <input type="hidden" name="property_id" value={withPlan[0].id} />
            )}
            <Field label="What are you seeing, and where?" htmlFor="rs-details">
              <Textarea id="rs-details" name="details" rows={3} required maxLength={2000} />
            </Field>
            <div>
              <Button type="submit">Ask for a re-service</Button>
            </div>
          </form>
        </Card>
      ) : null}
      {data.settings.allow_requests && data.settings.requestable.length ? (
        <Card title="Book another service" description="Pick a service and a day that suits you; the office confirms the day.">
          <form action={requestBooking} className="grid gap-3 sm:grid-cols-2">
            <Field label="Service" htmlFor="bk-service">
              <Select id="bk-service" name="service_type_id">
                {data.settings.requestable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            {data.properties.length > 1 ? (
              <Field label="Property" htmlFor="bk-property">
                <Select id="bk-property" name="property_id">
                  {data.properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name ?? p.address}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <input type="hidden" name="property_id" value={data.properties[0]?.id ?? ""} />
            )}
            <Field label="Preferred day" htmlFor="bk-date">
              <Input id="bk-date" name="preferred_date" type="date" min={todayInZone(tz)} />
            </Field>
            <Field label="Time of day" htmlFor="bk-window">
              <Select id="bk-window" name="arrival_window" defaultValue="any">
                {ARRIVAL_WINDOWS.map((w) => (
                  <option key={w} value={w}>
                    {ARRIVAL_WINDOW_LABELS[w]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Anything we should know" htmlFor="bk-details">
              <Textarea id="bk-details" name="details" rows={2} maxLength={2000} />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit">Ask to book</Button>
            </div>
          </form>
        </Card>
      ) : null}
      <Card title="Your requests">
        {data.requests.length === 0 ? (
          <Empty>No requests yet.</Empty>
        ) : (
          <Table headers={["Sent", "What", "Where", "Status", "Answer"]}>
            {data.requests.map((r) => (
              <tr key={r.id} data-testid="portal-request">
                <td className="py-2 pr-4">{formatInstantDate(r.created_at, tz)}</td>
                <td className="py-2 pr-4">
                  {KIND[r.kind] ?? r.kind}
                  {r.service ? `: ${r.service}` : ""}
                  {r.preferred_date ? <span className="block text-xs text-stone-500">wanted {formatBusinessDate(r.preferred_date)}</span> : null}
                  {r.details ? <span className="block text-xs text-stone-500">{r.details}</span> : null}
                </td>
                <td className="py-2 pr-4">{propertyLabel(r.property_id)}</td>
                <td className="py-2 pr-4">
                  <Badge tone={r.status === "open" ? "warn" : r.status === "done" ? "good" : "bad"}>{r.status === "open" ? "with the office" : r.status}</Badge>
                </td>
                <td className="py-2 pr-4 text-sm">{r.response ?? ""}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
