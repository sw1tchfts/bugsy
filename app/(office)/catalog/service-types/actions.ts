"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requirePermission } from "@/lib/auth/session";
import {
  JOB_KINDS,
  type JobKind,
  PRICING_METHODS,
  SERVICE_LINES,
  TREATMENT_AREAS,
  areasValidForKind,
  templateByKey,
} from "@/lib/catalog/service-lines";
import { ensureStateRules } from "@/lib/catalog/state-rules";
import { type JobStep, jobStepIssues } from "@/lib/agreements/cadence";
import { parseJobSteps } from "@/lib/agreements/forms";
import { isDeviceKind } from "@/lib/commercial/devices";
import { intOrNull, opt, str } from "@/lib/customers/forms";
import { errorCode } from "@/lib/db";
import { parseDollarsToCents } from "@/lib/money";

const LIST = "/catalog/service-types";
const TAX_CLASSES = ["taxable", "exempt", "unknown"];
const SIZE_BASES = ["none", "size_sqft", "lot_sqft"];

function detail(id: string) {
  return `${LIST}/${id}`;
}

function back(path: string, error: string | null): never {
  revalidatePath(LIST);
  revalidatePath(path);
  redirect(error ? `${path}?error=${encodeURIComponent(error)}` : path);
}

type ServiceTypeInput = {
  name: string;
  description: string | null;
  service_line: string;
  job_kind: string;
  treatment_areas: string[];
  pricing_method: string;
  default_duration_minutes: number;
  device_kinds: string[];
  job_plan?: JobStep[] | null;
  prep_checklist?: string[];
};

/** Reads the service type fields, falling back to a template for anything the form left out. */
function readServiceType(formData: FormData): { value: ServiceTypeInput } | { error: string } {
  const template = templateByKey(opt(formData, "template") ?? "");
  const pick = (key: string, fallback: string | undefined) => str(formData, key) || fallback || "";
  const checked = formData.getAll("treatment_areas").map(String).filter(Boolean);
  const value: ServiceTypeInput = {
    name: pick("name", template?.name),
    description: opt(formData, "description") ?? template?.description ?? null,
    service_line: pick("service_line", template?.serviceLine),
    job_kind: pick("job_kind", template?.jobKind),
    treatment_areas: formData.has("areas_present") || !template ? checked : template.treatmentAreas,
    pricing_method: pick("pricing_method", template?.pricingMethod),
    default_duration_minutes: intOrNull(formData, "default_duration_minutes") ?? template?.defaultDurationMinutes ?? 60,
    device_kinds: formData.has("kinds_present") ? formData.getAll("device_kinds").map(String).filter(isDeviceKind) : (template?.deviceKinds ?? []),
  };
  // Spec 15: a job plan template (steps with day offsets) and the customer's prep checklist.
  if (formData.has("job_plan_present")) {
    const steps = parseJobSteps(str(formData, "job_plan"));
    if (steps.length) {
      const issues = jobStepIssues(steps);
      if (issues.length) return { error: issues.join(" ") };
      value.job_plan = steps;
    } else value.job_plan = null;
  }
  if (formData.has("prep_present")) {
    value.prep_checklist = str(formData, "prep_checklist").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 30);
  }
  if (!value.name) return { error: "A name is required." };
  if (!(SERVICE_LINES as readonly string[]).includes(value.service_line)) return { error: "Pick a service line." };
  if (!(JOB_KINDS as readonly string[]).includes(value.job_kind)) return { error: "Pick a job kind." };
  if (!value.treatment_areas.every((a) => (TREATMENT_AREAS as readonly string[]).includes(a))) return { error: "Unknown treatment area." };
  if (!areasValidForKind(value.job_kind as JobKind, value.treatment_areas)) return { error: "Work that applies pesticide needs at least one treatment area." };
  if (!(PRICING_METHODS as readonly string[]).includes(value.pricing_method)) return { error: "Pick a pricing method." };
  if (value.default_duration_minutes < 5 || value.default_duration_minutes > 1440) return { error: "Duration must be between 5 minutes and a day." };
  return { value };
}

