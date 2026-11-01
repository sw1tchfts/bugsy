import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MonthBars } from "@/components/charts";
import { MapEditor } from "@/components/map-editor";
import { MarkEditor } from "@/components/mark-editor";
import { marksFor } from "@/lib/specialty/db";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Table, Textarea, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { loadSite } from "@/lib/commercial/db";
import { ACTION_LABELS, ACTIVITY, type Action, CHECK_STATUSES, DEVICE_KINDS, KIND_LABELS, KIND_TAGS, type DeviceKind, REC_CATEGORIES, REC_PRIORITIES, ZONES, hasActivity } from "@/lib/commercial/devices";
import { addMonths, formatInstant, isIsoDate, todayInZone } from "@/lib/dates";
import { monthsBetween } from "@/lib/reports/metrics";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import {
  addDevice,
  addMark,
  addRecommendation,
  addSighting,
  archiveMap,
  placeDevice,
  recordCheck,
  removeDevice,
  removeMark,
  resolveSighting,
  updateDevice,
  updateRecommendation,
  uploadDocument,
  uploadMap,
} from "./actions";

export const metadata: Metadata = { title: "Site" };

const kindLabel = (k: string) => KIND_LABELS[k as DeviceKind] ?? k;
const tag = (d: { kind: string; number: string }) => `${KIND_TAGS[d.kind as DeviceKind] ?? "?"} ${d.number}`;

