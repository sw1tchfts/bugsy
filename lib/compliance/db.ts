// The compliance job and its pieces (spec 07): application records from completed visits, locking when due, the
// notice obligations, and the tasks that raise alerts. Every function takes the transaction it runs in, so the same
// code serves the technician's completion, the licensed manager's "run now" and the scheduled job.
import type postgres from "postgres";
import { PESTICIDE_JOB_KINDS } from "@/lib/catalog/service-lines";
import { alertTasks, type ExpiringItem, expiryAlerts } from "@/lib/compliance/alerts";
import { type NoticeContact, type NoticeSpec, type RegistryEntry, requiredNotices } from "@/lib/compliance/notices";
import { buildRecordSnapshot, isPesticideVisit, lockDueAt, retentionUntil } from "@/lib/compliance/records";
import { getStatePack } from "@/lib/compliance/rules";
import { dateInZone, todayInZone } from "@/lib/dates";
import { listMembers } from "@/lib/dispatch/db";
import { loadRouteVisit } from "@/lib/tech/route-db";

type Sql = postgres.Sql | postgres.TransactionSql;

export type RunCounts = { records: number; locked: number; notices: number; tasks: number };

/** Creates the draft record for a completed pesticide visit; nothing for other visits or when one exists. */
export async function ensureRecord(tx: Sql, tenantId: string, visitId: string, timeZone: string): Promise<{ id: string; created: boolean } | null> {
  const [existing] = await tx<{ id: string }[]>`select id from public.application_records where tenant_id = ${tenantId} and visit_id = ${visitId}`;
  if (existing) return { id: existing.id, created: false };
  const visit = await loadRouteVisit(tx, tenantId, visitId);
  if (!visit || visit.status !== "completed" || !isPesticideVisit(visit.job_kind)) return null;
  const pack = getStatePack(visit.property.state);
  const build = buildRecordSnapshot(visit, pack, timeZone);
  const [row] = await tx<{ id: string }[]>`
    insert into public.application_records ${tx({
      tenant_id: tenantId,
      visit_id: visitId,
      state_code: visit.property.state,
      pack_version: pack?.version ?? null,
      job_kind: visit.job_kind,
      business_date: build.business_date,
      arrived_at: build.snapshot.arrived_at,
      departed_at: build.snapshot.departed_at,
      required_fields: build.required,
      missing_fields: build.missing,
      complete: build.complete,
      snapshot: tx.json(build.snapshot),
      status: "draft",
      lock_due_at: lockDueAt(build.snapshot.departed_at, build.business_date, timeZone, pack),
    })}
    on conflict (visit_id) do nothing returning id`;
  if (!row) {
    const [again] = await tx<{ id: string }[]>`select id from public.application_records where tenant_id = ${tenantId} and visit_id = ${visitId}`;
    return again ? { id: again.id, created: false } : null;
  }
  if (!build.complete) await incompleteTask(tx, tenantId, row.id, build.business_date, build.missing);
  return { id: row.id, created: true };
}

async function incompleteTask(tx: Sql, tenantId: string, recordId: string, businessDate: string, missing: string[]): Promise<void> {
  await tx`
    insert into public.compliance_tasks (tenant_id, kind, subject_table, subject_id, due_on, title)
    values (${tenantId}, 'record_incomplete', 'application_records', ${recordId}, ${businessDate}, ${`Application record of ${businessDate} is missing: ${missing.join(", ")}`})
    on conflict (tenant_id, kind, subject_id, due_on) do nothing`;
}

/** Locks a draft record: the visit is snapshotted again as it stands now, then the row never changes. */
export async function lockRecord(tx: Sql, tenantId: string, recordId: string, timeZone: string, lockedBy: string | null): Promise<boolean> {
  const [record] = await tx<{ visit_id: string; status: string }[]>`select visit_id, status from public.application_records where id = ${recordId} and tenant_id = ${tenantId}`;
  if (!record || record.status !== "draft") return false;
  const visit = await loadRouteVisit(tx, tenantId, record.visit_id);
  if (!visit) return false;
  const pack = getStatePack(visit.property.state);
  const build = buildRecordSnapshot(visit, pack, timeZone);
  const result = await tx`
    update public.application_records set ${tx({
      snapshot: tx.json(build.snapshot),
      required_fields: build.required,
      missing_fields: build.missing,
      complete: build.complete,
      business_date: build.business_date,
      arrived_at: build.snapshot.arrived_at,
      departed_at: build.snapshot.departed_at,
      pack_version: pack?.version ?? null,
      status: "locked",
      locked_at: new Date(),
      locked_by: lockedBy,
      retention_until: retentionUntil(build.business_date, pack),
    })}
    where id = ${recordId} and tenant_id = ${tenantId} and status = 'draft'`;
  if (result.count === 0) return false;
  if (!build.complete) await incompleteTask(tx, tenantId, recordId, build.business_date, build.missing);
  return true;
}