export async function createServiceType(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "catalog.write");
  const read = readServiceType(formData);
  if ("error" in read) back(LIST, read.error);
  let id: string | null = null;
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const { job_plan, ...rest } = read.value;
      const [row] = await tx<{ id: string }[]>`insert into public.service_types ${tx({ tenant_id: tenantId, ...rest, ...(job_plan !== undefined ? { job_plan: job_plan === null ? null : tx.json(job_plan) } : {}) })} returning id`;
      id = row.id;
      await ensureStateRules(tx, tenantId, row.id);
    });
  } catch (err) {
    error = errorCode(err);
  }
  if (error || !id) back(LIST, error ?? "failed");
  back(detail(id), null);
}

export async function updateServiceType(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const serviceTypeId = str(formData, "service_type_id");
  const { session } = await requirePermission(tenantId, "catalog.write");
  const read = readServiceType(formData);
  if ("error" in read) back(detail(serviceTypeId), read.error);
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const { job_plan, ...rest } = read.value;
      await tx`update public.service_types set ${tx({ ...rest, ...(job_plan !== undefined ? { job_plan: job_plan === null ? null : tx.json(job_plan) } : {}), active: formData.get("active") !== "false" })} where id = ${serviceTypeId} and tenant_id = ${tenantId}`;
      await ensureStateRules(tx, tenantId, serviceTypeId);
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(detail(serviceTypeId), error);
}

export async function archiveServiceType(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const serviceTypeId = str(formData, "service_type_id");
  const archive = formData.get("archive") === "true";
  const { session } = await requirePermission(tenantId, "catalog.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) =>
      tx`update public.service_types set archived_at = ${archive ? new Date() : null}, active = ${!archive} where id = ${serviceTypeId} and tenant_id = ${tenantId}`,
    );
  } catch (err) {
    error = errorCode(err);
  }
  back(archive ? LIST : detail(serviceTypeId), error);
}

/** Adds rows for every state the tenant works in (plus an optional extra state) and refreshes pack defaults. */
export async function refreshStateRules(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const serviceTypeId = str(formData, "service_type_id");
  const { session } = await requirePermission(tenantId, "catalog.write");
  const extra = opt(formData, "state_code");
  if (extra && !/^[A-Za-z]{2}$/.test(extra)) back(detail(serviceTypeId), "A state is its two-letter code.");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => ensureStateRules(tx, tenantId, serviceTypeId, extra ? [extra] : []));
  } catch (err) {
    error = errorCode(err);
  }
  back(detail(serviceTypeId), error);
}

/** Tenants may add certification categories and set the tax class; the pack's categories always stay. */
export async function updateStateRule(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const serviceTypeId = str(formData, "service_type_id");
  const ruleId = str(formData, "rule_id");
  const { session } = await requirePermission(tenantId, "catalog.write");
  // Category codes are kept as the state writes them (a pack may use "10a"); the pack's own categories always stay.
  const entered = str(formData, "required_cert_categories").split(/[,\s]+/).map((c) => c.trim()).filter(Boolean);
  const taxClass = str(formData, "tax_class");
  if (!TAX_CLASSES.includes(taxClass)) back(detail(serviceTypeId), "Pick a tax class.");
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const [rule] = await tx<{ pack_cert_categories: string[] }[]>`
        select pack_cert_categories from public.service_type_state_rules where id = ${ruleId} and tenant_id = ${tenantId} and service_type_id = ${serviceTypeId}`;
      if (!rule) throw new Error("not found");
      const categories = [...new Set([...rule.pack_cert_categories, ...entered])].sort();
      await tx`update public.service_type_state_rules set required_cert_categories = ${categories}, tax_class = ${taxClass}, notes = ${opt(formData, "notes")}
               where id = ${ruleId} and tenant_id = ${tenantId}`;
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(detail(serviceTypeId), error);
}

