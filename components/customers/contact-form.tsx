"use client";

import { useActionState } from "react";
import { createContact } from "@/app/(office)/customers/actions";
import { Button, Field, Input, Select } from "@/components/ui";
import { EMPTY_FORM_STATE } from "@/lib/customers/duplicates";
import { DuplicateNotice, FormError } from "./fields";

const ROLES = [
  ["primary", "Primary contact"],
  ["billing", "Billing contact"],
  ["site_contact", "Site contact"],
  ["property_manager", "Property manager"],
  ["resident", "Resident"],
] as const;

export function ContactForm({
  tenantId,
  accountId,
  propertyId,
  units = [],
  returnTo,
}: {
  tenantId: string;
  accountId?: string;
  propertyId?: string;
  units?: { id: string; label: string }[];
  returnTo: string;
}) {
  const [state, action, pending] = useActionState(createContact, EMPTY_FORM_STATE);
  const v = state.values ?? {};
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="tenant_id" value={tenantId} />
      {accountId ? <input type="hidden" name="account_id" value={accountId} /> : null}
      {propertyId ? <input type="hidden" name="property_id" value={propertyId} /> : null}
      <input type="hidden" name="return_to" value={returnTo} />
      <div className="sm:col-span-2">
        <FormError error={state.error} />
        <DuplicateNotice duplicates={state.duplicates} />
      </div>
      <Field label="Name" htmlFor="cf-name">
        <Input id="cf-name" name="name" defaultValue={v.name} required />
      </Field>
      <Field label="Role" htmlFor="cf-role">
        <Select id="cf-role" name="role" defaultValue={v.role ?? (propertyId && !accountId ? "resident" : "primary")} required>
          {ROLES.filter(([key]) => key !== "resident" || propertyId).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Email" htmlFor="cf-email">
        <Input id="cf-email" name="email" type="email" defaultValue={v.email} />
      </Field>
      <Field label="Phone" htmlFor="cf-phone">
        <Input id="cf-phone" name="phone" type="tel" defaultValue={v.phone} />
      </Field>
      {units.length ? (
        <Field label="Unit" htmlFor="cf-unit">
          <Select id="cf-unit" name="unit_id" defaultValue={v.unit_id ?? ""}>
            <option value="">Whole property</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Preferred channel" htmlFor="cf-channel">
        <Select id="cf-channel" name="preferred_channel" defaultValue={v.preferred_channel ?? ""}>
          <option value="">No preference</option>
          <option value="email">Email</option>
          <option value="sms">Text message</option>
          <option value="phone">Phone</option>
          <option value="mail">Mail</option>
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="sms_opt_in" value="true" defaultChecked={v.sms_opt_in === "true"} /> Agreed to text messages
      </label>
      <Field label="Electronic notice consent" htmlFor="cf-consent" hint="Only if consent was captured: say how and when (for example, signed paper form on a date). Leave blank otherwise.">
        <Input id="cf-consent" name="e_notice_consent_note" defaultValue={v.e_notice_consent_note} />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : "Add contact"}
        </Button>
      </div>
    </form>
  );
}
