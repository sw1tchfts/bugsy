import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, Field, Input, Notice, Select, Textarea, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { formatBusinessDate } from "@/lib/dates";
import { FINDINGS, wdiProblems } from "@/lib/specialty/wdi";
import { WDI_JOB_KINDS, loadWdi } from "@/lib/specialty/wdi-db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { saveWdi } from "./actions";

export const metadata: Metadata = { title: "WDI report" };

const yesNo = (v: boolean | null | undefined) => (v === true ? "yes" : v === false ? "no" : "");

/** The wood-destroying insect report for an inspection visit (spec 15 rule 7): a draft until issued, then fixed. */
export default async function WdiPage({ params, searchParams }: { params: Promise<{ visitId: string }>; searchParams: Promise<{ error?: string; note?: string }> }) {
  const { visitId } = await params;
  const q = await searchParams;
  const { session, active } = await requireActiveTenant();
  if (!can(active.permissions, "visits.read") && !can(active.permissions, "compliance.read") && !can(active.permissions, "customers.read")) redirect("/?error=forbidden");
  const data = await dbAs(session, (tx) => loadWdi(tx, active.tenantId, visitId, active.tenantTimezone));
  if (!data) notFound();
  const { visit, report, ctx } = data;
  const isWdiVisit = (WDI_JOB_KINDS as readonly string[]).includes(visit.job_kind);
  const issued = report?.status === "issued";
  const canIssue = can(active.permissions, "compliance.write");
  const canDraft = canIssue || can(active.permissions, "visits.write");
  const problems = report && !issued ? wdiProblems(report, ctx.inspector) : [];
  const r = report;
  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href={`/dispatch/visits/${visit.id}`} className="hover:underline">
          Visit
        </Link>
        {visit.agreement_id ? (
          <>
            {" / "}
            <Link href={`/agreements/${visit.agreement_id}`} className="hover:underline">
              Agreement
            </Link>
          </>
        ) : null}
      </p>
      <h1 className="text-2xl font-semibold">
        WDI report{r?.number ? ` No. ${r.number}` : ""} {issued ? <Badge tone="good">issued</Badge> : <Badge>draft</Badge>}
      </h1>
      <p className="text-sm text-stone-600">
        {visit.account_name}, {visit.address}. {ctx.inspected_on ? `Inspected ${formatBusinessDate(ctx.inspected_on)}.` : "Not inspected yet."} Inspector: {ctx.inspector ? `${ctx.inspector.name}${ctx.inspector.cert_number ? `, certification ${ctx.inspector.cert_number}` : ", no credential on file for this state"}` : "no crew on the visit"}.
      </p>
      {q.note ? <Notice kind="success">{q.note}</Notice> : null}
      {errorMessage(q.error) ? <Notice kind="error">{errorMessage(q.error)}</Notice> : null}
      {!isWdiVisit ? <Notice kind="error">A WDI report belongs to an inspection or WDI visit; this visit is neither.</Notice> : null}

      {issued ? (
        <Card
          title="Issued report"
          description="An issued report never changes. Print it for the agent, buyer and lender."
          actions={
            <a href={`/visits/${visit.id}/wdi/print`} className="text-sm text-emerald-800 underline" data-testid="wdi-print">
              Printable report
            </a>
          }
        >
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="text-stone-500">Requested by</dt>
            <dd>{r?.requested_by}</dd>
            <dt className="text-stone-500">Buyer / seller</dt>
            <dd>
              {r?.buyer} / {r?.seller}
            </dd>
            <dt className="text-stone-500">Areas inspected</dt>
            <dd>{r?.inspected_areas}</dd>
            <dt className="text-stone-500">Not inspected</dt>
            <dd>{r?.inaccessible_areas}</dd>
            {FINDINGS.map((f) => (
              <div key={f.key} className="contents">
                <dt className="text-stone-500">{f.label}</dt>
                <dd data-testid={`finding-${f.key}`}>
                  {r?.findings[f.key]?.seen ? `Yes: ${r.findings[f.key]?.where}` : "No"}
                </dd>
              </div>
            ))}
            <dt className="text-stone-500">Treatment recommended</dt>
            <dd>{r?.treatment_recommended ? "Yes" : "No"}</dd>
          </dl>
        </Card>
      ) : isWdiVisit && canDraft ? (
        <Card title={report ? "Draft" : "Write the report"} description="Save the draft as you go. Issuing needs the inspected and inaccessible areas, every finding answered, and an inspector with a credential for the property's state.">
          {problems.length ? (
            <Notice kind="info">
              Before it can be issued: {problems.join(" ")}
            </Notice>
          ) : null}
          <form action={saveWdi} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="tenant_id" value={active.tenantId} />
            <input type="hidden" name="visit_id" value={visit.id} />
            <Field label="Requested by" htmlFor="requested_by">
              <Input id="requested_by" name="requested_by" defaultValue={r?.requested_by ?? ""} placeholder="Agent and office" />
            </Field>
            <Field label="Structures inspected" htmlFor="structures">
              <Input id="structures" name="structures" defaultValue={r?.structures ?? ""} placeholder="House and detached garage" />
            </Field>
            <Field label="Buyer" htmlFor="buyer">
              <Input id="buyer" name="buyer" defaultValue={r?.buyer ?? ""} />
            </Field>
            <Field label="Seller" htmlFor="seller">
              <Input id="seller" name="seller" defaultValue={r?.seller ?? ""} />
            </Field>
            <Field label="Areas inspected" htmlFor="inspected_areas">
              <Textarea id="inspected_areas" name="inspected_areas" rows={2} defaultValue={r?.inspected_areas ?? ""} />
            </Field>
            <Field label="Areas not inspected and why (or none)" htmlFor="inaccessible_areas">
              <Textarea id="inaccessible_areas" name="inaccessible_areas" rows={2} defaultValue={r?.inaccessible_areas ?? ""} />
            </Field>
            <fieldset className="grid gap-2 sm:col-span-2">
              <legend className="text-sm font-medium text-stone-700">Findings</legend>
              {FINDINGS.map((f) => (
                <div key={f.key} className="grid items-end gap-2 sm:grid-cols-[1fr_8rem_2fr]">
                  <span className="text-sm">{f.label}</span>
                  <Select name={`${f.key}_seen`} aria-label={`${f.label}: seen`} defaultValue={yesNo(r?.findings[f.key]?.seen)}>
                    <option value="">Not answered</option>
                    <option value="no">Not seen</option>
                    <option value="yes">Seen</option>
                  </Select>
                  <Input name={`${f.key}_where`} aria-label={`${f.label}: where`} placeholder="Where" defaultValue={r?.findings[f.key]?.where ?? ""} />
                </div>
              ))}
            </fieldset>
            <Field label="Treatment recommended" htmlFor="treatment_recommended">
              <Select id="treatment_recommended" name="treatment_recommended" defaultValue={yesNo(r?.treatment_recommended)}>
                <option value="">Not answered</option>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </Select>
            </Field>
            <Field label="Notes" htmlFor="notes">
              <Textarea id="notes" name="notes" rows={2} defaultValue={r?.notes ?? ""} />
            </Field>
            <div className="flex gap-3 sm:col-span-2">
              <Button type="submit" name="intent" value="draft" variant="secondary">
                Save draft
              </Button>
              {canIssue ? (
                <Button type="submit" name="intent" value="issue">
                  Issue the report
                </Button>
              ) : null}
            </div>
          </form>
        </Card>
      ) : (
        <Card title="Report">
          <p className="text-sm text-stone-600">No report yet.</p>
        </Card>
      )}
    </>
  );
}
