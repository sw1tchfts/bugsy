"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/customers/duplicates";
import { findDuplicates } from "@/lib/customers/duplicates-db";
import { addressColumns, addressComplete, emailOrNull, formValues, geocode, intOrNull, opt, readAddress, str } from "@/lib/customers/forms";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { errorCode } from "@/lib/db";
import { normalizeEmail } from "@/lib/geo/normalize";

const ACCOUNT_TYPES = ["residential", "commercial", "property_manager"];
const CONTACT_ROLES = ["billing", "primary", "resident", "site_contact", "property_manager"];

function fail(state: FormState, formData: FormData, error: string): FormState {
  return { ...state, error, duplicates: undefined, values: formValues(formData) };
}

/** Creates an account with its first property and primary contact. */
export async function createAccount(_state: FormState, formData: FormData): Promise<FormState> {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "customers.write");
  const name = str(formData, "name");
  const type = str(formData, "type");
  const email = emailOrNull(formData);
  const phone = opt(formData, "phone");
  const address = readAddress(formData);
  const propertyType = str(formData, "property_type");
  if (!name || !ACCOUNT_TYPES.includes(type)) return fail(EMPTY_FORM_STATE, formData, "Name and account type are required.");
  if (!addressComplete(address) || !propertyType) return fail(EMPTY_FORM_STATE, formData, "A complete service address and property type are required.");

  const geo = await geocode(address);
  let accountId: string | null = null;
  let duplicates: FormState["duplicates"];
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      if (formData.get("confirm_duplicate") !== "true") {
        const found = await findDuplicates(tx, tenantId, { normalizedAddress: geo.normalizedAddress, phone, email });
        if (found.length) {
          duplicates = found.map(({ kind, id, label, matchedOn }) => ({ kind, id, label, matchedOn }));
          return;
        }
      }
      const [account] = await tx<{ id: string }[]>`
        insert into public.accounts ${tx({
          tenant_id: tenantId, type, name, email, phone, terms_days: intOrNull(formData, "terms_days") ?? 0,
          po_required: formData.get("po_required") === "true", notes: opt(formData, "notes"),
          billing_line1: geo.line1, billing_line2: geo.line2, billing_city: geo.city, billing_state_code: geo.stateCode, billing_postal_code: geo.postalCode,
        })} returning id`;
      const [property] = await tx<{ id: string }[]>`
        insert into public.properties ${tx({
          tenant_id: tenantId, account_id: account.id, name: opt(formData, "property_name") ?? (type === "residential" ? "Home" : null),
          property_type: propertyType, size_sqft: intOrNull(formData, "size_sqft"), unit_count: intOrNull(formData, "unit_count"), ...addressColumns(geo),
        })} returning id`;
      const contactName = opt(formData, "contact_name") ?? name;
      await tx`insert into public.contacts ${tx({
        tenant_id: tenantId, account_id: account.id, property_id: property.id, name: contactName, email, phone, role: "primary",
        sms_opt_in: formData.get("sms_opt_in") === "true",
      })}`;
      accountId = account.id;
    });
  } catch (err) {
    error = errorCode(err);
  }
  if (duplicates) return { duplicates, values: formValues(formData) };
  if (error || !accountId) return fail(EMPTY_FORM_STATE, formData, error ?? "failed");
  revalidatePath("/customers");
  redirect(`/customers/${accountId}`);
}

export async function updateAccount(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const accountId = str(formData, "account_id");
  const { session } = await requirePermission(tenantId, "customers.write");
  const type = str(formData, "type");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) =>
      tx`update public.accounts set ${tx({
        name: str(formData, "name"), type: ACCOUNT_TYPES.includes(type) ? type : "residential", email: emailOrNull(formData), phone: opt(formData, "phone"),
        terms_days: intOrNull(formData, "terms_days") ?? 0, po_required: formData.get("po_required") === "true", notes: opt(formData, "notes"),
        billing_line1: opt(formData, "billing_line1"), billing_line2: opt(formData, "billing_line2"), billing_city: opt(formData, "billing_city"),
        billing_state_code: opt(formData, "billing_state_code")?.toUpperCase() ?? null, billing_postal_code: opt(formData, "billing_postal_code"),
        status: str(formData, "status") === "inactive" ? "inactive" : "active",
      })} where id = ${accountId} and tenant_id = ${tenantId}`,
    );
  } catch (err) {
    error = errorCode(err);
  }
  revalidatePath(`/customers/${accountId}`);
  redirect(`/customers/${accountId}${error ? `?error=${encodeURIComponent(error)}` : ""}`);
}