/** Locks every draft record whose due time has passed. */
export async function lockDueRecords(tx: Sql, tenantId: string, timeZone: string, now: Date): Promise<number> {
  const due = await tx<{ id: string }[]>`
    select id from public.application_records where tenant_id = ${tenantId} and status = 'draft' and lock_due_at <= ${now} order by lock_due_at`;
  let locked = 0;
  for (const row of due) if (await lockRecord(tx, tenantId, row.id, timeZone, null)) locked += 1;
  return locked;
}

type VisitRow = {
  id: string;
  scheduled_for: string | null;
  arrived_at: string | null;
  departed_at: string | null;
  job_kind: string;
  treatment_areas: string[];
  account_id: string;
  account_name: string;
  property_id: string;
  property_type: string;
  state_code: string;
  unit_count: number | null;
  address: string;
  registry_matches: Record<string, string[]> | null;
};

/** The notice obligations of one visit, computed from the pack and what is on file. */
export async function noticesForVisit(tx: Sql, tenantId: string, visitId: string, timeZone: string, options: { scheduledFor?: string } = {}): Promise<NoticeSpec[]> {
  const [v] = await tx<VisitRow[]>`
    select v.id, v.scheduled_for, v.arrived_at, v.departed_at, st.job_kind, st.treatment_areas, v.account_id, a.name as account_name,
           p.id as property_id, p.property_type, p.state_code, p.unit_count,
           concat_ws(', ', concat_ws(' ', p.line1, p.line2), p.city, concat_ws(' ', p.state_code, p.postal_code)) as address, p.registry_matches
    from public.visits v
      join public.service_types st on st.id = v.service_type_id
      join public.accounts a on a.id = v.account_id
      join public.properties p on p.id = v.property_id
    where v.id = ${visitId} and v.tenant_id = ${tenantId}`;
  if (!v) return [];
  const products = await tx<{ rei_hours: string | null }[]>`
    select pr.rei_hours::text from public.visit_products vp join public.products pr on pr.id = vp.product_id where vp.tenant_id = ${tenantId} and vp.visit_id = ${v.id}`;
  const contacts = await tx<{ id: string; role: string; unit_id: string | null; name: string; email: string | null; phone: string | null; e_notice_consent_at: string | null }[]>`
    select id, role, unit_id, name, email, phone, e_notice_consent_at from public.contacts
    where tenant_id = ${tenantId} and archived_at is null and (account_id = ${v.account_id} or property_id = ${v.property_id})
    order by case role when 'primary' then 0 when 'billing' then 1 else 2 end, created_at`;
  const ids = Object.values(v.registry_matches ?? {}).flat();
  const registry = ids.length
    ? await tx<RegistryEntry[]>`
        select id, registry_kind as kind, name, concat_ws(', ', concat_ws(' ', line1, line2), city, concat_ws(' ', state_code, postal_code)) as address, phone, email
        from public.notification_registries where tenant_id = ${tenantId} and id = any(${ids}::uuid[]) order by registry_kind, id`
    : [];
  const input = {
    visit: {
      id: v.id,
      scheduled_for: options.scheduledFor ?? v.scheduled_for,
      arrived_at: v.arrived_at,
      departed_at: v.departed_at,
      job_kind: v.job_kind as NoticeVisitJobKind,
      treatment_areas: v.treatment_areas as NoticeTreatmentArea[],
      products: products.map((p) => ({ rei_hours: p.rei_hours === null ? null : Number(p.rei_hours) })),
      account: { name: v.account_name },
      property: { id: v.property_id, type: v.property_type, state: v.state_code, unit_count: v.unit_count, address: v.address },
      registry,
    },
    agreement: null,
    contacts: contacts.map((c): NoticeContact => ({ ...c, address: v.address })),
    timeZone,
  };
  return requiredNotices(input, getStatePack(v.state_code));
}

type NoticeVisitJobKind = Parameters<typeof requiredNotices>[0] extends { visit: infer V } ? (V extends { job_kind: infer K } ? K : never) : never;
type NoticeTreatmentArea = Parameters<typeof requiredNotices>[0] extends { visit: infer V } ? (V extends { treatment_areas: (infer A)[] } ? A : never) : never;

