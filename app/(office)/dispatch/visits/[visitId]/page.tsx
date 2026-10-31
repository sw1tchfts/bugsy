import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Table, Textarea, errorMessage } from "@/components/ui";
import { VISIT_KIND_LABELS, VISIT_STATUS_LABELS } from "@/lib/agreements/forms";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { formatBusinessDate, formatInstant, todayInZone } from "@/lib/dates";
import { ARRIVAL_WINDOWS, ARRIVAL_WINDOW_LABELS, CREW_ROLES, CREW_ROLE_LABELS, type CheckResult } from "@/lib/dispatch/checks";
import { listMembers, listTechnicians, loadCrew, loadVisit, runCheck } from "@/lib/dispatch/db";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { addCrewMember, removeCrewMember, scheduleVisit, setArrivalWindow, setDispatchNotes, skipVisit, unscheduleVisit } from "../../actions";

export const metadata: Metadata = { title: "Visit" };

type Detail = {
  account_name: string;
  property_address: string;
  property_name: string | null;
  city: string | null;
  service_type_name: string;
  branch_name: string | null;
  agreement_number: number | null;
  sequence: number;
  price_cents: string;
  interior_only: boolean;
  reservice_reason: string | null;
  dispatch_notes: string | null;
  skip_reason: string | null;
  access_notes: string | null;
  arrived_at: string | null;
  departed_at: string | null;
  completed_at: string | null;
};