/** One commercial site (spec 14): maps, devices, checks, trend, sightings, recommendations, documents and the binder. */
export default async function SitePage({ params, searchParams }: { params: Promise<{ propertyId: string }>; searchParams: Promise<{ from?: string; to?: string; note?: string; error?: string }> }) {
  const { propertyId } = await params;
  const q = await searchParams;
  const { session, active } = await requireActiveTenant();
  if (!can(active.permissions, "customers.read") && !can(active.permissions, "visits.read")) redirect("/?error=forbidden");
  const tz = active.tenantTimezone;
  const today = todayInZone(tz);
  const to = q.to && isIsoDate(q.to) ? q.to : today;
  const from = q.from && isIsoDate(q.from) && q.from <= to ? q.from : addMonths(to, -12);
  const loaded = await dbAs(session, async (tx) => {
    const s = await loadSite(tx, active.tenantId, propertyId, tz, from, to);
    return s ? { site: s, marks: await marksFor(tx, active.tenantId, propertyId) } : null;
  });
  if (!loaded) notFound();
  const { site, marks } = loaded;
  const canWrite = !active.support || active.support.access === "write" ? can(active.permissions, "customers.write") || can(active.permissions, "dispatch.write") : false;
  const canDocs = canWrite;
  const activeDevices = site.devices.filter((d) => d.status === "active");
  const hidden = (
    <>
      <input type="hidden" name="tenant_id" value={active.tenantId} />
      <input type="hidden" name="property_id" value={propertyId} />
    </>
  );
  const months = monthsBetween(from, to);
  const kinds = [...new Set(site.trend.map((t) => t.kind))];
  const lastCheck = new Map<string, (typeof site.checks)[number]>();
  for (const c of site.checks) if (!lastCheck.has(c.device_id)) lastCheck.set(c.device_id, c);

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/sites" className="hover:underline">
          Sites
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">{site.property.account_name}</h1>
      <p className="text-sm text-stone-600">
        {site.property.address}.{" "}
        <Link href={`/customers/properties/${propertyId}`} className="underline">
          Property
        </Link>
      </p>
      {q.note ? <Notice kind="success">{q.note}</Notice> : null}
      {errorMessage(q.error) ? <Notice kind="error">{errorMessage(q.error)}</Notice> : null}

      <Card title="Audit binder" description="Everything an AIB, SQF or BRC auditor asks for, for the range: maps, devices, every check, the trend, sightings, recommendations, applications and the applicators' credentials.">
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
          <a href={`/api/sites/${propertyId}/binder.zip?from=${from}&to=${to}`} className="pb-2 text-sm text-emerald-800 underline" data-testid="binder-zip">
            Download the binder
          </a>
        </form>
      </Card>

      <section id="maps" className="grid gap-4">
        <Card title="Floor plans" description="Pick a device, tap the plan where it is, and save. Moves are kept in the device's history.">
          {site.maps.length === 0 ? (
            <Empty>No floor plan yet.</Empty>
          ) : (
            <MapEditor
              tenantId={active.tenantId}
              propertyId={propertyId}
              maps={site.maps}
              devices={activeDevices}
              hot={[...site.hot]}
              marks={marks}
              canWrite={canWrite}
              place={placeDevice}
            />
          )}
          {canWrite ? (
            <div className="mt-4 grid gap-3 border-t border-stone-200 pt-3 sm:grid-cols-2">
              <form action={uploadMap} className="grid gap-2">
                {hidden}
                <Field label="Add a floor plan (PNG, JPEG or WebP)" htmlFor="map-file">
                  <Input id="map-file" name="file" type="file" accept="image/png,image/jpeg,image/webp" required />
                </Field>
                <Field label="Name" htmlFor="map-name">
                  <Input id="map-name" name="name" placeholder="Main building, ground floor" />
                </Field>
                <div>
                  <Button type="submit" variant="secondary">
                    Upload
                  </Button>
                </div>
              </form>
              {site.maps.length ? (
                <form action={archiveMap} className="grid content-start gap-2">
                  {hidden}
                  <Field label="Archive a floor plan" htmlFor="map-archive">
                    <Select id="map-archive" name="map_id">
                      {site.maps.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div>
                    <Button type="submit" variant="secondary">
                      Archive
                    </Button>
                  </div>
                </form>
              ) : null}
            </div>
          ) : null}
        </Card>
      </section>

      {site.maps.length ? (
        <section id="marks">
          <Card title="Diagram marks" description="The termite graph: damage, evidence, treated areas, moisture and places that could not be inspected, marked on the plan with a label. Squares are marks; circles are devices.">
            <MarkEditor tenantId={active.tenantId} propertyId={propertyId} maps={site.maps} devices={activeDevices} marks={marks} canWrite={canWrite} add={addMark} remove={removeMark} />
          </Card>
        </section>
      ) : null}

      <section id="devices">
        <Card title={`Devices: ${activeDevices.length} active`}>
          {site.devices.length === 0 ? (
            <Empty>No devices yet.</Empty>
          ) : (
            <Table headers={["Device", "Kind", "Where", "Barcode", "On a map", "Last check", ""]}>
              {site.devices.map((d) => {
                const c = lastCheck.get(d.id);
                return (
                  <tr key={d.id} data-testid="site-device" data-number={d.number} className={d.status === "removed" ? "text-stone-400" : ""}>
                    <td className="py-1 pr-4 font-medium">
                      {tag(d)} {site.hot.has(d.id) ? <Badge tone="bad">! hot</Badge> : null}
                    </td>
                    <td className="py-1 pr-4">{kindLabel(d.kind)}</td>
                    <td className="py-1 pr-4">
                      {d.zone}, {d.location}
                    </td>
                    <td className="py-1 pr-4 font-mono text-xs">{d.barcode ?? ""}</td>
                    <td className="py-1 pr-4">{d.status === "removed" ? `removed ${d.removed_on}: ${d.removed_reason ?? ""}` : d.x === null ? "no" : "yes"}</td>
                    <td className="py-1 pr-4 text-xs">{c ? `${formatInstant(c.checked_at, tz)}: ${c.status}${hasActivity(c) ? ", activity" : ""}` : "none in range"}</td>
                    <td className="py-1 text-right">
                      {canWrite && d.status === "active" ? (
                        <form action={removeDevice} className="flex justify-end gap-1">
                          {hidden}
                          <input type="hidden" name="device_id" value={d.id} />
                          <Input name="reason" placeholder="Why out" aria-label={`Why ${tag(d)} came out`} className="w-28" required />
                          <Button type="submit" variant="secondary">
                            Take out
                          </Button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
          {canWrite ? (
            <div className="mt-4 grid gap-4 border-t border-stone-200 pt-3 lg:grid-cols-2">
              <form action={addDevice} className="grid gap-2 sm:grid-cols-2">
                {hidden}
                <p className="text-sm font-medium sm:col-span-2">Add a device</p>
                <Field label="Kind" htmlFor="dev-kind">
                  <Select id="dev-kind" name="kind">
                    {DEVICE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABELS[k]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Number" htmlFor="dev-number">
                  <Input id="dev-number" name="number" required maxLength={20} />
                </Field>
                <Field label="Zone" htmlFor="dev-zone">
                  <Select id="dev-zone" name="zone">
                    {ZONES.map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Barcode" htmlFor="dev-barcode">
                  <Input id="dev-barcode" name="barcode" maxLength={64} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Location" htmlFor="dev-location">
                    <Input id="dev-location" name="location" required placeholder="Dock door 3, east side" />
                  </Field>
                </div>
                <div>
                  <Button type="submit">Add device</Button>
                </div>
              </form>
              {activeDevices.length ? (
                <form action={updateDevice} className="grid gap-2 sm:grid-cols-2">
                  {hidden}
                  <p className="text-sm font-medium sm:col-span-2">Change a device</p>
                  <div className="sm:col-span-2">
                    <Field label="Device" htmlFor="upd-device">
                      <Select id="upd-device" name="device_id">
                        {activeDevices.map((d) => (
                          <option key={d.id} value={d.id}>
                            {tag(d)}: {d.location}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <Field label="Number" htmlFor="upd-number">
                    <Input id="upd-number" name="number" required />
                  </Field>
                  <Field label="Barcode" htmlFor="upd-barcode">
                    <Input id="upd-barcode" name="barcode" />
                  </Field>
                  <Field label="Zone" htmlFor="upd-zone">
                    <Select id="upd-zone" name="zone">
                      {ZONES.map((z) => (
                        <option key={z} value={z}>
                          {z}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Location" htmlFor="upd-location">
                    <Input id="upd-location" name="location" required />
                  </Field>
                  <div>
                    <Button type="submit" variant="secondary">
                      Save device
                    </Button>
                  </div>
                </form>
              ) : null}
            </div>
          ) : null}
        </Card>
      </section>

      <Card title="Activity trend" description="Share of checked devices showing activity, by month and kind. Hover a column for the month; the table has every figure.">
        {kinds.length === 0 ? (
          <Empty>No checks in this range.</Empty>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-4 lg:grid-cols-2">
              {kinds.map((k) => (
                <figure key={k}>
                  <figcaption className="text-sm font-medium">{kindLabel(k)}</figcaption>
                  <MonthBars
                    points={months.map((m) => {
                      const row = site.trend.find((t) => t.month === m && t.kind === k);
                      return { label: m, value: row?.rate ?? null, display: row ? `${Math.round((row.rate ?? 0) * 100)}% of ${row.checked} checked, ${row.captures} caught` : "no checks" };
                    })}
                    label={`${kindLabel(k)}: activity rate by month`}
                    format={(v) => `${Math.round(v * 100)}%`}
                  />
                </figure>
              ))}
            </div>
            <Table headers={["Month", "Kind", "Checked", "With activity", "Activity rate", "Caught"]}>
              {site.trend.map((t) => (
                <tr key={`${t.month}-${t.kind}`} data-testid="trend-row">
                  <td className="py-1 pr-4">{t.month}</td>
                  <td className="py-1 pr-4">{kindLabel(t.kind)}</td>
                  <td className="py-1 pr-4 tabular-nums">{t.checked}</td>
                  <td className="py-1 pr-4 tabular-nums">{t.active}</td>
                  <td className="py-1 pr-4 tabular-nums">{t.rate === null ? "no data" : `${Math.round(t.rate * 100)}%`}</td>
                  <td className="py-1 pr-4 tabular-nums">{t.captures}</td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </Card>

      <section id="checks">
        <Card title={`Checks in range: ${site.checks.length}`}>
          {site.checks.length === 0 ? (
            <Empty>No checks in this range.</Empty>
          ) : (
            <Table headers={["When", "Device", "Found", "Activity", "Caught", "Bait", "Done", "By", "Notes"]}>
              {site.checks.slice(0, 200).map((c) => (
                <tr key={c.id} data-testid="site-check" data-number={c.number}>
                  <td className="py-1 pr-4 whitespace-nowrap">{formatInstant(c.checked_at, tz)}</td>
                  <td className="py-1 pr-4">{tag(c)}</td>
                  <td className="py-1 pr-4">{c.status}</td>
                  <td className="py-1 pr-4">{c.activity ?? ""}</td>
                  <td className="py-1 pr-4 tabular-nums">{c.count ?? ""}</td>
                  <td className="py-1 pr-4 tabular-nums">{c.bait_consumed_pct === null ? "" : `${c.bait_consumed_pct}%`}</td>
                  <td className="py-1 pr-4 text-xs">{c.actions.map((a) => ACTION_LABELS[a as Action] ?? a).join(", ")}</td>
                  <td className="py-1 pr-4 text-xs">{c.checked_by_name ?? c.source}</td>
                  <td className="py-1 pr-4 text-xs">{c.notes ?? ""}</td>
                </tr>
              ))}
            </Table>
          )}
          {canWrite && activeDevices.length ? (
            <form action={recordCheck} className="mt-4 grid gap-2 border-t border-stone-200 pt-3 sm:grid-cols-4">
              {hidden}
              <p className="text-sm font-medium sm:col-span-4">Enter a check from a paper service report</p>
              <Field label="Device" htmlFor="chk-device">
                <Select id="chk-device" name="device_id">
                  {activeDevices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {tag(d)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Date" htmlFor="chk-date">
                <Input id="chk-date" name="checked_on" type="date" defaultValue={today} max={today} required />
              </Field>
              <Field label="Found" htmlFor="chk-status">
                <Select id="chk-status" name="status">
                  {CHECK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Activity" htmlFor="chk-activity">
                <Select id="chk-activity" name="activity">
                  {ACTIVITY.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Caught" htmlFor="chk-count">
                <Input id="chk-count" name="count" inputMode="numeric" />
              </Field>
              <Field label="Bait eaten (%)" htmlFor="chk-bait">
                <Input id="chk-bait" name="bait_consumed_pct" inputMode="numeric" />
              </Field>
              <Field label="Pest" htmlFor="chk-pest">
                <Input id="chk-pest" name="pest" />
              </Field>
              <Field label="Notes" htmlFor="chk-notes">
                <Input id="chk-notes" name="notes" />
              </Field>
              <div>
                <Button type="submit" variant="secondary">
                  Record check
                </Button>
              </div>
            </form>
          ) : null}
        </Card>
      </section>

      <section id="sightings">
        <Card title="Sightings" description="What the customer's staff or our people saw between visits. Open until resolved with a note.">
          {site.sightings.length === 0 ? (
            <Empty>No sightings.</Empty>
          ) : (
            <Table headers={["Seen", "Pest", "Where", "Count", "Reported by", "Resolution"]}>
              {site.sightings.map((s) => (
                <tr key={s.id} data-testid="sighting-row">
                  <td className="py-1 pr-4 whitespace-nowrap">{formatInstant(s.seen_at, tz)}</td>
                  <td className="py-1 pr-4">{s.pest}</td>
                  <td className="py-1 pr-4">{s.location}</td>
                  <td className="py-1 pr-4 tabular-nums">{s.count ?? ""}</td>
                  <td className="py-1 pr-4">
                    {s.reported_by ?? ""} ({s.source})
                  </td>
                  <td className="py-1 pr-4">
                    {s.resolved_at ? (
                      `${s.resolution} (${formatInstant(s.resolved_at, tz)})`
                    ) : canWrite ? (
                      <form action={resolveSighting} className="flex gap-1">
                        {hidden}
                        <input type="hidden" name="sighting_id" value={s.id} />
                        <Input name="resolution" placeholder="How it was handled" aria-label={`Resolution for ${s.pest} at ${s.location}`} required />
                        <Button type="submit" variant="secondary">
                          Resolve
                        </Button>
                      </form>
                    ) : (
                      "open"
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
          {canWrite ? (
            <form action={addSighting} className="mt-4 grid gap-2 border-t border-stone-200 pt-3 sm:grid-cols-3">
              {hidden}
              <p className="text-sm font-medium sm:col-span-3">Log a sighting</p>
              <Field label="Seen" htmlFor="sig-seen">
                <Input id="sig-seen" name="seen_at" type="datetime-local" required />
              </Field>
              <Field label="Pest" htmlFor="sig-pest">
                <Input id="sig-pest" name="pest" required />
              </Field>
              <Field label="Where" htmlFor="sig-location">
                <Input id="sig-location" name="location" required />
              </Field>
              <Field label="Count" htmlFor="sig-count">
                <Input id="sig-count" name="count" inputMode="numeric" />
              </Field>
              <Field label="Reported by" htmlFor="sig-by">
                <Input id="sig-by" name="reported_by" />
              </Field>
              <Field label="Source" htmlFor="sig-source">
                <Select id="sig-source" name="source" defaultValue="customer">
                  <option value="customer">customer</option>
                  <option value="office">office</option>
                  <option value="technician">technician</option>
                </Select>
              </Field>
              <div className="sm:col-span-3">
                <Field label="Notes" htmlFor="sig-notes">
                  <Textarea id="sig-notes" name="notes" rows={2} />
                </Field>
              </div>
              <div>
                <Button type="submit" variant="secondary">
                  Log sighting
                </Button>
              </div>
            </form>
          ) : null}
        </Card>
      </section>

      <section id="recommendations">
        <Card title="Recommendations and corrective actions" description="Each has an owner and may have a due date; it stays open until closed with a note.">
          {site.recommendations.length === 0 ? (
            <Empty>No recommendations.</Empty>
          ) : (
            <div className="grid gap-3">
              {site.recommendations.map((r) => (
                <div key={r.id} className="rounded border border-stone-200 p-3 text-sm" data-testid="recommendation-row" data-status={r.status}>
                  <p>
                    <span className="font-medium">{r.description}</span>{" "}
                    <Badge tone={r.status === "closed" ? "good" : r.due_on && r.due_on < today ? "bad" : "neutral"}>{r.status === "closed" ? `closed ${r.closed_on}` : r.due_on && r.due_on < today ? `overdue since ${r.due_on}` : r.status.replace("_", " ")}</Badge>
                  </p>
                  <p className="text-xs text-stone-600">
                    {r.category}, {r.priority} priority, {r.responsibility === "customer" ? "the customer acts" : "we act"}
                    {r.owner_name ? `, owner ${r.owner_name}` : ""}
                    {r.due_on ? `, due ${r.due_on}` : ""}. Raised {formatInstant(r.created_at, tz)}
                    {r.visit_id ? " at a visit" : ""}.
                  </p>
                  {r.status === "closed" ? <p className="text-xs">Closing note: {r.closed_note}</p> : null}
                  {canWrite && r.status !== "closed" ? (
                    <form action={updateRecommendation} className="mt-2 grid gap-2 sm:grid-cols-5">
                      {hidden}
                      <input type="hidden" name="recommendation_id" value={r.id} />
                      <Select name="status" defaultValue={r.status} aria-label="Status">
                        <option value="open">open</option>
                        <option value="in_progress">in progress</option>
                        <option value="closed">closed</option>
                      </Select>
                      <Input name="owner_name" defaultValue={r.owner_name ?? ""} placeholder="Owner" aria-label="Owner" />
                      <Input name="due_on" type="date" defaultValue={r.due_on ?? ""} aria-label="Due" />
                      <Input name="closed_note" placeholder="What was done (to close)" aria-label="Closing note" />
                      <Button type="submit" variant="secondary">
                        Save
                      </Button>
                    </form>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {canWrite ? (
            <form action={addRecommendation} className="mt-4 grid gap-2 border-t border-stone-200 pt-3 sm:grid-cols-3">
              {hidden}
              <p className="text-sm font-medium sm:col-span-3">Add a recommendation</p>
              <div className="sm:col-span-3">
                <Field label="What should be done" htmlFor="rec-desc">
                  <Textarea id="rec-desc" name="description" rows={2} required />
                </Field>
              </div>
              <Field label="Category" htmlFor="rec-cat">
                <Select id="rec-cat" name="category">
                  {REC_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Priority" htmlFor="rec-pri">
                <Select id="rec-pri" name="priority" defaultValue="medium">
                  {REC_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Who acts" htmlFor="rec-resp">
                <Select id="rec-resp" name="responsibility">
                  <option value="customer">the customer</option>
                  <option value="company">us</option>
                </Select>
              </Field>
              <Field label="Owner" htmlFor="rec-owner">
                <Input id="rec-owner" name="owner_name" placeholder="Their kitchen manager, for example" />
              </Field>
              <Field label="Due" htmlFor="rec-due">
                <Input id="rec-due" name="due_on" type="date" />
              </Field>
              {site.sightings.some((s) => !s.resolved_at) ? (
                <Field label="From a sighting" htmlFor="rec-sighting">
                  <Select id="rec-sighting" name="sighting_id" defaultValue="">
                    <option value="">none</option>
                    {site.sightings
                      .filter((s) => !s.resolved_at)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.pest}, {s.location}
                        </option>
                      ))}
                  </Select>
                </Field>
              ) : null}
              <div>
                <Button type="submit" variant="secondary">
                  Add recommendation
                </Button>
              </div>
            </form>
          ) : null}
        </Card>
      </section>

      <section id="documents">
        <Card title="Site documents" description="The pest program, certificates of insurance, licenses, labels and safety data sheets the customer's auditor asks for.">
          {site.documents.length === 0 ? (
            <Empty>No documents.</Empty>
          ) : (
            <Table headers={["Title", "Kind", "Valid until", ""]}>
              {site.documents.map((d) => (
                <tr key={d.id} data-testid="site-document">
                  <td className="py-1 pr-4">{d.title}</td>
                  <td className="py-1 pr-4">{d.kind}</td>
                  <td className="py-1 pr-4">{d.valid_until ?? ""}</td>
                  <td className="py-1 text-right">
                    <a href={`/api/files/${d.file_id}`} className="text-sm underline">
                      Open
                    </a>
                  </td>
                </tr>
              ))}
            </Table>
          )}
          {canDocs ? (
            <form action={uploadDocument} className="mt-4 grid gap-2 border-t border-stone-200 pt-3 sm:grid-cols-4">
              {hidden}
              <Field label="Title" htmlFor="doc-title">
                <Input id="doc-title" name="title" required />
              </Field>
              <Field label="Kind" htmlFor="doc-kind">
                <Select id="doc-kind" name="kind">
                  {["program", "insurance", "license", "map", "label", "sds", "report", "other"].map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Valid until" htmlFor="doc-valid">
                <Input id="doc-valid" name="valid_until" type="date" />
              </Field>
              <Field label="File" htmlFor="doc-file">
                <Input id="doc-file" name="file" type="file" required />
              </Field>
              <div>
                <Button type="submit" variant="secondary">
                  Add document
                </Button>
              </div>
            </form>
          ) : null}
        </Card>
      </section>

      <Card title="Device history in range" description="Every install, move, relabel and removal, with who and when.">
        {site.events.length === 0 ? (
          <Empty>No changes in this range.</Empty>
        ) : (
          <Table headers={["When", "Device", "Change", "Now", "By"]}>
            {site.events.map((e) => (
              <tr key={e.id} data-testid="device-event">
                <td className="py-1 pr-4 whitespace-nowrap">{formatInstant(e.at, tz)}</td>
                <td className="py-1 pr-4">{e.number}</td>
                <td className="py-1 pr-4">
                  {e.kind}
                  {e.visit_id ? " (at a visit)" : ""}
                </td>
                <td className="py-1 pr-4 text-xs">{e.after ? `${String(e.after.zone ?? "")}, ${String(e.after.location ?? "")}${e.after.x !== null && e.after.x !== undefined ? ", on the map" : ""}` : ""}</td>
                <td className="py-1 pr-4">{e.by_name ?? ""}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
