"use client";

import { useActionState } from "react";
import { createLead } from "@/app/(office)/leads/actions";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { EMPTY_FORM_STATE } from "@/lib/customers/duplicates";
import { AddressFields, DuplicateNotice, FormError, PropertyTypeSelect } from "./fields";

export function LeadForm({ tenantId, sources }: { tenantId: string; sources: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createLead, EMPTY_FORM_STATE);
  const v = state.values ?? {};
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <div className="sm:col-span-2">
        <FormError error={state.error} />
        <DuplicateNotice duplicates={state.duplicates} />
      </div>
      <Field label="Name" htmlFor="name">
        <Input id="name" name="name" defaultValue={v.name} required maxLength={120} />
      </Field>
      <Field label="Lead source" htmlFor="source_id" hint="Where this lead came from. Required, so close rate by source stays honest.">
        <Select id="source_id" name="source_id" defaultValue={v.source_id ?? ""} required>
          <option value="" disabled>
            Choose a source
          </option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Phone" htmlFor="phone">
        <Input id="phone" name="phone" type="tel" defaultValue={v.phone} />
      </Field>
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" defaultValue={v.email} />
      </Field>
      <fieldset className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-stone-800">Service address (can wait until the inspection is booked)</legend>
        <AddressFields values={v} required={false} />
        <PropertyTypeSelect value={v.property_type} required={false} />
      </fieldset>
      <div className="sm:col-span-2">
        <Field label="Notes" htmlFor="notes">
          <Textarea id="notes" name="notes" defaultValue={v.notes} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : "Create lead"}
        </Button>
      </div>
    </form>
  );
}