/** A licensed manager confirms a state rule row where no pack is researched, which lets dispatch assign work there (spec 05 rule 3). */
export async function confirmStateRule(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const serviceTypeId = str(formData, "service_type_id");
  const ruleId = str(formData, "rule_id");
  const confirm = formData.get("confirm") !== "false";
  const { session } = await requirePermission(tenantId, "compliance.write");
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const result = confirm
        ? await tx`update public.service_type_state_rules set confirmed_at = now(), confirmed_by = auth.uid() where id = ${ruleId} and tenant_id = ${tenantId}`
        : await tx`update public.service_type_state_rules set confirmed_at = null, confirmed_by = null where id = ${ruleId} and tenant_id = ${tenantId}`;
      if (result.count === 0) throw Object.assign(new Error("that state rule was not found or cannot be changed by your role"), { code: "23514" });
    });
  } catch (err) {
    error = errorCode(err);
  }
  revalidatePath("/dispatch");
  back(detail(serviceTypeId), error);
}

type PriceBookInput = {
  name: string;
  add_on: boolean;
  size_basis: string;
  size_min: number;
  size_max: number | null;
  initial_price_cents: number;
  recurring_price_cents: number;
  one_time_price_cents: number;
  position: number;
};

function readPriceBookItem(formData: FormData): { value: PriceBookInput } | { error: string } {
  const name = str(formData, "name");
  const sizeBasis = str(formData, "size_basis") || "none";
  const price = (key: string) => {
    const raw = str(formData, key);
    return raw ? parseDollarsToCents(raw) : 0;
  };
  const initial = price("initial_price");
  const recurring = price("recurring_price");
  const oneTime = price("one_time_price");
  if (!name) return { error: "An item needs a name." };
  if (!SIZE_BASES.includes(sizeBasis)) return { error: "Pick how the item is sized." };
  if (initial === null || recurring === null || oneTime === null) return { error: "Prices are dollars and cents, for example 199.00." };
  if (initial === 0 && recurring === 0 && oneTime === 0) return { error: "An item needs at least one price." };
  const sizeMin = sizeBasis === "none" ? 0 : (intOrNull(formData, "size_min") ?? 0);
  const sizeMax = sizeBasis === "none" ? null : intOrNull(formData, "size_max");
  if (sizeMin < 0 || (sizeMax !== null && sizeMax <= sizeMin)) return { error: "A band runs from its minimum up to, not including, its maximum." };
  return {
    value: {
      name,
      add_on: formData.get("add_on") === "true",
      size_basis: sizeBasis,
      size_min: sizeMin,
      size_max: sizeMax,
      initial_price_cents: initial,
      recurring_price_cents: recurring,
      one_time_price_cents: oneTime,
      position: intOrNull(formData, "position") ?? 1,
    },
  };
}

export async function createPriceBookItem(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const serviceTypeId = str(formData, "service_type_id");
  const { session } = await requirePermission(tenantId, "catalog.write");
  const read = readPriceBookItem(formData);
  if ("error" in read) back(detail(serviceTypeId), read.error);
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`insert into public.price_book_items ${tx({ tenant_id: tenantId, service_type_id: serviceTypeId, ...read.value })}`);
  } catch (err) {
    error = errorCode(err);
  }
  back(detail(serviceTypeId), error);
}

export async function updatePriceBookItem(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const serviceTypeId = str(formData, "service_type_id");
  const itemId = str(formData, "item_id");
  const { session } = await requirePermission(tenantId, "catalog.write");
  const read = readPriceBookItem(formData);
  if ("error" in read) back(detail(serviceTypeId), read.error);
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`update public.price_book_items set ${tx(read.value)} where id = ${itemId} and tenant_id = ${tenantId} and service_type_id = ${serviceTypeId}`);
  } catch (err) {
    error = errorCode(err);
  }
  back(detail(serviceTypeId), error);
}

export async function archivePriceBookItem(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const serviceTypeId = str(formData, "service_type_id");
  const itemId = str(formData, "item_id");
  const archive = formData.get("archive") === "true";
  const { session } = await requirePermission(tenantId, "catalog.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) =>
      tx`update public.price_book_items set archived_at = ${archive ? new Date() : null}, active = ${!archive} where id = ${itemId} and tenant_id = ${tenantId}`,
    );
  } catch (err) {
    error = errorCode(err);
  }
  back(detail(serviceTypeId), error);
}
