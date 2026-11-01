// The import itself (spec 10): files in dependency order, every row checked, references resolved by old-system id,
// mid-term agreements brought across at the cutover, opening balances as invoices. One function does a dry run and a
// commit; the dry run is the same work in a transaction that is rolled back, so the preview cannot drift.
import type postgres from "postgres";
import { syncVisits } from "@/lib/agreements/db";
import { planVisits } from "@/lib/agreements/visits";
import { createInvoice } from "@/lib/billing/db";
import { fromTenantLocal } from "@/lib/dates";
import { MAX_IMPORT_FILE_BYTES, putFile } from "@/lib/files";
import type { GeoProvider, GeoResult } from "@/lib/geo/provider";
import { postOpening } from "@/lib/ledger/db";
import { defaultBilledToDate, deliveredCents, doneBeforeCutover, openingPosition } from "./cutover";
import { type RowError, readFile } from "./parse";
import { IMPORT_KINDS, type ImportKind } from "./templates";
import { planInputOf, validateAccount, validateAgreement, validateBalance, validateContact, validateProperty } from "./validate";

type Sql = postgres.Sql | postgres.TransactionSql;

export type FileSummary = { rows: number; created: number; skipped: number; errors: number };
export type ImportReport = { summary: Partial<Record<ImportKind, FileSummary>>; errors: RowError[]; warnings: RowError[] };
export type ImportInput = {
  /** CSV text per template present in the batch. */
  files: Partial<Record<ImportKind, string>>;
  cutoverOn: string;
  timeZone: string;
  batchId: string;
  geocoder: GeoProvider;
};

function addressColumns(geo: GeoResult) {
  return {
    line1: geo.line1,
    line2: geo.line2,
    city: geo.city,
    state_code: geo.stateCode,
    postal_code: geo.postalCode,
    normalized_address: geo.normalizedAddress,
    county: geo.county,
    lat: geo.lat,
    lng: geo.lng,
    geocode_status: geo.status,
  };
}

