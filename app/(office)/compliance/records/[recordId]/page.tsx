import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, Empty, Field, Input, Notice, Table, Textarea, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { type Amendment, type RecordSnapshot, applyAmendments } from "@/lib/compliance/records";
import { formatBusinessDate, formatInstant } from "@/lib/dates";
import { listMembers } from "@/lib/dispatch/db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { amendRecord, lockRecordNow } from "../../actions";

export const metadata: Metadata = { title: "Application record" };

type RecordRow = {
  id: string;
  visit_id: string;
  state_code: string;
  pack_version: string | null;
  job_kind: string;
  business_date: string;
  status: string;
  complete: boolean;
  missing_fields: string[];
  required_fields: string[];
  lock_due_at: string;
  locked_at: string | null;
  locked_by: string | null;
  retention_until: string | null;
  snapshot: RecordSnapshot;
  products_now: number;
  notes_now: number;
  photos_now: number;
};

type AmendmentRow = Amendment & { id: string; reason: string; author_id: string; created_at: string };

export default async function RecordPage({ params, searchParams }: { params: Promise<{ recordId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "compliance.read");
  const { recordId } = await params;
  const { error } = await searchParams;
  const tenantId = active.tenantId;
  const tz = active.tenantTimezone;
  const canWrite = can(active.permissions, "compliance.write");

  const data = await dbAs(session, async (tx) => {
    const [record] = await tx<RecordRow[]>`
      select r.id, r.visit_id, r.state_code, r.pack_version, r.job_kind, r.business_date, r.status, r.complete, r.missing_fields, r.required_fields, r.lock_due_at, r.locked_at, r.locked_by, r.retention_until, r.snapshot,
             (select count(*)::int from public.visit_products p where p.visit_id = r.visit_id) as products_now,
             (select count(*)::int from public.visit_notes n where n.visit_id = r.visit_id) as notes_now,
             (select count(*)::int from public.visit_photos p where p.visit_id = r.visit_id) as photos_now
      from public.application_records r where r.id = ${recordId} and r.tenant_id = ${tenantId}`;
    if (!record) return null;
    const amendments = await tx<AmendmentRow[]>`select id, changed_fields, reason, author_id, created_at from public.application_record_amendments where tenant_id = ${tenantId} and record_id = ${recordId} order by created_at`;
    const members = await listMembers(tx, tenantId);
    return { record, amendments, members };
  });
  if (!data) notFound();
  const { record, amendments, members } = data;
  const nameOf = (id: string | null) => (id ? (members.find((m) => m.user_id === id)?.name ?? "Unknown member") : "the compliance job");
  const original = record.snapshot;
  const current = applyAmendments(original as unknown as Record<string, unknown>, amendments) as unknown as RecordSnapshot;
  const locked = record.status === "locked";
  const capturedAfterLock = locked && (record.products_now !== original.products.length || record.notes_now !== original.notes.length || record.photos_now !== original.photo_count);
  const show = (v: unknown) => (v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v));

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/compliance" className="hover:underline">
          Compliance
        </Link>{" "}
        /{" "}
        <Link href="/compliance/records" className="hover:underline">
          Records
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">
          Record {formatBusinessDate(record.business_date)}: {current.account.name}
        </h1>
        {locked ? <Badge tone="good">locked</Badge> : <Badge tone="warn">draft</Badge>}
        {record.complete ? <Badge tone="good">complete</Badge> : <Badge tone="bad">incomplete</Badge>}
      </div>
      <p className="text-sm text-stone-600">
        {current.property.address}. {current.service_type.name} ({record.job_kind.replace(/_/g, " ")}).{" "}
        <Link href={`/dispatch/visits/${record.visit_id}`} className="underline">
          Visit
        </Link>
        . {locked ? `Locked ${formatInstant(record.locked_at ?? "", tz)} by ${nameOf(record.locked_by)}.` : `Locks ${formatInstant(record.lock_due_at, tz)}.`} Pack {record.pack_version ?? "none (federal floor)"}; kept{" "}
        {record.retention_until ? `until ${formatBusinessDate(record.retention_until)}` : "until a state pack sets a period"}.
      </p>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}
      {!record.complete ? <Notice kind="error">Missing: {record.missing_fields.join(", ")}.</Notice> : null}
      {capturedAfterLock ? <Notice kind="info">The visit received captures after this record locked (products, notes or photos differ from the snapshot). The record stands as locked; file an amendment if the record itself is wrong.</Notice> : null}

      <Card title="The record" description={locked ? "As locked, with amendments applied; the original values stay in the amendment list below." : "A draft is snapshotted again when it locks, so changes at the stop still flow in."} actions={!locked && canWrite ? (
        <form action={lockRecordNow}>
          <input type="hidden" name="tenant_id" value={tenantId} />
          <input type="hidden" name="record_id" value={record.id} />
          <Button type="submit" variant="secondary">
            Lock now
          </Button>
        </form>
      ) : undefined}>
        <div className="grid gap-1 text-sm" data-testid="record-snapshot">
          <p>
            <span className="font-medium">Arrived:</span> {current.arrived_at ? formatInstant(current.arrived_at, tz) : "none"}. <span className="font-medium">Departed:</span> {current.departed_at ? formatInstant(current.departed_at, tz) : "none"} ({current.time_zone}).
          </p>
          <p>
            <span className="font-medium">Crew:</span>{" "}
            {current.crew.map((c) => `${c.name} (${c.role}${c.cert_number ? `, ${c.cert_number}` : ""}${c.trainee ? ", trainee" : ""}${c.cert_expires_on ? `, to ${formatBusinessDate(c.cert_expires_on)}` : ""})`).join("; ") || "none"}
          </p>
          <p>
            <span className="font-medium">Areas treated:</span> {show(current.areas_treated) || "none"}. <span className="font-medium">Target pests:</span> {show(current.target_pests) || "none"}.
          </p>
          <p>
            <span className="font-medium">Conditions:</span> {current.conditions ? show(current.conditions) : "none"}
          </p>
          <p>
            <span className="font-medium">Signature:</span> {current.signature ? `${current.signature.signer_name}, ${formatInstant(current.signature.signed_at, tz)}` : "none"}. <span className="font-medium">Photos:</span> {current.photo_count}.
          </p>
          <p>
            <span className="font-medium">Required fields:</span> {record.required_fields.join(", ")}
          </p>
        </div>
        <h3 className="mt-3 text-sm font-semibold">Products applied</h3>
        {current.products.length === 0 ? (
          <Empty>No product lines.</Empty>
        ) : (
          <Table headers={["#", "Product", "EPA", "Amount", "Site", "Target pests", "Applied by", "Label"]}>
            {current.products.map((p, i) => (
              <tr key={i}>
                <td className="py-2 pr-4 text-xs text-stone-500">products.{i}</td>
                <td className="py-2 pr-4 font-medium">{p.product_name}</td>
                <td className="py-2 pr-4 font-mono text-xs">{p.epa_reg_no}</td>
                <td className="py-2 pr-4">
                  {p.amount} {p.amount_unit.replace("_", " ")}
                  {p.carrier_amount ? ` / ${p.carrier_amount} ${p.carrier_unit?.replace("_", " ")}` : ""}
                </td>
                <td className="py-2 pr-4">
                  {p.site_treated}
                  {p.location_description ? ` (${p.location_description})` : ""}
                </td>
                <td className="py-2 pr-4">{p.target_pests.join(", ")}</td>
                <td className="py-2 pr-4">
                  {p.applied_by.name}
                  {p.applied_by.cert_number ? ` (${p.applied_by.cert_number})` : ""}
                </td>
                <td className="py-2 pr-4 text-xs">{p.label_check?.status ?? ""}</td>
              </tr>
            ))}
          </Table>
        )}
        {current.notes.length ? (
          <ul className="mt-3 grid gap-1 text-sm">
            {current.notes.map((n, i) => (
              <li key={i}>
                <span className="text-xs text-stone-500">{n.kind.replace(/_/g, " ")}: </span>
                {n.content}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card title="Amendments" description="Corrections after lock: who, why, what changed. The original value stays beside the correction.">
        {amendments.length === 0 ? (
          <Empty>No amendments.</Empty>
        ) : (
          <Table headers={["When", "By", "Reason", "Field", "Original", "Amended"]}>
            {amendments.flatMap((a) =>
              Object.entries(a.changed_fields).map(([field, change]) => (
                <tr key={`${a.id}-${field}`} data-testid="amendment-row">
                  <td className="py-2 pr-4">{formatInstant(a.created_at, tz)}</td>
                  <td className="py-2 pr-4">{nameOf(a.author_id)}</td>
                  <td className="py-2 pr-4">{a.reason}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{field}</td>
                  <td className="py-2 pr-4">{show(change.from)}</td>
                  <td className="py-2 pr-4 font-medium">{show(change.to)}</td>
                </tr>
              )),
            )}
          </Table>
        )}
        {locked && canWrite ? (
          <form action={amendRecord} className="mt-4 grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="tenant_id" value={tenantId} />
            <input type="hidden" name="record_id" value={record.id} />
            <Field label="Field" htmlFor="amend-field" hint="A dotted key from the record, for example conditions.wind_mph, areas_treated or products.0.amount.">
              <Input id="amend-field" name="field" required placeholder="conditions.wind_mph" />
            </Field>
            <Field label="Corrected value" htmlFor="amend-value" hint="Lists are comma separated.">
              <Input id="amend-value" name="new_value" />
            </Field>
            <Field label="Reason" htmlFor="amend-reason">
              <Textarea id="amend-reason" name="reason" rows={2} required />
            </Field>
            <div className="sm:col-span-3">
              <Button type="submit">File amendment</Button>
            </div>
          </form>
        ) : null}
      </Card>
    </>
  );
}