/** Inserts the notices that do not exist yet (one obligation, one row). Returns how many were new. */
export async function createNotices(tx: Sql, tenantId: string, specs: readonly NoticeSpec[]): Promise<number> {
  let created = 0;
  for (const s of specs) {
    const result = await tx`
      insert into public.notices ${tx({
        tenant_id: tenantId,
        kind: s.kind,
        rule_key: s.rule_key,
        required: s.required,
        dedupe_key: s.dedupe_key,
        visit_id: s.visit_id,
        agreement_id: s.agreement_id,
        property_id: s.property_id,
        unit_id: s.unit_id,
        recipient_contact_id: s.recipient_contact_id,
        recipient_name: s.recipient_name,
        recipient_address: s.recipient_address,
        recipient_email: s.recipient_email,
        recipient_phone: s.recipient_phone,
        channel: s.channel,
        due_by: s.due_by,
        for_scheduled_for: s.for_scheduled_for,
      })}
      on conflict (tenant_id, dedupe_key) do nothing`;
    created += result.count;
  }
  return created;
}

/** Record and notices for a visit that just completed, in the completion transaction (spec 07 rule 1). */
export async function onVisitCompleted(tx: Sql, tenantId: string, visitId: string, timeZone: string): Promise<void> {
  await ensureRecord(tx, tenantId, visitId, timeZone);
  await createNotices(tx, tenantId, await noticesForVisit(tx, tenantId, visitId, timeZone));
}

/** Notices for a visit the office just scheduled on a registry address, so the advance notice can be recorded. */
export async function onVisitScheduled(tx: Sql, tenantId: string, visitId: string, timeZone: string): Promise<number> {
  const specs = (await noticesForVisit(tx, tenantId, visitId, timeZone)).filter((s) => s.kind === "registry_advance");
  return createNotices(tx, tenantId, specs);
}

/** Tasks for credentials and branch licenses at 60 and 30 days and when expired; renewed ones close. */
export async function refreshAlertTasks(tx: Sql, tenantId: string, today: string): Promise<number> {
  const names = new Map((await listMembers(tx, tenantId)).map((m) => [m.user_id, m.name]));
  const credentials = await tx<{ id: string; user_id: string; state_code: string; cert_expires_on: string | null; license_expires_on: string | null }[]>`
    select id, user_id, state_code, cert_expires_on, license_expires_on from public.applicator_credentials where tenant_id = ${tenantId} and archived_at is null`;
  const branches = await tx<{ id: string; name: string; license_expires_on: string | null }[]>`
    select id, name, license_expires_on from public.branches where tenant_id = ${tenantId} and archived_at is null`;
  const items: ExpiringItem[] = [];
  for (const c of credentials) {
    const who = names.get(c.user_id) ?? "A technician";
    if (c.cert_expires_on) items.push({ subject_table: "applicator_credentials", subject_id: c.id, label: `${who} (${c.state_code} certification)`, expires_on: c.cert_expires_on });
    if (c.license_expires_on) items.push({ subject_table: "applicator_credentials", subject_id: c.id, label: `${who} (${c.state_code} license)`, expires_on: c.license_expires_on });
  }
  for (const b of branches) {
    if (b.license_expires_on) items.push({ subject_table: "branches", subject_id: b.id, label: `${b.name} (business license)`, expires_on: b.license_expires_on });
  }
  const alerts = expiryAlerts(items, today);
  let created = 0;
  for (const task of alertTasks(alerts)) {
    const result = await tx`
      insert into public.compliance_tasks (tenant_id, kind, subject_table, subject_id, due_on, title)
      values (${tenantId}, ${task.kind}, ${task.subject_table}, ${task.subject_id}, ${task.due_on}, ${task.title})
      on conflict (tenant_id, kind, subject_id, due_on) do nothing`;
    created += result.count;
  }
  // An open alert whose expiry moved on (a renewal) closes itself.
  const open = await tx<{ id: string; kind: string; subject_id: string; due_on: string }[]>`
    select id, kind, subject_id, due_on from public.compliance_tasks
    where tenant_id = ${tenantId} and status = 'open' and kind in ('credential_expiring', 'license_expiring')`;
  const standing = new Set(alerts.map((a) => `${a.kind}:${a.subject_id}:${a.due_on}`));
  for (const task of open) {
    if (!standing.has(`${task.kind}:${task.subject_id}:${task.due_on}`)) {
      await tx`update public.compliance_tasks set status = 'done', done_at = now(), note = 'renewed or no longer applies' where id = ${task.id}`;
    }
  }
  return created;
}