/** Runs the import inside the caller's transaction and answers what it did, row by row. */
export async function runImport(tx: Sql, tenantId: string, input: ImportInput): Promise<ImportReport> {
  const errors: RowError[] = [];
  const warnings: RowError[] = [];
  const summary: Partial<Record<ImportKind, FileSummary>> = {};
  const rows = Object.fromEntries(
    IMPORT_KINDS.filter((k) => input.files[k] !== undefined).map((k) => {
      const read = readFile(k, input.files[k] as string);
      errors.push(...read.errors);
      summary[k] = { rows: read.rows.length, created: 0, skipped: 0, errors: read.errors.length };
      return [k, read.rows];
    }),
  ) as Partial<Record<ImportKind, ReturnType<typeof readFile>["rows"]>>;
  const fail = (file: ImportKind, row: number, column: string | null, message: string) => {
    errors.push({ file, row, column, message });
    (summary[file] as FileSummary).errors += 1;
  };
  const warn = (file: ImportKind, row: number, column: string | null, message: string) => warnings.push({ file, row, column, message });

  // Old-system ids resolve to this batch's rows first, then to earlier imports.
  const accounts = new Map<string, string>();
  const properties = new Map<string, { id: string; account_id: string }>();
  const accountByExt = async (ext: string): Promise<string | null> => {
    if (accounts.has(ext)) return accounts.get(ext) as string;
    const [row] = await tx<{ id: string }[]>`select id from public.accounts where tenant_id = ${tenantId} and external_id = ${ext}`;
    if (row) accounts.set(ext, row.id);
    return row?.id ?? null;
  };
  const propertyByExt = async (ext: string): Promise<{ id: string; account_id: string } | null> => {
    if (properties.has(ext)) return properties.get(ext) as { id: string; account_id: string };
    const [row] = await tx<{ id: string; account_id: string }[]>`select id, account_id from public.properties where tenant_id = ${tenantId} and external_id = ${ext}`;
    if (row) properties.set(ext, row);
    return row ?? null;
  };
  const once = (file: ImportKind) => {
    const seen = new Set<string>();
    return (ext: string, row: number): boolean => {
      if (seen.has(ext)) {
        fail(file, row, "external_id", `${ext} appears twice in this file`);
        return false;
      }
      seen.add(ext);
      return true;
    };
  };

  // Accounts.
  const newAccounts: string[] = [];
  const firstAccount = once("accounts");
  for (const row of rows.accounts ?? []) {
    const checked = validateAccount(row);
    if (!checked.value) {
      for (const e of checked.errors) fail("accounts", row.row, e.column, e.message);
      continue;
    }
    const a = checked.value;
    if (!firstAccount(a.external_id, row.row)) continue;
    if (await accountByExt(a.external_id)) {
      (summary.accounts as FileSummary).skipped += 1;
      continue;
    }
    const [made] = await tx<{ id: string }[]>`
      insert into public.accounts ${tx({
        tenant_id: tenantId,
        external_id: a.external_id,
        type: a.type,
        name: a.name,
        email: a.email,
        phone: a.phone,
        terms_days: a.terms_days,
        po_required: a.po_required,
        billing_line1: a.billing_line1,
        billing_city: a.billing_city,
        billing_state_code: a.billing_state_code,
        billing_postal_code: a.billing_postal_code,
        notes: a.notes,
      })} returning id`;
    accounts.set(a.external_id, made.id);
    newAccounts.push(made.id);
    (summary.accounts as FileSummary).created += 1;
  }

  // Properties.
  const firstProperty = once("properties");
  for (const row of rows.properties ?? []) {
    const checked = validateProperty(row);
    if (!checked.value) {
      for (const e of checked.errors) fail("properties", row.row, e.column, e.message);
      continue;
    }
    const p = checked.value;
    if (!firstProperty(p.external_id, row.row)) continue;
    const accountId = await accountByExt(p.account_external_id);
    if (!accountId) {
      fail("properties", row.row, "account_external_id", `no account ${p.account_external_id} in this batch or an earlier import`);
      continue;
    }
    const existing = await propertyByExt(p.external_id);
    if (existing) {
      if (existing.account_id !== accountId) fail("properties", row.row, "account_external_id", `${p.external_id} was imported for another account`);
      else (summary.properties as FileSummary).skipped += 1;
      continue;
    }
    const geo = await input.geocoder.normalize({ line1: p.line1, line2: p.line2, city: p.city, stateCode: p.state_code, postalCode: p.postal_code });
    const [twin] = await tx<{ id: string }[]>`select id from public.properties where tenant_id = ${tenantId} and normalized_address = ${geo.normalizedAddress} and archived_at is null limit 1`;
    if (twin) warn("properties", row.row, "line1", `${geo.normalizedAddress} matches a property already in Bugsy; imported anyway`);
    const [made] = await tx<{ id: string }[]>`
      insert into public.properties ${tx({
        tenant_id: tenantId,
        account_id: accountId,
        external_id: p.external_id,
        name: p.name,
        property_type: p.property_type,
        size_sqft: p.size_sqft,
        lot_sqft: p.lot_sqft,
        unit_count: p.unit_count,
        access_notes: p.access_notes,
        measured_by: p.size_sqft ? "manual" : null,
        ...addressColumns(geo),
      })} returning id`;
    properties.set(p.external_id, { id: made.id, account_id: accountId });
    (summary.properties as FileSummary).created += 1;
  }
  // An account with no billing address of its own is billed at its first service address, as the new account form does.
  if (newAccounts.length) {
    await tx`
      update public.accounts a set billing_line1 = p.line1, billing_line2 = p.line2, billing_city = p.city, billing_state_code = p.state_code, billing_postal_code = p.postal_code
      from (select distinct on (account_id) account_id, line1, line2, city, state_code, postal_code from public.properties where tenant_id = ${tenantId} and account_id = any(${newAccounts}::uuid[]) order by account_id, created_at) p
      where a.id = p.account_id and a.billing_line1 is null`;
  }

  // Contacts.
  const firstContact = once("contacts");
  for (const row of rows.contacts ?? []) {
    const checked = validateContact(row);
    if (!checked.value) {
      for (const e of checked.errors) fail("contacts", row.row, e.column, e.message);
      continue;
    }
    const c = checked.value;
    if (c.external_id && !firstContact(c.external_id, row.row)) continue;
    const accountId = c.account_external_id ? await accountByExt(c.account_external_id) : null;
    if (c.account_external_id && !accountId) {
      fail("contacts", row.row, "account_external_id", `no account ${c.account_external_id} in this batch or an earlier import`);
      continue;
    }
    const property = c.property_external_id ? await propertyByExt(c.property_external_id) : null;
    if (c.property_external_id && !property) {
      fail("contacts", row.row, "property_external_id", `no property ${c.property_external_id} in this batch or an earlier import`);
      continue;
    }
    if (accountId && property && property.account_id !== accountId) {
      fail("contacts", row.row, "property_external_id", `${c.property_external_id} belongs to another account`);
      continue;
    }
    const [existing] = c.external_id
      ? await tx<{ id: string }[]>`select id from public.contacts where tenant_id = ${tenantId} and external_id = ${c.external_id}`
      : await tx<{ id: string }[]>`
          select id from public.contacts where tenant_id = ${tenantId} and lower(name) = lower(${c.name})
            and account_id is not distinct from ${accountId}::uuid and property_id is not distinct from ${property?.id ?? null}::uuid limit 1`;
    if (existing) {
      (summary.contacts as FileSummary).skipped += 1;
      continue;
    }
    const consentAt = c.notice_consent_on ? fromTenantLocal(`${c.notice_consent_on}T12:00`, input.timeZone) : null;
    await tx`insert into public.contacts ${tx({
      tenant_id: tenantId,
      external_id: c.external_id,
      account_id: accountId,
      property_id: property?.id ?? null,
      name: c.name,
      role: c.role,
      email: c.email,
      phone: c.phone,
      sms_opt_in: c.sms_opt_in,
      preferred_channel: c.preferred_channel,
      e_notice_consent_at: consentAt,
      e_notice_consent_note: consentAt ? c.notice_consent_note : null,
    })}`;
    (summary.contacts as FileSummary).created += 1;
  }

  // Agreements: active, signed by import, with the visits the old system did and the billing it sent.
  const firstAgreement = once("agreements");
  const [tenant] = await tx<{ agreement_terms: string | null }[]>`select agreement_terms from public.tenants where id = ${tenantId}`;
  for (const row of rows.agreements ?? []) {
    const checked = validateAgreement(row, input.cutoverOn);
    if (!checked.value) {
      for (const e of checked.errors) fail("agreements", row.row, e.column, e.message);
      continue;
    }
    const g = checked.value;
    if (!firstAgreement(g.external_id, row.row)) continue;
    const accountId = await accountByExt(g.account_external_id);
    const property = await propertyByExt(g.property_external_id);
    if (!accountId) {
      fail("agreements", row.row, "account_external_id", `no account ${g.account_external_id} in this batch or an earlier import`);
      continue;
    }
    if (!property) {
      fail("agreements", row.row, "property_external_id", `no property ${g.property_external_id} in this batch or an earlier import`);
      continue;
    }
    if (property.account_id !== accountId) {
      fail("agreements", row.row, "property_external_id", `${g.property_external_id} belongs to another account`);
      continue;
    }
    const [serviceType] = await tx<{ id: string }[]>`select id from public.service_types where tenant_id = ${tenantId} and lower(name) = lower(${g.service_type}) and archived_at is null`;
    if (!serviceType) {
      fail("agreements", row.row, "service_type", `no service type named "${g.service_type}" in the catalog`);
      continue;
    }
    const [existing] = await tx<{ id: string }[]>`select id from public.agreements where tenant_id = ${tenantId} and external_id = ${g.external_id}`;
    if (existing) {
      (summary.agreements as FileSummary).skipped += 1;
      continue;
    }
    const planned = planVisits(planInputOf(g.columns));
    const done = doneBeforeCutover(planned, g.last_service_on);
    const defaultBilled = defaultBilledToDate(g.columns, planned, done, input.cutoverOn);
    const billed = g.billed_to_date_cents ?? defaultBilled;
    if (g.billed_to_date_cents !== null && g.billed_to_date_cents !== defaultBilled) {
      warn("agreements", row.row, "billed_to_date", `billed to date ${(billed / 100).toFixed(2)} differs from the schedule's ${(defaultBilled / 100).toFixed(2)}; the file's figure is used`);
    }
    const [made] = await tx<{ id: string; number: number; ends_on: string }[]>`
      insert into public.agreements ${tx({
        tenant_id: tenantId,
        account_id: accountId,
        property_id: property.id,
        service_type_id: serviceType.id,
        external_id: g.external_id,
        status: "active",
        ...g.columns,
        cadence_rule: tx.json(g.columns.cadence_rule),
        terms_text: tenant?.agreement_terms ?? null,
        signed_at: new Date(),
        signed_name: "Imported at go-live",
        cutover_on: input.cutoverOn,
        imported_billed_cents: billed,
        import_batch_id: input.batchId,
      })} returning id, number, ends_on`;
    for (const v of done) {
      await tx`
        insert into public.visits (tenant_id, agreement_id, account_id, property_id, service_type_id, kind, sequence, due_start, due_end, price_cents, interior_only, status, imported)
        values (${tenantId}, ${made.id}, ${accountId}, ${property.id}, ${serviceType.id}, ${v.kind}, ${v.sequence}, ${v.due_start}, ${v.due_end}, ${v.price_cents}, ${v.interior_only}, 'completed', true)`;
    }
    await syncVisits(tx, tenantId, made.id);
    if (made.ends_on < input.cutoverOn) {
      await tx`update public.agreements set status = 'ended' where id = ${made.id}`;
      warn("agreements", row.row, "starts_on", `the term ended ${made.ends_on}, before go-live; imported as ended`);
    }
    if (openingPosition(billed, done) !== 0) {
      // A cutover in a closed month posts on the first open day after it (edge case; spec 09 rule 9).
      const [{ day }] = await tx<{ day: string }[]>`select app.first_open_day(${tenantId}, ${input.cutoverOn})::text as day`;
      if (day !== input.cutoverOn) warn("agreements", row.row, "billed_to_date", `the ledger is closed for ${input.cutoverOn.slice(0, 7)}; the opening position posts on ${day}`);
      await postOpening(tx, tenantId, { agreement_id: made.id, billed_cents: billed, recognized_cents: deliveredCents(done), as_of: day });
    }
    (summary.agreements as FileSummary).created += 1;
  }

  // Opening balances: one opening invoice, or credit memo, per row (rule 11).
  for (const row of rows.balances ?? []) {
    const checked = validateBalance(row);
    if (!checked.value) {
      for (const e of checked.errors) fail("balances", row.row, e.column, e.message);
      continue;
    }
    const b = checked.value;
    const accountId = await accountByExt(b.account_external_id);
    if (!accountId) {
      fail("balances", row.row, "account_external_id", `no account ${b.account_external_id} in this batch or an earlier import`);
      continue;
    }
    const sourceKey = `opening:${accountId}:${b.reference ?? `${b.as_of}:${b.amount_cents}`}`;
    const [existing] = await tx<{ id: string }[]>`select id from public.invoices where tenant_id = ${tenantId} and source_key = ${sourceKey}`;
    if (existing) {
      (summary.balances as FileSummary).skipped += 1;
      continue;
    }
    const label = `Opening balance${b.reference ? ` ${b.reference}` : ""}${b.memo ? `: ${b.memo}` : ""}`;
    await createInvoice(tx, tenantId, {
      kind: b.amount_cents < 0 ? "credit_memo" : "invoice",
      account_id: accountId,
      property_id: null,
      source: "opening",
      source_key: sourceKey,
      issued_on: b.as_of,
      due_on: b.due_on,
      external_ref: b.reference,
      memo: b.memo,
      lines: [{ description: label, amount_cents: b.amount_cents, kind: "opening" }],
      issue: true,
    });
    (summary.balances as FileSummary).created += 1;
  }
  return { summary, errors, warnings };
}

