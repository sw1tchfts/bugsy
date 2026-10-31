"use client";

import { useActionState } from "react";
import { createAccount } from "@/app/(office)/customers/actions";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { EMPTY_FORM_STATE } from "@/lib/customers/duplicates";
import { AddressFields, DuplicateNotice, FormError, PropertyTypeSelect } from "./fields";

export function AccountForm({ tenantId }: { tenantId: string }) {
  const [state, action, pending] = useActionState(createAccount, EMPTY_FORM_STATE);
  const v = state.values ?? {};
  return (
    <form action={action} className="grid gap-6">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <FormError error={state.error} />
      <DuplicateNotice duplicates={state.duplicates} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Account name" htmlFor="name" hint="The person or business that pays.">
          <Input id="name" name="name" defaultValue={v.name} required maxLength={120} />
        </Field>
        <Field label="Account type" htmlFor="type">
          <Select id="type" name="type" defaultValue={v.type ?? "residential"} required>
            <option value="residential">Residential</option>
            <option value="commercial">Commercial</option>
            <option value="property_manager">Property manager or landlord</option>
          </Select>
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" defaultValue={v.email} />
        </Field>
        <Field label="Phone" htmlFor="phone">
          <Input id="phone" name="phone" type="tel" defaultValue={v.phone} />
        </Field>
        <Field label="Primary contact name" htmlFor="contact_name" hint="Leave blank to use the account name.">
          <Input id="contact_name" name="contact_name" defaultValue={v.contact_name} />
        </Field>
        <Field label="Payment terms (days)" htmlFor="terms_days">
          <Input id="terms_days" name="terms_days" type="number" min={0} max={120} defaultValue={v.terms_days ?? "0"} />
        </Field>
      </div>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-stone-800">First service property</legend>
        <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
          <AddressFields values={v} />
        </div>
        <PropertyTypeSelect value={v.property_type} />
        <Field label="Property name" htmlFor="property_name" hint='For example "Home" or "Store 12".'>
          <Input id="property_name" name="property_name" defaultValue={v.property_name} />
        </Field>
        <Field label="Size (sq ft)" htmlFor="size_sqft">
          <Input id="size_sqft" name="size_sqft" type="number" min={1} defaultValue={v.size_sqft} />
        </Field>
        <Field label="Units (for buildings)" htmlFor="unit_count">
          <Input id="unit_count" name="unit_count" type="number" min={0} defaultValue={v.unit_count} />
        </Field>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="sms_opt_in" value="true" defaultChecked={v.sms_opt_in === "true"} /> The primary contact agreed to text messages
      </label>
      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" defaultValue={v.notes} />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : "Create account"}
        </Button>
      </div>
    </form>
  );
}
