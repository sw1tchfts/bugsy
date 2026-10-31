import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Table, Textarea, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import {
  JOB_KINDS,
  JOB_KIND_LABELS,
  PRICING_METHODS,
  PRICING_METHOD_LABELS,
  SERVICE_LINES,
  SERVICE_LINE_LABELS,
  SERVICE_TYPE_TEMPLATES,
  type ServiceLine,
  TREATMENT_AREAS,
  TREATMENT_AREA_LABELS,
} from "@/lib/catalog/service-lines";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { createServiceType } from "./actions";

export const metadata: Metadata = { title: "Service types" };

type Row = {
  id: string;
  name: string;
  service_line: ServiceLine;
  job_kind: keyof typeof JOB_KIND_LABELS;
  treatment_areas: string[];
  pricing_method: keyof typeof PRICING_METHOD_LABELS;
  default_duration_minutes: number;
  active: boolean;
  archived_at: string | null;
  items: number;
  states: string | null;
  states_without_pack: number;
};

export default async function ServiceTypesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  const { error } = await searchParams;
  const tenantId = active.tenantId;
  const canWrite = can(active.permissions, "catalog.write");

  const rows = await dbAs(session, (tx) =>
    tx<Row[]>`
      select st.id, st.name, st.service_line, st.job_kind, st.treatment_areas, st.pricing_method, st.default_duration_minutes, st.active, st.archived_at,
             (select count(*)::int from public.price_book_items p where p.service_type_id = st.id and p.archived_at is null) as items,
             (select string_agg(r.state_code, ', ' order by r.state_code) from public.service_type_state_rules r where r.service_type_id = st.id) as states,
             (select count(*)::int from public.service_type_state_rules r where r.service_type_id = st.id and r.pack_version is null) as states_without_pack
      from public.service_types st
      where st.tenant_id = ${tenantId}
      order by st.archived_at nulls first, st.service_line, st.name`,
  );

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Service types</h1>
        <p className="mt-1 text-sm text-stone-600">
          What you sell. Each one carries its service line, job kind and treatment areas, and per state the certification categories and tax class the work needs there.
        </p>
      </div>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      <Card title="Your service types">
        {rows.length === 0 ? (
          <Empty>No service types yet. Start from a template below.</Empty>
        ) : (
          <Table headers={["Name", "Service line", "Job kind", "Areas", "Pricing", "States", "Price book", ""]}>
            {rows.map((r) => (
              <tr key={r.id} className={r.archived_at ? "text-stone-400" : ""}>
                <td className="py-2 pr-4 font-medium">
                  <Link href={`/catalog/service-types/${r.id}`} className="hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className="py-2 pr-4">{SERVICE_LINE_LABELS[r.service_line]}</td>
                <td className="py-2 pr-4">{JOB_KIND_LABELS[r.job_kind]}</td>
                <td className="py-2 pr-4">{r.treatment_areas.length ? r.treatment_areas.join(", ") : "none"}</td>
                <td className="py-2 pr-4">{PRICING_METHOD_LABELS[r.pricing_method]}</td>
                <td className="py-2 pr-4">
                  {r.states ?? "none"} {r.states_without_pack > 0 ? <Badge tone="warn">{r.states_without_pack} without a rule pack</Badge> : null}
                </td>
                <td className="py-2 pr-4 tabular-nums">{r.items}</td>
                <td className="py-2 pr-4">{r.archived_at ? <Badge>archived</Badge> : r.active ? <Badge tone="good">active</Badge> : <Badge tone="warn">inactive</Badge>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {canWrite ? (
        <>
          <Card title="Start from a template" description="Templates carry the service line, job kind and treatment areas. Prices and state rules are yours to set.">
            <form action={createServiceType} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="tenant_id" value={tenantId} />
              <Field label="Template" htmlFor="template">
                <Select id="template" name="template" required defaultValue="">
                  <option value="" disabled>
                    Pick a template
                  </option>
                  {SERVICE_TYPE_TEMPLATES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.name} ({SERVICE_LINE_LABELS[t.serviceLine]})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Name (optional)" htmlFor="template_name">
                <Input id="template_name" name="name" maxLength={80} placeholder="Defaults to the template name" />
              </Field>
              <Button type="submit">Add from template</Button>
            </form>
          </Card>

          <Card title="Or describe one" description="For anything the templates do not cover.">
            <form action={createServiceType} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="tenant_id" value={tenantId} />
              <input type="hidden" name="areas_present" value="true" />
              <Field label="Name" htmlFor="st-name">
                <Input id="st-name" name="name" required maxLength={80} />
              </Field>
              <Field label="Service line" htmlFor="st-line">
                <Select id="st-line" name="service_line" required defaultValue="general_pest">
                  {SERVICE_LINES.map((l) => (
                    <option key={l} value={l}>
                      {SERVICE_LINE_LABELS[l]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Job kind" htmlFor="st-kind" hint="State rule packs key notice and blackout rules on this.">
                <Select id="st-kind" name="job_kind" required defaultValue="recurring_treatment">
                  {JOB_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {JOB_KIND_LABELS[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Pricing method" htmlFor="st-pricing">
                <Select id="st-pricing" name="pricing_method" required defaultValue="price_book">
                  {PRICING_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PRICING_METHOD_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </Field>
              <fieldset className="sm:col-span-2">
                <legend className="text-sm font-medium text-stone-700">Treatment areas</legend>
                <div className="mt-1 flex flex-wrap gap-4 text-sm">
                  {TREATMENT_AREAS.map((a) => (
                    <label key={a} className="flex items-center gap-2">
                      <input type="checkbox" name="treatment_areas" value={a} /> {TREATMENT_AREA_LABELS[a]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Field label="Default duration (minutes)" htmlFor="st-duration">
                <Input id="st-duration" name="default_duration_minutes" type="number" min={5} max={1440} defaultValue={60} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Description" htmlFor="st-description">
                  <Textarea id="st-description" name="description" rows={2} />
                </Field>
              </div>
              <div>
                <Button type="submit">Add service type</Button>
              </div>
            </form>
          </Card>
        </>
      ) : null}
    </>
  );
}
