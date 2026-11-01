"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { dbAs, requireMembership, requirePermission } from "@/lib/auth/session";
import { createNotices, lockRecord, noticesForVisit, refreshAlertTasks, runCompliance } from "@/lib/compliance/db";
import { type Amendment, applyAmendments, readPath } from "@/lib/compliance/records";
import { parseRegistryCsv } from "@/lib/compliance/registry";
import { getStatePack } from "@/lib/compliance/rules";
import { intOrNull, opt, str } from "@/lib/customers/forms";
import { fromTenantLocal, isIsoDate, todayInZone } from "@/lib/dates";
import { errorCode } from "@/lib/db";
import { putFile } from "@/lib/files";
import { normalizeStateCode } from "@/lib/geo/normalize";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

const HOME = "/compliance";

/** "Header=field" lines (or a JSON object) from the import form, as the parser's mapping; null when empty. */
function parseMapping(text: string | null): Record<string, string> | null {
  if (!text?.trim()) return null;
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "string") as [string, string][]);
    } catch {
      return null;
    }
  }
  const mapping: Record<string, string> = {};
  for (const line of trimmed.split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at > 0) mapping[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return Object.keys(mapping).length ? mapping : null;
}

function go(path: string, params: Record<string, string | null | undefined>): never {
  revalidatePath(HOME);
  revalidatePath(path.split("?")[0]);
  revalidatePath("/dispatch");
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) query.set(k, v);
  const q = query.toString();
  redirect(`${path}${q ? `?${q}` : ""}`);
}

/** Runs the compliance job for this company now. */
export async function runComplianceNow(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "compliance.write");
  const { active } = await requireActiveTenant();
  let note: string | null = null;
  let error: string | null = null;
  try {
    const counts = await dbAs(session, (tx) => runCompliance(tx, tenantId, active.tenantTimezone));
    note = `Job run: ${counts.records} record(s) created, ${counts.locked} locked, ${counts.notices} notice(s), ${counts.tasks} task(s).`;
  } catch (err) {
    error = errorCode(err);
  }
  go(HOME, { note, error });
}

/** Locks a draft record before its due time. */
export async function lockRecordNow(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const recordId = str(formData, "record_id");
  const { session } = await requirePermission(tenantId, "compliance.write");
  const { active } = await requireActiveTenant();
  let error: string | null = null;
  try {
    const locked = await dbAs(session, (tx) => lockRecord(tx, tenantId, recordId, active.tenantTimezone, session.userId));
    if (!locked) error = "This record is already locked.";
  } catch (err) {
    error = errorCode(err);
  }
  go(`${HOME}/records/${recordId}`, { error });
}

/** Parses a typed amendment value against the field's current type: numbers stay numbers, lists split on commas. */
function parseValue(current: unknown, typed: string): unknown {
  if (typeof current === "number") {
    const n = Number(typed);
    return Number.isNaN(n) ? typed : n;
  }
  if (typeof current === "boolean") return typed === "true";
  if (Array.isArray(current)) return typed.split(",").map((s) => s.trim()).filter(Boolean);
  if (current === null && typed.trim() === "") return null;
  return typed;
}

/** Files an amendment on a locked record: one field, its old and new value, and the reason. */
export async function amendRecord(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const recordId = str(formData, "record_id");
  const field = str(formData, "field").trim();
  const typed = str(formData, "new_value");
  const reason = str(formData, "reason").trim();
  const { session } = await requirePermission(tenantId, "compliance.write");
  let error: string | null = null;
  if (!field) error = "Name the field to amend, for example conditions.wind_mph or products.0.amount.";
  else if (!reason) error = "An amendment needs a reason.";
  else {
    try {
      await dbAs(session, async (tx) => {
        const [record] = await tx<{ snapshot: Record<string, unknown>; status: string }[]>`select snapshot, status from public.application_records where id = ${recordId} and tenant_id = ${tenantId}`;
        if (!record) throw Object.assign(new Error("record not found"), { code: "23514" });
        if (record.status !== "locked") throw Object.assign(new Error("only a locked record takes amendments; a draft is re-snapshotted at lock"), { code: "23514" });
        const amendments = await tx<Amendment[]>`select changed_fields from public.application_record_amendments where tenant_id = ${tenantId} and record_id = ${recordId} order by created_at`;
        const current = applyAmendments(record.snapshot, amendments);
        const from = readPath(current, field);
        const to = parseValue(from, typed);
        await tx`insert into public.application_record_amendments (tenant_id, record_id, changed_fields, reason, author_id)
                 values (${tenantId}, ${recordId}, ${tx.json({ [field]: { from: from ?? null, to } })}, ${reason}, ${session.userId})`;
      });
    } catch (err) {
      error = errorCode(err);
    }
  }
  go(`${HOME}/records/${recordId}`, { error });
}

const PROOF_CHANNELS = ["print", "mail", "phone", "posted", "email", "sms"] as const;

