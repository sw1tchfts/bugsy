"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type FormState } from "@/lib/customers/duplicates";
import { findDuplicates } from "@/lib/customers/duplicates-db";
import { addressColumns, addressComplete, emailOrNull, formValues, geocode, opt, readAddress, str } from "@/lib/customers/forms";
import { type LeadStage, canTransition } from "@/lib/customers/pipeline";
import { fromTenantLocal } from "@/lib/dates";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { errorCode } from "@/lib/db";

function fail(formData: FormData, error: string): FormState {
  return { error, values: formValues(formData) };
}

export async function createLead(_state: FormState, formData: FormData): Promise<FormState> {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "customers.write");
  const name = str(formData, "name");
  const sourceId = str(formData, "source_id");
  const email = emailOrNull(formData);
  const phone = opt(formData, "phone");
  const address = readAddress(formData);
  if (!name || !sourceId) return fail(formData, "Name and lead source are required.");
  if (address && !addressComplete(address)) return fail(formData, "Fill in the whole service address or leave it empty for now.");
  const geo = address ? await geocode(address) : null;

  let duplicates: FormState["duplicates"];
  let leadId: string | null = null;
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      if (formData.get("confirm_duplicate") !== "true") {
        const found = await findDuplicates(tx, tenantId, { normalizedAddress: geo?.normalizedAddress, phone, email });
        if (found.length) {
          duplicates = found.map(({ kind, id, label, matchedOn }) => ({ kind, id, label, matchedOn }));
          return;
        }
      }
      const [lead] = await tx<{ id: string }[]>`
        insert into public.leads ${tx({
          tenant_id: tenantId, source_id: sourceId, name, email, phone, property_type: opt(formData, "property_type"), notes: opt(formData, "notes"),
          owner_id: session.userId, ...(geo ? addressColumns(geo) : {}),
        })} returning id`;
      leadId = lead.id;
    });
  } catch (err) {
    error = errorCode(err);
  }
  if (duplicates) return { duplicates, values: formValues(formData) };
  if (error || !leadId) return fail(formData, error ?? "failed");
  revalidatePath("/leads");
  redirect(`/leads/${leadId}`);
}

export async function updateLead(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const leadId = str(formData, "lead_id");
  const { session } = await requirePermission(tenantId, "customers.write");
  const address = readAddress(formData);
  let error: string | null = null;
  if (address && !addressComplete(address)) {
    error = "Fill in the whole service address or leave it empty.";
  } else {
    const geo = address ? await geocode(address) : null;
    try {
      await dbAs(session, (tx) =>
        tx`update public.leads set ${tx({
          name: str(formData, "name"), source_id: str(formData, "source_id"), email: emailOrNull(formData), phone: opt(formData, "phone"),
          property_type: opt(formData, "property_type"), notes: opt(formData, "notes"),
          ...(geo ? addressColumns(geo) : { line1: null, line2: null, city: null, state_code: null, postal_code: null, normalized_address: null, county: null, lat: null, lng: null, geocode_status: "pending" }),
        })} where id = ${leadId} and tenant_id = ${tenantId}`,
      );
    } catch (err) {
      error = errorCode(err);
    }
  }
  revalidatePath(`/leads/${leadId}`);
  redirect(`/leads/${leadId}${error ? `?error=${encodeURIComponent(error)}` : ""}`);
}

/** Moves a lead between stages; conversion to won goes through convertLead. */
export async function setLeadStage(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const leadId = str(formData, "lead_id");
  const to = str(formData, "stage") as LeadStage;
  const { session, membership } = await requirePermission(tenantId, "customers.write");
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const [lead] = await tx<{ stage: LeadStage }[]>`select stage from public.leads where id = ${leadId} and tenant_id = ${tenantId}`;
      if (!lead) throw new Error("not found");
      if (to === "won") throw Object.assign(new Error("use convert"), { code: "23514" });
      if (!canTransition(lead.stage, to)) throw Object.assign(new Error(`a lead cannot move from ${lead.stage} to ${to}`), { code: "23514" });
      // Only the columns this move owns change; a booked inspection survives quoting, losing and reopening.
      const changes: Record<string, unknown> = { stage: to };
      if (to === "lost") changes.lost_reason = opt(formData, "lost_reason");
      if (to === "inspection_booked") {
        const wall = opt(formData, "inspection_at");
        const at = wall ? fromTenantLocal(wall, membership.tenantTimezone) : null;
        if (wall && !at) throw Object.assign(new Error("the inspection time is not a valid date and time"), { code: "23514" });
        changes.inspection_at = at;
      }
      await tx`update public.leads set ${tx(changes)} where id = ${leadId} and tenant_id = ${tenantId}`;
    });
  } catch (err) {
    error = errorCode(err);
  }
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  redirect(`/leads/${leadId}${error ? `?error=${encodeURIComponent(error)}` : ""}`);
}

