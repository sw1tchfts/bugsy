"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { str } from "@/lib/customers/forms";
import { isIsoDate } from "@/lib/dates";
import { errorCode } from "@/lib/db";
import { geoProvider } from "@/lib/geo/provider";
import { type UploadedFile, importBatch } from "@/lib/import/db";
import { IMPORT_KINDS, type ImportKind } from "@/lib/import/templates";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

const HOME = "/settings/import";

/** The permission each file's rows need (rule 14). */
const NEEDS: Record<ImportKind, string[]> = {
  accounts: ["customers.write"],
  properties: ["customers.write"],
  contacts: ["customers.write"],
  agreements: ["agreements.write", "gl.write"],
  balances: ["billing.write", "gl.write"],
};

async function upload(value: FormDataEntryValue | null): Promise<UploadedFile | null> {
  if (!value || typeof value === "string" || value.size === 0) return null;
  return { name: value.name, contentType: value.type, data: new Uint8Array(await value.arrayBuffer()) };
}

/** A dry run or a commit of the uploaded files (rule 6). */
export async function runImportAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const mode = str(formData, "mode") === "commit" ? "commit" : "dry_run";
  const cutoverOn = str(formData, "cutover_on");
  const { session } = await requirePermission(tenantId, "data.import");
  const { active } = await requireActiveTenant();
  if (!isIsoDate(cutoverOn)) redirect(`${HOME}?error=${encodeURIComponent("The go-live date is a date.")}`);
  const templates: Partial<Record<ImportKind, UploadedFile>> = {};
  for (const kind of IMPORT_KINDS) {
    const f = await upload(formData.get(kind));
    if (f) templates[kind] = f;
  }
  const history: { file: UploadedFile; label: string | null }[] = [];
  for (const value of formData.getAll("history")) {
    const f = await upload(value);
    if (f) history.push({ file: f, label: str(formData, "history_label") || null });
  }
  if (Object.keys(templates).length === 0 && history.length === 0) redirect(`${HOME}?error=${encodeURIComponent("Pick at least one file.")}`);
  const missing = (Object.keys(templates) as ImportKind[]).flatMap((k) => NEEDS[k].filter((p) => !can(active.permissions, p)).map((p) => `${k} needs ${p}`));
  if (missing.length) redirect(`${HOME}?error=${encodeURIComponent(`Your role cannot import this: ${missing.join("; ")}.`)}`);
  let batchId: string | null = null;
  let error: string | null = null;
  try {
    const result = await importBatch((fn) => dbAs(session, fn), tenantId, { templates, history, mode, cutoverOn, timeZone: active.tenantTimezone, geocoder: geoProvider() });
    batchId = result.batch_id;
  } catch (err) {
    error = errorCode(err);
  }
  revalidatePath(HOME);
  if (!batchId) redirect(`${HOME}?error=${encodeURIComponent(error ?? "failed")}`);
  redirect(`${HOME}/${batchId}`);
}