export async function archiveAccount(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const accountId = str(formData, "account_id");
  const { session } = await requirePermission(tenantId, "customers.write");
  const archive = formData.get("archive") === "true";
  await dbAs(session, (tx) => tx`update public.accounts set archived_at = ${archive ? new Date() : null} where id = ${accountId} and tenant_id = ${tenantId}`);
  revalidatePath("/customers");
  redirect(archive ? "/customers" : `/customers/${accountId}`);
}

/** Adds a property to an existing account. */
export async function createProperty(_state: FormState, formData: FormData): Promise<FormState> {
  const tenantId = str(formData, "tenant_id");
  const accountId = str(formData, "account_id");
  const { session } = await requirePermission(tenantId, "customers.write");
  const address = readAddress(formData);
  const propertyType = str(formData, "property_type");
  if (!addressComplete(address) || !propertyType) return fail(EMPTY_FORM_STATE, formData, "A complete address and property type are required.");
  const geo = await geocode(address);
  let duplicates: FormState["duplicates"];
  let propertyId: string | null = null;
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      if (formData.get("confirm_duplicate") !== "true") {
        const found = await findDuplicates(tx, tenantId, { normalizedAddress: geo.normalizedAddress });
        if (found.length) {
          duplicates = found.map(({ kind, id, label, matchedOn }) => ({ kind, id, label, matchedOn }));
          return;
        }
      }
      const [property] = await tx<{ id: string }[]>`
        insert into public.properties ${tx({
          tenant_id: tenantId, account_id: accountId, name: opt(formData, "name"), property_type: propertyType,
          size_sqft: intOrNull(formData, "size_sqft"), lot_sqft: intOrNull(formData, "lot_sqft"), unit_count: intOrNull(formData, "unit_count"),
          access_notes: opt(formData, "access_notes"), measured_by: intOrNull(formData, "size_sqft") ? "manual" : null, ...addressColumns(geo),
        })} returning id`;
      propertyId = property.id;
    });
  } catch (err) {
    error = errorCode(err);
  }
  if (duplicates) return { duplicates, values: formValues(formData) };
  if (error || !propertyId) return fail(EMPTY_FORM_STATE, formData, error ?? "failed");
  revalidatePath(`/customers/${accountId}`);
  redirect(`/customers/properties/${propertyId}`);
}

export async function updateProperty(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const propertyId = str(formData, "property_id");
  const { session } = await requirePermission(tenantId, "customers.write");
  const address = readAddress(formData);
  const propertyType = str(formData, "property_type");
  let error: string | null = null;
  if (!addressComplete(address) || !propertyType) {
    error = "A complete address and property type are required.";
  } else {
    const geo = await geocode(address);
    try {
      await dbAs(session, (tx) =>
        tx`update public.properties set ${tx({
          name: opt(formData, "name"), property_type: propertyType, size_sqft: intOrNull(formData, "size_sqft"), lot_sqft: intOrNull(formData, "lot_sqft"),
          unit_count: intOrNull(formData, "unit_count"), access_notes: opt(formData, "access_notes"),
          measured_by: intOrNull(formData, "size_sqft") ? (opt(formData, "measured_by") ?? "manual") : null, ...addressColumns(geo),
        })} where id = ${propertyId} and tenant_id = ${tenantId}`,
      );
    } catch (err) {
      error = errorCode(err);
    }
  }
  revalidatePath(`/customers/properties/${propertyId}`);
  redirect(`/customers/properties/${propertyId}${error ? `?error=${encodeURIComponent(error)}` : ""}`);
}

/** Re-runs the geo provider on a property whose last attempt failed. */
export async function retryGeocode(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const propertyId = str(formData, "property_id");
  const { session } = await requirePermission(tenantId, "customers.write");
  await dbAs(session, async (tx) => {
    const [p] = await tx<{ line1: string; line2: string | null; city: string; state_code: string; postal_code: string }[]>`
      select line1, line2, city, state_code, postal_code from public.properties where id = ${propertyId} and tenant_id = ${tenantId}`;
    if (!p) return;
    const geo = await geocode({ line1: p.line1, line2: p.line2, city: p.city, stateCode: p.state_code, postalCode: p.postal_code });
    await tx`update public.properties set ${tx(addressColumns(geo))} where id = ${propertyId} and tenant_id = ${tenantId}`;
  });
  revalidatePath(`/customers/properties/${propertyId}`);
  redirect(`/customers/properties/${propertyId}`);
}

