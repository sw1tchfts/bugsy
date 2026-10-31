"use client";

import { useActionState } from "react";
import { createProperty } from "@/app/(office)/customers/actions";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { EMPTY_FORM_STATE } from "@/lib/customers/duplicates";
import { AddressFields, DuplicateNotice, FormError, PropertyTypeSelect } from "./fields";

export function PropertyForm({ tenantId, accountId }: { tenantId: string; accountId: string }) {
  const [state, action, pending] = useActionState(createProperty, EMPTY_FORM_STATE);
  const v = state.values ?? {};
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="account_id" value={accountId} />
      <div className="sm:col-span-2">
        <FormError error={state.error} />
        <DuplicateNotice duplicates={state.duplicates} />
      </div>
      <Field label="Property name" htmlFor="pf-name" hint='For example "Home" or "Store 12".'>
        <Input id="pf-name" name="name" defaultValue={v.name} />
      </Field>
      <PropertyTypeSelect id="pf-type" value={v.property_type} />
      <AddressFields values={v} />
      <Field label="Size (sq ft)" htmlFor="pf-size">
        <Input id="pf-size" name="size_sqft" type="number" min={1} defaultValue={v.size_sqft} />
      </Field>
      <Field label="Lot (sq ft)" htmlFor="pf-lot">
        <Input id="pf-lot" name="lot_sqft" type="number" min={1} defaultValue={v.lot_sqft} />
      </Field>
      <Field label="Units (for buildings)" htmlFor="pf-units">
        <Input id="pf-units" name="unit_count" type="number" min={0} defaultValue={v.unit_count} />
      </Field>
      <Field label="Access notes" htmlFor="pf-access">
        <Textarea id="pf-access" name="access_notes" defaultValue={v.access_notes} />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : "Add property"}
        </Button>
      </div>
    </form>
  );
}
