"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { str } from "@/lib/customers/forms";
import { errorCode } from "@/lib/db";
import { checkDefinition } from "@/lib/reports/builder";
import { datasetFor } from "@/lib/reports/datasets";
import { definitionFromFields, fieldsFromDefinition } from "@/lib/reports/form";

const HOME = "/reports/custom";

function go(path: string, params: Record<string, string | null | undefined> | URLSearchParams = {}): never {
  revalidatePath(HOME);
  revalidatePath(path.split("?")[0]);
  const query = params instanceof URLSearchParams ? params : new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])));
  const q = query.toString();
  redirect(`${path}${q ? `?${q}` : ""}`);
}

/** Saves the builder's definition: a new report, or the author's own report updated in place (rules 9 and 11). */
export async function saveReport(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session, membership } = await requirePermission(tenantId, "reports.read");
  const key = str(formData, "dataset");
  const name = str(formData, "name").trim();
  const reportId = str(formData, "report_id") || null;
  const shared = formData.get("shared") === "on";
  const def = definitionFromFields(formData);
  const back = fieldsFromDefinition(key, def);
  if (reportId) back.set("report", reportId);
  back.set("name", name);
  const dataset = datasetFor(key);
  if (!dataset || !can(membership.permissions, dataset.permission)) go(HOME, { ...Object.fromEntries(back), error: "forbidden" });
  const problems = checkDefinition(def, dataset);
  if (!name) problems.unshift("name the report");
  if (problems.length) go(HOME, { ...Object.fromEntries(back), error: problems.join("; ") });
  let id: string | null = null;
  let error: string | null = null;
  try {
    id = await dbAs(session, async (tx) => {
      if (reportId) {
        const [row] = await tx<{ id: string }[]>`
          update public.saved_reports set name = ${name}, dataset = ${key}, definition = ${tx.json(def as never)}, shared = ${shared}
          where id = ${reportId} and tenant_id = ${tenantId} returning id`;
        if (row) return row.id;
      }
      // Someone else's report (or one gone) is saved as a new report of the member's own.
      const [row] = await tx<{ id: string }[]>`
        insert into public.saved_reports (tenant_id, name, dataset, definition, shared) values (${tenantId}, ${name}, ${key}, ${tx.json(def as never)}, ${shared}) returning id`;
      return row.id;
    });
  } catch (err) {
    error = errorCode(err);
  }
  if (!id) go(HOME, { ...Object.fromEntries(back), error: error ?? "failed" });
  go(`${HOME}/${id}`, { note: "Report saved." });
}

/** Shares a report with every reports.read member, or makes it private again; only its author can (rule 11). */
export async function setReportShared(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const reportId = str(formData, "report_id");
  const shared = str(formData, "shared") === "true";
  const { session } = await requirePermission(tenantId, "reports.read");
  let error: string | null = null;
  try {
    const n = await dbAs(session, async (tx) => (await tx`update public.saved_reports set shared = ${shared} where id = ${reportId} and tenant_id = ${tenantId} returning id`).length);
    if (n === 0) error = "forbidden";
  } catch (err) {
    error = errorCode(err);
  }
  go(`${HOME}/${reportId}`, error ? { error } : { note: shared ? "Shared with the company." : "Only you can see this report now." });
}

/** Deletes a report: its author, or an owner (rule 11). */
export async function deleteReport(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const reportId = str(formData, "report_id");
  const { session } = await requirePermission(tenantId, "reports.read");
  let error: string | null = null;
  try {
    const n = await dbAs(session, async (tx) => (await tx`delete from public.saved_reports where id = ${reportId} and tenant_id = ${tenantId} returning id`).length);
    if (n === 0) error = "forbidden";
  } catch (err) {
    error = errorCode(err);
  }
  if (error) go(`${HOME}/${reportId}`, { error });
  go(HOME, { note: "Report deleted." });
}
