import type { Metadata } from "next";
import { headers } from "next/headers";
import { Badge, Button, Card, Empty, Field, Input, Notice, Textarea, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { createLeadForm, savePortalSettings, toggleLeadForm } from "./actions";

export const metadata: Metadata = { title: "Portal settings" };

/** The customer portal's rules and the booking forms for the company's website (spec 16). */
export default async function PortalSettingsPage({ searchParams }: { searchParams: Promise<{ note?: string; error?: string }> }) {
  const q = await searchParams;
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "customers.read");
  const canWrite = can(active.permissions, "settings.write");
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const data = await dbAs(session, async (tx) => {
    const [settings] = await tx<{ allow_reschedule: boolean; reschedule_notice_hours: number; max_stops_per_day: number; allow_requests: boolean; requestable_service_type_ids: string[] }[]>`
      select allow_reschedule, reschedule_notice_hours, max_stops_per_day, allow_requests, requestable_service_type_ids from public.portal_settings where tenant_id = ${active.tenantId}`;
    const types = await tx<{ id: string; name: string }[]>`select id, name from public.service_types where tenant_id = ${active.tenantId} and archived_at is null and active order by name`;
    const forms = await tx<{ id: string; key: string; name: string; service_type_ids: string[]; ask_preferred_date: boolean; active: boolean; leads: number }[]>`
      select f.id, f.key, f.name, f.service_type_ids, f.ask_preferred_date, f.active, (select count(*)::int from public.leads l where l.form_id = f.id) as leads
      from public.lead_forms f where f.tenant_id = ${active.tenantId} order by f.created_at`;
    return { settings, types, forms };
  });
  const s = data.settings ?? { allow_reschedule: true, reschedule_notice_hours: 24, max_stops_per_day: 18, allow_requests: true, requestable_service_type_ids: [] };
  const hidden = <input type="hidden" name="tenant_id" value={active.tenantId} />;
  return (
    <>
      <h1 className="text-2xl font-semibold">Customer portal</h1>
      {q.note ? <Notice kind="success">{q.note}</Notice> : null}
      {errorMessage(q.error) ? <Notice kind="error">{errorMessage(q.error)}</Notice> : null}
      <Card title="Rules" description="What customers may do themselves. Invite customers from their account page.">
        <form action={savePortalSettings} className="grid gap-4 sm:grid-cols-2">
          {hidden}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="allow_reschedule" defaultChecked={s.allow_reschedule} disabled={!canWrite} /> Customers may move a scheduled visit within its window
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="allow_requests" defaultChecked={s.allow_requests} disabled={!canWrite} /> Customers may ask for re-services and bookings
          </label>
          <Field label="Notice for a move (hours)" htmlFor="notice">
            <Input id="notice" name="reschedule_notice_hours" type="number" min={0} max={336} defaultValue={s.reschedule_notice_hours} disabled={!canWrite} />
          </Field>
          <Field label="Most stops a technician takes in a day" htmlFor="stops">
            <Input id="stops" name="max_stops_per_day" type="number" min={1} max={60} defaultValue={s.max_stops_per_day} disabled={!canWrite} />
          </Field>
          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-medium text-stone-700">Services customers may ask to book</legend>
            <div className="mt-1 flex flex-wrap gap-4 text-sm">
              {data.types.map((t) => (
                <label key={t.id} className="flex items-center gap-2">
                  <input type="checkbox" name="requestable" value={t.id} defaultChecked={s.requestable_service_type_ids.includes(t.id)} disabled={!canWrite} /> {t.name}
                </label>
              ))}
            </div>
          </fieldset>
          {canWrite ? (
            <div className="sm:col-span-2">
              <Button type="submit">Save rules</Button>
            </div>
          ) : null}
        </form>
      </Card>
      <Card title="Booking forms" description="Put a form on your website: prospects pick a service and a day, and each one lands in Leads.">
        {data.forms.length === 0 ? (
          <Empty>No forms yet.</Empty>
        ) : (
          <ul className="grid gap-4">
            {data.forms.map((f) => (
              <li key={f.id} className="grid gap-2 border-b border-stone-100 pb-3" data-testid="lead-form">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{f.name}</span>
                  <Badge tone={f.active ? "good" : "neutral"}>{f.active ? "taking requests" : "off"}</Badge>
                  <span className="text-sm text-stone-600">{f.leads} lead(s)</span>
                  <a href={`/f/${f.key}`} className="text-sm text-emerald-800 underline" data-testid="lead-form-link">
                    Open the form
                  </a>
                  {canWrite ? (
                    <form action={toggleLeadForm} className="ml-auto">
                      {hidden}
                      <input type="hidden" name="form_id" value={f.id} />
                      <Button type="submit" variant="secondary">
                        {f.active ? "Turn off" : "Turn on"}
                      </Button>
                    </form>
                  ) : null}
                </div>
                <label className="grid gap-1 text-xs text-stone-600">
                  Embed on your website
                  <textarea readOnly rows={2} className="rounded border border-stone-300 bg-stone-50 p-2 font-mono text-xs" value={`<iframe src="${origin}/f/${f.key}" title="${f.name.replace(/"/g, "")}" style="width:100%;min-height:720px;border:0"></iframe>`} />
                </label>
                <p className="text-xs text-stone-600">
                  Or post JSON to <code className="font-mono">{`${origin}/api/intake/${f.key}`}</code> with name, email or phone, line1, city, state_code, postal_code, service_type_id, preferred_date, arrival_window and message.
                </p>
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <form action={createLeadForm} className="mt-4 grid gap-3 border-t border-stone-100 pt-3 sm:grid-cols-2">
            {hidden}
            <Field label="Form name" htmlFor="form-name">
              <Input id="form-name" name="name" required maxLength={100} placeholder="Book a visit" />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" name="ask_preferred_date" defaultChecked /> Ask for a preferred day
            </label>
            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-medium text-stone-700">Services on the form</legend>
              <div className="mt-1 flex flex-wrap gap-4 text-sm">
                {data.types.map((t) => (
                  <label key={t.id} className="flex items-center gap-2">
                    <input type="checkbox" name="service_type_ids" value={t.id} /> {t.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Thank-you message" htmlFor="thanks">
              <Textarea id="thanks" name="thank_you" rows={2} maxLength={500} placeholder="Thank you. We will call you to confirm a day." />
            </Field>
            <div className="self-end">
              <Button type="submit">Create form</Button>
            </div>
          </form>
        ) : null}
      </Card>
    </>
  );
}
