"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { dbAs, requireMembership } from "@/lib/auth/session";
import { opt, str } from "@/lib/customers/forms";
import { errorCode } from "@/lib/db";
import { todayInZone } from "@/lib/dates";
import { wdiInspector } from "@/lib/specialty/db";
import { FINDINGS, type Findings, wdiProblems } from "@/lib/specialty/wdi";
import { WDI_JOB_KINDS } from "@/lib/specialty/wdi-db";

function back(visitId: string, params: Record<string, string>): never {
  const page = `/visits/${visitId}/wdi`;
  revalidatePath(page);
  const q = new URLSearchParams(params).toString();
  redirect(`${page}${q ? `?${q}` : ""}`);
}

function readReport(formData: FormData) {
  const findings: Findings = {};
  for (const f of FINDINGS) {
    const seen = str(formData, `${f.key}_seen`);
    findings[f.key] = { seen: seen === "yes" ? true : seen === "no" ? false : null, where: str(formData, `${f.key}_where`).trim() };
  }
  const treatment = str(formData, "treatment_recommended");
  return {
    requested_by: opt(formData, "requested_by"),
    buyer: opt(formData, "buyer"),
    seller: opt(formData, "seller"),
    structures: opt(formData, "structures"),
    inspected_areas: opt(formData, "inspected_areas"),
    inaccessible_areas: opt(formData, "inaccessible_areas"),
    findings,
    treatment_recommended: treatment === "yes" ? true : treatment === "no" ? false : null,
    notes: opt(formData, "notes"),
  };
}

/** Rule 9: compliance.write, or the inspecting crew, saves the draft; compliance.write issues it (rule 7). */
export async function saveWdi(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const visitId = str(formData, "visit_id");
  const issue = str(formData, "intent") === "issue";
  const ctx = await requireMembership(tenantId);
  const perms = ctx.membership.permissions;
  if (issue && !can(perms, "compliance.write")) back(visitId, { error: "Issuing a WDI report needs compliance.write." });
  if (!can(perms, "compliance.write") && !can(perms, "visits.write")) back(visitId, { error: "forbidden" });
  const r = readReport(formData);
  let error: string | null = null;
  let problems: string[] = [];
  try {
    await dbAs(ctx.session, async (tx) => {
      const [visit] = await tx<{ job_kind: string }[]>`
        select st.job_kind from public.visits v join public.service_types st on st.id = v.service_type_id where v.id = ${visitId} and v.tenant_id = ${tenantId}`;
      if (!visit || !(WDI_JOB_KINDS as readonly string[]).includes(visit.job_kind)) throw Object.assign(new Error("A WDI report belongs to an inspection or WDI visit."), { code: "23514" });
      const inspector = await wdiInspector(tx, tenantId, visitId);
      if (issue) {
        const [v] = await tx<{ status: string; timezone: string }[]>`select v.status, t.timezone from public.visits v join public.tenants t on t.id = v.tenant_id where v.id = ${visitId}`;
        problems = wdiProblems({ ...r, number: null, status: "draft", issued_at: null }, inspector, { today: todayInZone(v?.timezone ?? "UTC"), visit_status: v?.status });
        if (problems.length) return;
      }
      const row = { ...r, findings: tx.json(r.findings), inspector_id: inspector?.user_id ?? null, ...(issue ? { status: "issued" } : {}) };
      const [existing] = await tx<{ status: string }[]>`select status from public.wdi_reports where tenant_id = ${tenantId} and visit_id = ${visitId}`;
      if (existing?.status === "issued") throw Object.assign(new Error("This report is issued; it cannot change."), { code: "23514" });
      if (existing) await tx`update public.wdi_reports set ${tx(row)} where tenant_id = ${tenantId} and visit_id = ${visitId}`;
      else await tx`insert into public.wdi_reports ${tx({ tenant_id: tenantId, visit_id: visitId, ...row })}`;
    });
  } catch (err) {
    error = errorCode(err);
  }
  if (error) back(visitId, { error });
  if (problems.length) back(visitId, { error: problems.join(" ") });
  back(visitId, { note: issue ? "Report issued. It can no longer change." : "Draft saved." });
}