/** Tasks for required notices past due and for scheduled registry matches without a sent advance notice. */
export async function refreshNoticeTasks(tx: Sql, tenantId: string, timeZone: string, now: Date): Promise<number> {
  let created = 0;
  const overdue = await tx<{ id: string; kind: string; due_by: string; recipient_name: string }[]>`
    select id, kind, due_by, recipient_name from public.notices
    where tenant_id = ${tenantId} and status = 'due' and required and due_by is not null and due_by < ${now}`;
  for (const n of overdue) {
    const result = await tx`
      insert into public.compliance_tasks (tenant_id, kind, subject_table, subject_id, due_on, title)
      values (${tenantId}, 'notice_overdue', 'notices', ${n.id}, ${dateInZone(n.due_by, timeZone)}, ${`${n.kind.replace(/_/g, " ")} to ${n.recipient_name} was due ${dateInZone(n.due_by, timeZone)}`})
      on conflict (tenant_id, kind, subject_id, due_on) do nothing`;
    created += result.count;
  }
  const blocked = await tx<{ id: string; scheduled_for: string; address: string }[]>`
    select v.id, v.scheduled_for, concat_ws(' ', p.line1, p.city) as address from public.visits v join public.properties p on p.id = v.property_id
    where v.tenant_id = ${tenantId} and v.status = 'scheduled' and p.registry_matches <> '{}'::jsonb
      and not exists (select 1 from public.notices n where n.tenant_id = v.tenant_id and n.visit_id = v.id and n.kind = 'registry_advance' and n.status = 'sent' and n.for_scheduled_for = v.scheduled_for)`;
  for (const v of blocked) {
    const result = await tx`
      insert into public.compliance_tasks (tenant_id, kind, subject_table, subject_id, due_on, title)
      values (${tenantId}, 'registry_notice_due', 'visits', ${v.id}, ${v.scheduled_for}, ${`Registry advance notice for ${v.address} on ${v.scheduled_for} is not recorded`})
      on conflict (tenant_id, kind, subject_id, due_on) do nothing`;
    created += result.count;
  }
  // A registry entry dropped by a re-import takes its unsent obligation with it (the entry id sits in the dedupe key).
  await tx`
    update public.notices set status = 'waived', waived_reason = 'registry entry removed on re-import'
    where tenant_id = ${tenantId} and kind = 'registry_advance' and status = 'due'
      and not exists (select 1 from public.notification_registries r where r.tenant_id = notices.tenant_id and r.id::text = split_part(notices.dedupe_key, ':', 3))`;
  // Overdue tasks close with their notice; a registry task closes once the notice is sent, the visit left the date or the match is gone.
  await tx`
    update public.compliance_tasks set status = 'done', done_at = now(), note = 'notice sent or waived'
    where tenant_id = ${tenantId} and status = 'open' and kind = 'notice_overdue'
      and not exists (select 1 from public.notices n where n.id = compliance_tasks.subject_id and n.status = 'due')`;
  const stale = await tx<{ id: string }[]>`
    select t.id from public.compliance_tasks t
    where t.tenant_id = ${tenantId} and t.status = 'open' and t.kind = 'registry_notice_due'
      and not exists (select 1 from public.visits v join public.properties p on p.id = v.property_id
                      where v.id = t.subject_id and v.status = 'scheduled' and v.scheduled_for = t.due_on and p.registry_matches <> '{}'::jsonb
                        and not exists (select 1 from public.notices n where n.visit_id = v.id and n.kind = 'registry_advance' and n.status = 'sent' and n.for_scheduled_for = v.scheduled_for))`;
  for (const t of stale) await tx`update public.compliance_tasks set status = 'done', done_at = now(), note = 'notice recorded, visit moved or match gone' where id = ${t.id}`;
  return created;
}

/**
 * The compliance job for one tenant: records for completed pesticide visits without one, locks when due, notices for
 * recent completions and scheduled registry matches, then the tasks. Idempotent: a second run creates nothing.
 */
export async function runCompliance(tx: Sql, tenantId: string, timeZone: string, now = new Date()): Promise<RunCounts> {
  const counts: RunCounts = { records: 0, locked: 0, notices: 0, tasks: 0 };
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const pesticideKinds = [...PESTICIDE_JOB_KINDS];
  const withoutRecord = await tx<{ id: string }[]>`
    select v.id from public.visits v join public.service_types st on st.id = v.service_type_id
    where v.tenant_id = ${tenantId} and v.status = 'completed' and st.job_kind = any(${pesticideKinds}::text[])
      and not exists (select 1 from public.application_records r where r.visit_id = v.id)
    order by v.completed_at`;
  for (const v of withoutRecord) {
    const made = await ensureRecord(tx, tenantId, v.id, timeZone);
    if (made?.created) counts.records += 1;
  }
  counts.locked = await lockDueRecords(tx, tenantId, timeZone, now);
  const recent = await tx<{ id: string }[]>`
    select id from public.visits where tenant_id = ${tenantId}
      and ((status = 'completed' and completed_at >= ${since}) or (status = 'scheduled' and exists (select 1 from public.properties p where p.id = visits.property_id and p.registry_matches <> '{}'::jsonb)))`;
  for (const v of recent) counts.notices += await createNotices(tx, tenantId, await noticesForVisit(tx, tenantId, v.id, timeZone));
  counts.tasks += await refreshNoticeTasks(tx, tenantId, timeZone, now);
  counts.tasks += await refreshAlertTasks(tx, tenantId, todayInZone(timeZone));
  return counts;
}
