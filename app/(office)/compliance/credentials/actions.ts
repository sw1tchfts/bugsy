"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { intOrNull, opt, str } from "@/lib/customers/forms";
import { isIsoDate } from "@/lib/dates";
import { errorCode } from "@/lib/db";

const PAGE = "/compliance/credentials";

function back(error: string | null): never {
  revalidatePath(PAGE);
  revalidatePath("/dispatch");
  redirect(error ? `${PAGE}?error=${encodeURIComponent(error)}` : PAGE);
}

function dateOrNull(formData: FormData, key: string): string | null | undefined {
  const v = opt(formData, key);
  if (!v) return null;
  return isIsoDate(v) ? v : undefined;
}

/** Adds or edits a technician's credential in one state. Either a certification number or a trainee registration is required. */
export async function saveCredential(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const credentialId = opt(formData, "credential_id");
  const { session } = await requirePermission(tenantId, "compliance.write");
  const userId = str(formData, "user_id");
  const stateCode = str(formData, "state_code").toUpperCase();
  if (!userId || !/^[A-Z]{2}$/.test(stateCode)) back("Pick a person and a two-letter state.");
  const certExpires = dateOrNull(formData, "cert_expires_on");
  const licenseExpires = dateOrNull(formData, "license_expires_on");
  const traineeOn = dateOrNull(formData, "trainee_registered_on");
  if (certExpires === undefined || licenseExpires === undefined || traineeOn === undefined) back("Dates must be real dates.");
  const certNumber = opt(formData, "cert_number");
  if (!certNumber && !traineeOn) back("Enter a certification number, or the date the trainee was registered.");
  const columns = {
    user_id: userId,
    state_code: stateCode,
    cert_number: certNumber,
    categories: [...new Set(str(formData, "categories").split(/[,\s]+/).map((c) => c.trim()).filter(Boolean))].sort(),
    cert_expires_on: certExpires,
    license_number: opt(formData, "license_number"),
    license_expires_on: licenseExpires,
    license_year: intOrNull(formData, "license_year"),
    trainee_registered_on: traineeOn,
    supervisor_id: opt(formData, "supervisor_id"),
    notes: opt(formData, "notes"),
  };
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      if (credentialId) {
        await tx`update public.applicator_credentials set ${tx(columns)} where id = ${credentialId} and tenant_id = ${tenantId}`;
      } else {
        await tx`insert into public.applicator_credentials ${tx({ tenant_id: tenantId, ...columns })}`;
      }
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(error);
}

export async function archiveCredential(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const credentialId = str(formData, "credential_id");
  const { session } = await requirePermission(tenantId, "compliance.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`update public.applicator_credentials set archived_at = now() where id = ${credentialId} and tenant_id = ${tenantId}`);
  } catch (err) {
    error = errorCode(err);
  }
  back(error);
}