/** Records that a notice went out by hand: printed, mailed, called or posted, with when and by whom. */
export async function recordNoticeProof(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const noticeId = str(formData, "notice_id");
  const channel = str(formData, "channel");
  const note = opt(formData, "note");
  const spokeWith = opt(formData, "spoke_with");
  const sentWall = opt(formData, "sent_at");
  const returnTo = opt(formData, "return_to") ?? `${HOME}/notices/${noticeId}`;
  const { session, membership } = await requireMembership(tenantId);
  if (!can(membership.permissions, "compliance.write") && !can(membership.permissions, "dispatch.write")) go(returnTo, { error: "forbidden" });
  const { active } = await requireActiveTenant();
  let error: string | null = null;
  if (!(PROOF_CHANNELS as readonly string[]).includes(channel)) error = "Pick how the notice went out.";
  else {
    const sentAt = sentWall ? fromTenantLocal(sentWall, active.tenantTimezone) : new Date();
    if (!sentAt) error = "The time it went out does not parse.";
    else {
      try {
        const result = await dbAs(session, (tx) =>
          tx`update public.notices set status = 'sent', channel = ${channel}, sent_at = ${sentAt},
               proof = ${tx.json({ method: channel, recorded_by: session.userId, recorded_at: new Date().toISOString(), note, spoke_with: spokeWith })}
             where id = ${noticeId} and tenant_id = ${tenantId} and status in ('due', 'failed')`,
        );
        if (result.count === 0) error = "This notice is already sent or waived.";
      } catch (err) {
        error = errorCode(err);
      }
    }
  }
  go(returnTo, { error });
}

/** Waives a notice with a reason: it was not required after all, or could not be delivered for a documented reason. */
export async function waiveNotice(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const noticeId = str(formData, "notice_id");
  const reason = str(formData, "reason").trim();
  const { session } = await requirePermission(tenantId, "compliance.write");
  let error: string | null = null;
  if (!reason) error = "A waiver needs a reason.";
  else {
    try {
      const result = await dbAs(session, (tx) => tx`update public.notices set status = 'waived', waived_reason = ${reason} where id = ${noticeId} and tenant_id = ${tenantId} and status in ('due', 'failed')`);
      if (result.count === 0) error = "This notice is already sent or waived.";
    } catch (err) {
      error = errorCode(err);
    }
  }
  go(`${HOME}/notices/${noticeId}`, { error });
}

/** Imports a state's registry file: the rows of that (state, kind, year) are replaced and every property re-matched. */
export async function importRegistry(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const state = normalizeStateCode(str(formData, "state_code"));
  const kind = opt(formData, "registry_kind") ?? "general";
  const year = intOrNull(formData, "registry_year");
  const file = formData.get("file");
  const pasted = opt(formData, "csv_text");
  const { session } = await requirePermission(tenantId, "compliance.write");
  let error: string | null = null;
  let note: string | null = null;
  if (!state) error = "Pick the state the registry belongs to.";
  else if (!year) error = "The registry year is required.";
  else {
    const text = file instanceof File && file.size > 0 ? await file.text() : (pasted ?? "");
    if (!text.trim()) error = "Upload the registry file or paste its rows.";
    else {
      // Header mapping: the form's "Header=field" lines, else the state pack's file layout, else the parser's own synonyms.
      const mapping = parseMapping(opt(formData, "mapping")) ?? getStatePack(state)?.rules["registry.fileFormat"]?.value;
      const parsed = parseRegistryCsv(text, state, mapping);
      if (parsed.rows.length === 0) error = parsed.errors.map((e) => `line ${e.line}: ${e.message}`).join("; ") || "No rows found.";
      else {
        try {
          const changed = await dbAs(session, async (tx) => {
            const sourceId = await putFile(tx, tenantId, { kind: "document", contentType: "text/csv", data: new TextEncoder().encode(text) });
            // Unchanged entries keep their ids (and the notices that name them); only entries missing from the file are dropped.
            for (const r of parsed.rows) {
              await tx`insert into public.notification_registries ${tx({ tenant_id: tenantId, state_code: state, registry_kind: kind, registry_year: year, ...r, source_file_id: sourceId })}
                       on conflict (tenant_id, state_code, registry_kind, registry_year, row_hash) do update
                       set imported_at = now(), source_file_id = excluded.source_file_id, line1 = excluded.line1, line2 = excluded.line2, city = excluded.city,
                           postal_code = excluded.postal_code, notes = excluded.notes`;
            }
            const hashes = parsed.rows.map((r) => r.row_hash);
            await tx`delete from public.notification_registries where tenant_id = ${tenantId} and state_code = ${state} and registry_kind = ${kind} and registry_year = ${year} and row_hash <> all(${hashes}::text[])`;
            const [{ changed }] = await tx<{ changed: number }[]>`select app.rematch_registry_state(${tenantId}, ${state}) as changed`;
            return changed;
          });
          note = `${parsed.rows.length} registry row(s) loaded for ${state} ${kind} ${year}; ${changed} propert${changed === 1 ? "y" : "ies"} changed their matches.${parsed.errors.length ? ` Skipped: ${parsed.errors.map((e) => `line ${e.line} (${e.message})`).join(", ")}.` : ""}`;
        } catch (err) {
          error = errorCode(err);
        }
      }
    }
  }
  go(`${HOME}/registries`, { error, note });
}