export type UploadedFile = { name: string; contentType: string; data: Uint8Array };
export type BatchInput = Omit<ImportInput, "batchId" | "files"> & {
  templates: Partial<Record<ImportKind, UploadedFile>>;
  history: { file: UploadedFile; label: string | null }[];
  mode: "dry_run" | "commit";
};
export type BatchResult = { batch_id: string; status: "dry_run" | "committed" | "failed"; report: ImportReport };

class Rollback extends Error {
  constructor(readonly report: ImportReport) {
    super("rollback");
  }
}

const MAX_STORED = 500;

/** A dry run or a commit (rule 6): the import runs in one transaction, kept only for a clean commit; the report is stored either way. */
export async function importBatch(run: <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) => Promise<T>, tenantId: string, input: BatchInput): Promise<BatchResult> {
  const batchId = crypto.randomUUID();
  // Every upload is checked before anything runs, in both modes, so a dry run cannot pass what the commit refuses.
  const uploadErrors: RowError[] = [];
  for (const [kind, f] of Object.entries(input.templates) as [ImportKind, UploadedFile][]) {
    if (f.data.byteLength > MAX_IMPORT_FILE_BYTES) uploadErrors.push({ file: kind, row: 0, column: null, message: `${f.name} is larger than 20 MB` });
  }
  for (const h of input.history) {
    if (h.file.data.byteLength < 1 || h.file.data.byteLength > MAX_IMPORT_FILE_BYTES) uploadErrors.push({ file: "upload", row: 0, column: null, message: `${h.file.name} must be between 1 byte and 20 MB` });
  }
  const files = Object.fromEntries(Object.entries(input.templates).map(([k, f]) => [k, new TextDecoder("utf-8").decode((f as UploadedFile).data)])) as Partial<Record<ImportKind, string>>;
  const record = async (tx: Sql, status: BatchResult["status"], report: ImportReport) => {
    await tx`
      insert into public.import_batches (id, tenant_id, status, cutover_on, summary, errors, warnings)
      values (${batchId}, ${tenantId}, ${status}, ${input.cutoverOn}, ${tx.json(report.summary as postgres.JSONValue)}, ${tx.json(report.errors.slice(0, MAX_STORED) as unknown as postgres.JSONValue)}, ${tx.json(report.warnings.slice(0, MAX_STORED) as unknown as postgres.JSONValue)})`;
  };
  try {
    const report = await run(async (tx) => {
      let r: ImportReport;
      try {
        r = await runImport(tx, tenantId, { files, cutoverOn: input.cutoverOn, timeZone: input.timeZone, batchId, geocoder: input.geocoder });
      } catch (err) {
        // Whatever the database refused that the row checks did not catch still ends in a stored report (rule 6).
        const e = err as { message?: string; code?: string };
        if (e.code === "42501") throw err;
        r = { summary: {}, errors: [{ file: "upload", row: 0, column: null, message: `the import stopped: ${e.message ?? "unknown error"}` }], warnings: [] };
      }
      r.errors.unshift(...uploadErrors);
      if (input.mode === "dry_run" || r.errors.length) throw new Rollback(r);
      await record(tx, "committed", r);
      for (const [kind, f] of Object.entries(input.templates) as [ImportKind, UploadedFile][]) {
        const fileId = await putFile(tx, tenantId, { kind: "import", contentType: "text/csv", data: f.data });
        await tx`insert into public.import_files (tenant_id, batch_id, file_id, kind, file_name, label) values (${tenantId}, ${batchId}, ${fileId}, 'template', ${f.name}, ${kind})`;
      }
      for (const h of input.history) {
        const fileId = await putFile(tx, tenantId, { kind: "import", contentType: h.file.contentType || "application/octet-stream", data: h.file.data });
        await tx`insert into public.import_files (tenant_id, batch_id, file_id, kind, file_name, label) values (${tenantId}, ${batchId}, ${fileId}, 'history', ${h.file.name}, ${h.label})`;
      }
      return r;
    });
    return { batch_id: batchId, status: "committed", report };
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
    const status = input.mode === "dry_run" ? "dry_run" : "failed";
    await run((tx) => record(tx, status, err.report));
    return { batch_id: batchId, status, report: err.report };
  }
}