export default async function DispatchVisitPage({ params, searchParams }: { params: Promise<{ visitId: string }>; searchParams: Promise<{ error?: string; warn?: string }> }) {
  const { session, active } = await requireActiveTenant();
  const { visitId } = await params;
  const { error, warn } = await searchParams;
  const tenantId = active.tenantId;
  const canWrite = can(active.permissions, "dispatch.write");
  const today = todayInZone(active.tenantTimezone);

  const data = await dbAs(session, async (tx) => {
    const visit = await loadVisit(tx, tenantId, visitId);
    if (!visit) return null;
    const [detail] = await tx<Detail[]>`
      select ac.name as account_name, p.normalized_address as property_address, p.name as property_name, p.city, st.name as service_type_name, b.name as branch_name,
             a.number as agreement_number, v.sequence, v.price_cents, v.interior_only, v.reservice_reason, v.dispatch_notes, v.skip_reason, p.access_notes,
             v.arrived_at, v.departed_at, v.completed_at
      from public.visits v
        join public.accounts ac on ac.id = v.account_id
        join public.properties p on p.id = v.property_id
        join public.service_types st on st.id = v.service_type_id
        left join public.branches b on b.id = v.branch_id
        left join public.agreements a on a.id = v.agreement_id
      where v.id = ${visitId} and v.tenant_id = ${tenantId}`;
    const crew = await loadCrew(tx, tenantId, visitId);
    const members = await listMembers(tx, tenantId);
    const technicians = await listTechnicians(tx, tenantId);
    const check: CheckResult | null = visit.scheduled_for && visit.status !== "planned" ? await runCheck(tx, tenantId, visit, visit.scheduled_for, crew, today, visit.route_position) : null;
    return { visit, detail, crew, members, technicians, check };
  });
  if (!data) notFound();
  const { visit, detail, crew, members, technicians, check } = data;
  const nameOf = (userId: string) => members.find((m) => m.user_id === userId)?.name ?? "Unknown member";
  const here = `/dispatch/visits/${visit.id}`;
  const open = ["planned", "scheduled"].includes(visit.status);
  const hidden = (
    <>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="visit_id" value={visit.id} />
      <input type="hidden" name="return_to" value={here} />
    </>
  );

  return (
    <>
      <div>
        <p className="text-sm text-stone-500">
          <Link href="/dispatch" className="hover:underline">
            Dispatch
          </Link>
          {detail.agreement_number ? (
            <>
              {" / "}
              <Link href={`/agreements/${visit.agreement_id}`} className="hover:underline">
                Agreement #{detail.agreement_number}
              </Link>
            </>
          ) : null}
        </p>
        <h1 className="text-2xl font-semibold">
          Visit {detail.sequence}: {detail.account_name} <Badge tone={visit.status === "completed" ? "good" : visit.status === "cancelled" ? "bad" : visit.status === "planned" ? "neutral" : "warn"}>{VISIT_STATUS_LABELS[visit.status as keyof typeof VISIT_STATUS_LABELS]}</Badge>
        </h1>
        <p className="text-sm text-stone-600">
          {VISIT_KIND_LABELS[visit.kind as keyof typeof VISIT_KIND_LABELS]} {detail.service_type_name.toLowerCase()} at{" "}
          <Link href={`/customers/properties/${visit.property_id}`} className="underline">
            {detail.property_name ? `${detail.property_name}, ` : ""}
            {detail.property_address}
          </Link>{" "}
          ({visit.property_state}). Due {formatBusinessDate(visit.due_start)} to {formatBusinessDate(visit.due_end)}. {formatCents(detail.price_cents)}.{detail.interior_only ? " Interior only." : ""}
          {detail.reservice_reason ? ` Re-service: ${detail.reservice_reason}.` : ""}
          {detail.branch_name ? ` Branch: ${detail.branch_name}.` : ""}
          {visit.scheduled_for ? ` Scheduled ${formatBusinessDate(visit.scheduled_for)}${visit.route_position ? `, stop ${visit.route_position}` : ""}, lead ${visit.technician_id ? nameOf(visit.technician_id) : "none"}.` : " Not scheduled yet."}
          {detail.completed_at ? ` Completed ${formatInstant(detail.completed_at, active.tenantTimezone)}.` : ""}
          {detail.skip_reason ? ` Skipped: ${detail.skip_reason}.` : ""}
        </p>
        {detail.access_notes ? <p className="text-sm text-stone-600">Access: {detail.access_notes}</p> : null}
      </div>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}
      {warn ? <Notice kind="info">{warn}</Notice> : null}

      {check ? (
        <Card title="Compliance check" description="Re-run against the current crew and date every time this page loads.">
          {check.blockers.length === 0 && check.warnings.length === 0 ? <p className="text-sm text-emerald-800">Clear: the crew holds what this work needs in {visit.property_state} on {formatBusinessDate(visit.scheduled_for ?? "")}.</p> : null}
          {check.blockers.map((b) => (
            <p key={b.code} className="text-sm text-red-800">
              Blocked: {b.message}
            </p>
          ))}
          {check.warnings.map((w) => (
            <p key={w.code} className="text-sm text-amber-800">
              Warning: {w.message}
            </p>
          ))}
        </Card>
      ) : null}

      <Card title="Crew" description="The lead is the scheduled technician. Applicators apply product; a supervisor covers trainees; helpers need no credential.">
        {crew.length === 0 ? (
          <Empty>No crew until the visit is scheduled.</Empty>
        ) : (
          <Table headers={["Person", "Role", ""]}>
            {crew.map((c) => (
              <tr key={c.user_id}>
                <td className="py-2 pr-4 font-medium">{nameOf(c.user_id)}</td>
                <td className="py-2 pr-4">{CREW_ROLE_LABELS[c.role]}</td>
                <td className="py-2 text-right">
                  {canWrite && open && c.role !== "lead" ? (
                    <form action={removeCrewMember}>
                      {hidden}
                      <input type="hidden" name="user_id" value={c.user_id} />
                      <Button type="submit" variant="secondary">
                        Remove
                      </Button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
        {canWrite && open && visit.status === "scheduled" ? (
          <form action={addCrewMember} className="mt-4 flex flex-wrap items-end gap-2 border-t border-stone-200 pt-4">
            {hidden}
            <Field label="Add to crew" htmlFor="crew-user">
              <Select id="crew-user" name="user_id" defaultValue="">
                <option value="" disabled>
                  Pick a person
                </option>
                {members
                  .filter((m) => !crew.some((c) => c.user_id === m.user_id))
                  .map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Role" htmlFor="crew-role">
              <Select id="crew-role" name="role" defaultValue="helper">
                {CREW_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {CREW_ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="secondary">
              Add
            </Button>
          </form>
        ) : null}
      </Card>

      {canWrite && open ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title={visit.status === "scheduled" ? "Move" : "Schedule"} description="The check runs before anything is written.">
            <form action={scheduleVisit} className="grid gap-3">
              {hidden}
              <Field label="Technician (lead)" htmlFor="technician_id">
                <Select id="technician_id" name="technician_id" defaultValue={visit.technician_id ?? technicians[0]?.user_id ?? ""}>
                  {technicians.map((t) => (
                    <option key={t.user_id} value={t.user_id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Date" htmlFor="date">
                <Input id="date" name="date" type="date" required defaultValue={visit.scheduled_for ?? (visit.due_start > today ? visit.due_start : today)} />
              </Field>
              <div className="flex gap-2">
                <Button type="submit">{visit.status === "scheduled" ? "Move visit" : "Schedule visit"}</Button>
                {visit.status === "scheduled" ? (
                  <Button type="submit" variant="secondary" formAction={unscheduleVisit}>
                    Unschedule
                  </Button>
                ) : null}
              </div>
            </form>
          </Card>
          <Card title="Arrival window" description="Promised to the customer; the board keeps morning stops ahead of afternoon stops.">
            <form action={setArrivalWindow} className="grid gap-3">
              {hidden}
              <Field label="Window" htmlFor="arrival_window">
                <Select id="arrival_window" name="arrival_window" defaultValue={visit.arrival_window}>
                  {ARRIVAL_WINDOWS.map((w) => (
                    <option key={w} value={w}>
                      {ARRIVAL_WINDOW_LABELS[w]}
                    </option>
                  ))}
                </Select>
              </Field>
              <div>
                <Button type="submit" variant="secondary">
                  Save window
                </Button>
              </div>
            </form>
            <form action={setDispatchNotes} className="mt-4 grid gap-3 border-t border-stone-200 pt-4">
              {hidden}
              <Field label="Dispatch notes" htmlFor="dispatch_notes" hint="Gate codes, dogs, where to park. The technician sees these.">
                <Textarea id="dispatch_notes" name="dispatch_notes" rows={3} defaultValue={detail.dispatch_notes ?? ""} />
              </Field>
              <div>
                <Button type="submit" variant="secondary">
                  Save notes
                </Button>
              </div>
            </form>
          </Card>
          <Card title="Skip" description="Leaves the visit on the agreement as skipped, with the reason.">
            <form action={skipVisit} className="grid gap-3">
              {hidden}
              <Field label="Reason" htmlFor="skip_reason">
                <Input id="skip_reason" name="skip_reason" required maxLength={200} placeholder="Customer away all month" />
              </Field>
              <div>
                <Button type="submit" variant="danger">
                  Skip visit
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </>
  );
}