/** Re-runs address matching for one state, for example after properties were edited in bulk. */
export async function rematchRegistry(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const state = normalizeStateCode(str(formData, "state_code"));
  const { session } = await requirePermission(tenantId, "compliance.write");
  let error: string | null = null;
  let note: string | null = null;
  if (!state) error = "Pick a state.";
  else {
    try {
      const [{ changed }] = await dbAs(session, (tx) => tx<{ changed: number }[]>`select app.rematch_registry_state(${tenantId}, ${state}) as changed`);
      note = `${changed} propert${changed === 1 ? "y" : "ies"} changed their ${state} registry matches.`;
    } catch (err) {
      error = errorCode(err);
    }
  }
  go(`${HOME}/registries`, { error, note });
}

async function setTask(formData: FormData, status: "done" | "dismissed") {
  const tenantId = str(formData, "tenant_id");
  const taskId = str(formData, "task_id");
  const note = opt(formData, "note");
  const returnTo = opt(formData, "return_to") ?? HOME;
  const { session, membership } = await requireMembership(tenantId);
  if (!can(membership.permissions, "compliance.write") && !can(membership.permissions, "dispatch.write")) go(returnTo, { error: "forbidden" });
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`update public.compliance_tasks set status = ${status}, done_at = now(), done_by = ${session.userId}, note = ${note} where id = ${taskId} and tenant_id = ${tenantId} and status = 'open'`);
  } catch (err) {
    error = errorCode(err);
  }
  go(returnTo, { error });
}

export async function completeTask(formData: FormData) {
  await setTask(formData, "done");
}

export async function dismissTask(formData: FormData) {
  await setTask(formData, "dismissed");
}

/** A branch's business license number, year and expiry; the licensed manager keeps these, so a database function does the write. */
export async function saveBranchLicense(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const branchId = str(formData, "branch_id");
  const number = opt(formData, "business_license_number");
  const year = intOrNull(formData, "license_year");
  const expires = opt(formData, "license_expires_on");
  const { session } = await requirePermission(tenantId, "compliance.write");
  const { active } = await requireActiveTenant();
  let error: string | null = null;
  if (expires && !isIsoDate(expires)) error = "The expiry is a date.";
  else {
    try {
      await dbAs(session, async (tx) => {
        await tx`select app.set_branch_license(${tenantId}, ${branchId}, ${number}, ${year}, ${expires})`;
        // A renewal closes its alert right away rather than at the next job run.
        await refreshAlertTasks(tx, tenantId, todayInZone(active.tenantTimezone));
      });
    } catch (err) {
      error = errorCode(err);
    }
  }
  go(`${HOME}/licenses`, { error });
}

/** From the dispatch visit page: the advance notice to every registry match for a date, recorded as sent with proof. */
export async function recordRegistryNotice(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const visitId = str(formData, "visit_id");
  const forDate = str(formData, "for_date");
  const channel = str(formData, "channel");
  const note = opt(formData, "note");
  const spokeWith = opt(formData, "spoke_with");
  const here = `/dispatch/visits/${visitId}`;
  const { session, membership } = await requireMembership(tenantId);
  if (!can(membership.permissions, "compliance.write") && !can(membership.permissions, "dispatch.write")) go(here, { error: "forbidden" });
  const { active } = await requireActiveTenant();
  let error: string | null = null;
  let note2: string | null = null;
  if (!isIsoDate(forDate)) error = "Pick the date the visit will happen.";
  else if (!(PROOF_CHANNELS as readonly string[]).includes(channel)) error = "Pick how the notice went out.";
  else {
    try {
      const sent = await dbAs(session, async (tx) => {
        const specs = (await noticesForVisit(tx, tenantId, visitId, active.tenantTimezone, { scheduledFor: forDate })).filter((s) => s.kind === "registry_advance");
        if (specs.length === 0) return 0;
        await createNotices(tx, tenantId, specs);
        const keys = specs.map((s) => s.dedupe_key);
        const result = await tx`
          update public.notices set status = 'sent', channel = ${channel}, sent_at = now(),
            proof = ${tx.json({ method: channel, recorded_by: session.userId, recorded_at: new Date().toISOString(), note, spoke_with: spokeWith })}
          where tenant_id = ${tenantId} and dedupe_key = any(${keys}::text[]) and status in ('due', 'failed')`;
        return result.count;
      });
      note2 = sent === 0 ? "This property has no registry matches; nothing to record." : `Advance notice recorded for ${forDate} (${sent} registry address${sent === 1 ? "" : "es"}). The visit can be scheduled for that date.`;
    } catch (err) {
      error = errorCode(err);
    }
  }
  go(here, { error, warn: note2 });
}