export async function moveProperty(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const propertyId = str(formData, "property_id");
  const accountId = str(formData, "account_id");
  const { session } = await requirePermission(tenantId, "customers.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`update public.properties set account_id = ${accountId} where id = ${propertyId} and tenant_id = ${tenantId}`);
  } catch (err) {
    error = errorCode(err);
  }
  revalidatePath(`/customers/properties/${propertyId}`);
  redirect(`/customers/properties/${propertyId}${error ? `?error=${encodeURIComponent(error)}` : ""}`);
}

export async function createUnit(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const propertyId = str(formData, "property_id");
  const { session } = await requirePermission(tenantId, "customers.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) =>
      tx`insert into public.units ${tx({ tenant_id: tenantId, property_id: propertyId, label: str(formData, "label"), floor: opt(formData, "floor"), notes: opt(formData, "notes") })}`,
    );
  } catch (err) {
    error = errorCode(err);
  }
  revalidatePath(`/customers/properties/${propertyId}`);
  redirect(`/customers/properties/${propertyId}${error ? `?error=${encodeURIComponent(error)}` : ""}`);
}

/** Adds a contact to an account, a property, or a unit. */
export async function createContact(_state: FormState, formData: FormData): Promise<FormState> {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "customers.write");
  const accountId = opt(formData, "account_id");
  const propertyId = opt(formData, "property_id");
  const unitId = opt(formData, "unit_id");
  const role = str(formData, "role");
  const name = str(formData, "name");
  const email = emailOrNull(formData);
  const phone = opt(formData, "phone");
  const back = str(formData, "return_to") || (accountId ? `/customers/${accountId}` : `/customers/properties/${propertyId}`);
  if (!name || !CONTACT_ROLES.includes(role)) return fail(EMPTY_FORM_STATE, formData, "Name and role are required.");
  if (!accountId && !propertyId) return fail(EMPTY_FORM_STATE, formData, "A contact belongs to an account or a property.");
  if (role === "resident" && !propertyId) return fail(EMPTY_FORM_STATE, formData, "A resident contact needs a property.");

  let duplicates: FormState["duplicates"];
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      if (formData.get("confirm_duplicate") !== "true" && (phone || email)) {
        const found = await findDuplicates(tx, tenantId, { phone, email });
        if (found.length) {
          duplicates = found.map(({ kind, id, label, matchedOn }) => ({ kind, id, label, matchedOn }));
          return;
        }
      }
      const consentNote = opt(formData, "e_notice_consent_note");
      await tx`insert into public.contacts ${tx({
        tenant_id: tenantId, account_id: accountId, property_id: propertyId, unit_id: unitId || null, name, email, phone, role,
        sms_opt_in: formData.get("sms_opt_in") === "true", preferred_channel: opt(formData, "preferred_channel"), notes: opt(formData, "notes"),
        e_notice_consent_at: consentNote ? new Date() : null, e_notice_consent_note: consentNote,
      })}`;
    });
  } catch (err) {
    error = errorCode(err);
  }
  if (duplicates) return { duplicates, values: formValues(formData) };
  if (error) return fail(EMPTY_FORM_STATE, formData, error);
  revalidatePath(back);
  redirect(back);
}

export async function archiveContact(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const contactId = str(formData, "contact_id");
  const back = str(formData, "return_to") || "/customers";
  const { session } = await requirePermission(tenantId, "customers.write");
  await dbAs(session, (tx) => tx`update public.contacts set archived_at = now() where id = ${contactId} and tenant_id = ${tenantId}`);
  revalidatePath(back);
  redirect(back);
}

/** Records or clears electronic-notice consent with a note saying how it was captured. */
export async function setContactConsent(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const contactId = str(formData, "contact_id");
  const back = str(formData, "return_to") || "/customers";
  const { session } = await requirePermission(tenantId, "customers.write");
  const note = opt(formData, "e_notice_consent_note");
  const grant = formData.get("grant") === "true";
  if (!note) redirect(`${back}?error=${encodeURIComponent("A note saying how consent was captured or withdrawn is required.")}`);
  await dbAs(session, (tx) =>
    tx`update public.contacts set e_notice_consent_at = ${grant ? new Date() : null}, e_notice_consent_note = ${note}
       where id = ${contactId} and tenant_id = ${tenantId}`,
  );
  revalidatePath(back);
  redirect(back);
}

export async function searchQuery(formData: FormData) {
  const q = normalizeEmail(str(formData, "q")) ?? "";
  redirect(q ? `/customers?q=${encodeURIComponent(q)}` : "/customers");
}
