import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteMap } from "@/components/site-map";
import { Badge, Button, Card, Empty, Field, Input, Notice, Table, Textarea, errorMessage } from "@/components/ui";
import { loadSite } from "@/lib/commercial/db";
import { KIND_LABELS, type DeviceKind } from "@/lib/commercial/devices";
import { addMonths, formatBusinessDate, formatInstantDate, isIsoDate, todayInZone } from "@/lib/dates";
import { marksFor } from "@/lib/specialty/db";
import { staffNames } from "@/lib/portal/db";
import { portalDb, requirePortal } from "@/lib/portal/session";
import { addSighting } from "../../actions";

export const metadata: Metadata = { title: "Site" };

/** A commercial customer's site (spec 16 rule 6): maps, activity, recommendations, sightings, documents, the binder. */
export default async function PortalSite({ params, searchParams }: { params: Promise<{ propertyId: string }>; searchParams: Promise<{ note?: string; error?: string; from?: string; to?: string }> }) {
  const { propertyId } = await params;
  const q = await searchParams;
  const { session, identity } = await requirePortal();
  const tz = identity.tenant_timezone;
  const today = todayInZone(tz);
  const to = q.to && isIsoDate(q.to) ? q.to : today;
  const from = q.from && isIsoDate(q.from) && q.from <= to ? q.from : addMonths(to, -3);
  const data = await portalDb(session, identity, async (tx) => {
    const site = await loadSite(tx, identity.tenant_id, propertyId, tz, from, to, await staffNames(tx, identity.tenant_id));
    return site ? { site, marks: await marksFor(tx, identity.tenant_id, propertyId) } : null;
  });
  if (!data) notFound();
  const { site, marks } = data;
  const active = site.devices.filter((d) => d.status === "active");
  const openRecs = site.recommendations.filter((r) => r.status !== "closed");
  const openSightings = site.sightings.filter((s) => !s.resolved_at);
  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/portal" className="hover:underline">
          Home
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">{site.property.address}</h1>
      {q.note ? <Notice kind="success">{q.note}</Notice> : null}
      {q.error ? <Notice kind="error">{errorMessage(q.error)}</Notice> : null}

      <Card title="Audit binder" description="Maps, devices, every check, the trend, sightings, recommendations, applications and the applicators' credentials for the range.">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <Field label="From" htmlFor="from">
            <Input id="from" name="from" type="date" defaultValue={from} />
          </Field>
          <Field label="To" htmlFor="to">
            <Input id="to" name="to" type="date" defaultValue={to} />
          </Field>
          <Button type="submit" variant="secondary">
            Show this range
          </Button>
          <a href={`/api/portal/sites/${propertyId}/binder.zip?from=${from}&to=${to}`} className="pb-2 text-sm text-emerald-800 underline" data-testid="portal-binder">
            Download the binder
          </a>
        </form>
      </Card>

      {site.maps.map((m) => (
        <Card key={m.id} title={m.name}>
          <SiteMap
            src={`/api/portal/files/${m.file_id}`}
            name={m.name}
            width={m.width}
            height={m.height}
            devices={active.filter((d) => d.map_id === m.id).map((d) => ({ ...d, hot: site.hot.has(d.id) }))}
            marks={marks.filter((x) => x.map_id === m.id)}
            testid="portal-site-map"
          />
        </Card>
      ))}

      <Card title={`Activity, ${formatBusinessDate(from)} to ${formatBusinessDate(to)}`} description="Per month and device kind: devices checked, devices with activity, and captures.">
        {site.trend.length === 0 ? (
          <Empty>No checks in this range.</Empty>
        ) : (
          <Table headers={["Month", "Kind", "Checked", "With activity", "Captures"]}>
            {site.trend.map((t) => (
              <tr key={`${t.month}|${t.kind}`}>
                <td className="py-1 pr-4">{t.month}</td>
                <td className="py-1 pr-4">{KIND_LABELS[t.kind as DeviceKind] ?? t.kind}</td>
                <td className="py-1 pr-4 tabular-nums">{t.checked}</td>
                <td className="py-1 pr-4 tabular-nums">{t.active}</td>
                <td className="py-1 pr-4 tabular-nums">{t.captures}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Open recommendations" description="What should be done, by whom and by when.">
        {openRecs.length === 0 ? (
          <Empty>None open.</Empty>
        ) : (
          <ul className="grid gap-2 text-sm">
            {openRecs.map((r) => (
              <li key={r.id} data-testid="portal-recommendation">
                <span className="font-medium">{r.description}</span>{" "}
                <Badge tone={r.priority === "high" ? "bad" : "neutral"}>{r.priority}</Badge>
                <span className="block text-xs text-stone-600">
                  {r.responsibility === "customer" ? `For you${r.owner_name ? ` (${r.owner_name})` : ""}` : "For us"}
                  {r.due_on ? `, due ${formatBusinessDate(r.due_on)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Sightings" description="Seen something? Log it here and the technician will look at the next visit.">
        {openSightings.length ? (
          <ul className="mb-4 grid gap-1 text-sm">
            {openSightings.map((s) => (
              <li key={s.id} data-testid="portal-sighting">
                {s.pest} at {s.location}, {formatInstantDate(s.seen_at, identity.tenant_timezone)}
              </li>
            ))}
          </ul>
        ) : null}
        <form action={addSighting} className="grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="property_id" value={propertyId} />
          <Field label="What did you see?" htmlFor="sg-pest">
            <Input id="sg-pest" name="pest" required maxLength={100} placeholder="Mouse droppings" />
          </Field>
          <Field label="Where?" htmlFor="sg-location">
            <Input id="sg-location" name="location" required maxLength={200} placeholder="Dry storage, back corner" />
          </Field>
          <Field label="How many (optional)" htmlFor="sg-count">
            <Input id="sg-count" name="count" inputMode="numeric" />
          </Field>
          <Field label="Notes" htmlFor="sg-notes">
            <Textarea id="sg-notes" name="notes" rows={2} maxLength={1000} />
          </Field>
          <div className="self-end">
            <Button type="submit">Log sighting</Button>
          </div>
        </form>
      </Card>

      <Card title="Documents">
        {site.documents.length === 0 ? (
          <Empty>No documents shared.</Empty>
        ) : (
          <ul className="grid gap-1 text-sm">
            {site.documents.map((d) => (
              <li key={d.id}>
                <a href={`/api/portal/files/${d.file_id}`} className="underline">
                  {d.title}
                </a>
                {d.valid_until ? <span className="text-stone-600"> (valid until {formatBusinessDate(d.valid_until)})</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