/** Creates the account, property and primary contact from a lead and marks it won, in one transaction. */
export async function convertLead(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const leadId = str(formData, "lead_id");
  const { session } = await requirePermission(tenantId, "customers.write");
  let accountId: string | null = null;
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const [lead] = await tx<{
        name: string; email: string | null; phone: string | null; stage: LeadStage; account_id: string | null; property_type: string | null;
        line1: string | null; line2: string | null; city: string | null; state_code: string | null; postal_code: string | null; normalized_address: string | null;
        county: string | null; lat: number | null; lng: number | null; geocode_status: string;
      }[]>`select * from public.leads where id = ${leadId} and tenant_id = ${tenantId} for update`;
      if (!lead) throw new Error("not found");
      if (lead.account_id) throw Object.assign(new Error("this lead was already converted"), { code: "23514" });
      if (!canTransition(lead.stage, "won")) throw Object.assign(new Error(`a ${lead.stage} lead cannot be won`), { code: "23514" });
      if (!lead.line1 || !lead.city || !lead.state_code || !lead.postal_code || !lead.normalized_address) {
        throw Object.assign(new Error("add the service address before converting"), { code: "23514" });
      }
      const propertyType = lead.property_type ?? "house";
      const accountType = ["house", "townhouse", "condo"].includes(propertyType) ? "residential" : propertyType === "apartment_building" ? "property_manager" : "commercial";
      const [account] = await tx<{ id: string }[]>`
        insert into public.accounts ${tx({
          tenant_id: tenantId, type: accountType, name: lead.name, email: lead.email, phone: lead.phone, lead_id: leadId,
          billing_line1: lead.line1, billing_line2: lead.line2, billing_city: lead.city, billing_state_code: lead.state_code, billing_postal_code: lead.postal_code,
        })} returning id`;
      const [property] = await tx<{ id: string }[]>`
        insert into public.properties ${tx({
          tenant_id: tenantId, account_id: account.id, name: accountType === "residential" ? "Home" : null, property_type: propertyType,
          line1: lead.line1, line2: lead.line2, city: lead.city, state_code: lead.state_code, postal_code: lead.postal_code, normalized_address: lead.normalized_address,
          county: lead.county, lat: lead.lat, lng: lead.lng, geocode_status: lead.geocode_status,
        })} returning id`;
      await tx`insert into public.contacts ${tx({ tenant_id: tenantId, account_id: account.id, property_id: property.id, name: lead.name, email: lead.email, phone: lead.phone, role: "primary" })}`;
      await tx`update public.leads set account_id = ${account.id}, property_id = ${property.id}, stage = 'won' where id = ${leadId}`;
      await tx`update public.quotes set account_id = ${account.id}, property_id = ${property.id} where lead_id = ${leadId} and account_id is null`;
      accountId = account.id;
    });
  } catch (err) {
    error = errorCode(err);
  }
  revalidatePath("/leads");
  revalidatePath("/customers");
  if (error || !accountId) redirect(`/leads/${leadId}?error=${encodeURIComponent(error ?? "failed")}`);
  redirect(`/customers/${accountId}`);
}

export async function createLeadSource(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "customers.write");
  const name = str(formData, "name");
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "s$1");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`insert into public.lead_sources (tenant_id, key, name) values (${tenantId}, ${key || "source"}, ${name})`);
  } catch (err) {
    error = errorCode(err);
  }
  revalidatePath("/leads");
  redirect(`/leads${error ? `?error=${encodeURIComponent(error)}` : ""}`);
}

export async function toggleLeadSource(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const sourceId = str(formData, "source_id");
  const active = formData.get("active") === "true";
  const { session } = await requirePermission(tenantId, "customers.write");
  await dbAs(session, (tx) => tx`update public.lead_sources set active = ${active} where id = ${sourceId} and tenant_id = ${tenantId}`);
  revalidatePath("/leads");
  redirect("/leads");
}
