"use client";

import Link from "next/link";
import type { DuplicateSummary } from "@/lib/customers/duplicates";
import { Field, Input, Notice, Select } from "@/components/ui";

export const PROPERTY_TYPES = [
  ["house", "House"],
  ["townhouse", "Townhouse"],
  ["condo", "Condo"],
  ["apartment_building", "Apartment building"],
  ["office", "Office"],
  ["retail", "Retail"],
  ["restaurant", "Restaurant"],
  ["warehouse", "Warehouse"],
  ["food_plant", "Food plant"],
  ["school", "School"],
  ["healthcare", "Healthcare"],
  ["other", "Other"],
] as const;

export function AddressFields({ prefix = "", values = {}, required = true }: { prefix?: string; values?: Record<string, string>; required?: boolean }) {
  const v = (k: string) => values[`${prefix}${k}`] ?? "";
  return (
    <>
      <Field label="Street address" htmlFor={`${prefix}line1`}>
        <Input id={`${prefix}line1`} name={`${prefix}line1`} defaultValue={v("line1")} required={required} maxLength={120} />
      </Field>
      <Field label="Apartment, suite or unit" htmlFor={`${prefix}line2`}>
        <Input id={`${prefix}line2`} name={`${prefix}line2`} defaultValue={v("line2")} maxLength={60} />
      </Field>
      <Field label="City" htmlFor={`${prefix}city`}>
        <Input id={`${prefix}city`} name={`${prefix}city`} defaultValue={v("city")} required={required} maxLength={80} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="State" htmlFor={`${prefix}state_code`}>
          <Input id={`${prefix}state_code`} name={`${prefix}state_code`} defaultValue={v("state_code")} required={required} pattern="[A-Za-z]{2}" maxLength={2} />
        </Field>
        <Field label="ZIP" htmlFor={`${prefix}postal_code`}>
          <Input id={`${prefix}postal_code`} name={`${prefix}postal_code`} defaultValue={v("postal_code")} required={required} maxLength={10} />
        </Field>
      </div>
    </>
  );
}

export function PropertyTypeSelect({ id = "property_type", value, required = true }: { id?: string; value?: string; required?: boolean }) {
  return (
    <Field label="Property type" htmlFor={id}>
      <Select id={id} name="property_type" defaultValue={value ?? ""} required={required}>
        <option value="" disabled={required}>
          {required ? "Choose a type" : "Unknown"}
        </option>
        {PROPERTY_TYPES.map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

const KIND_LINKS: Record<DuplicateSummary["kind"], (id: string) => string> = {
  account: (id) => `/customers/${id}`,
  contact: (id) => `/customers/${id}`,
  property: (id) => `/customers/properties/${id}`,
  lead: (id) => `/leads/${id}`,
};

/** Shows possible duplicates and the checkbox that lets staff proceed anyway. Nothing is ever merged. */
export function DuplicateNotice({ duplicates }: { duplicates: DuplicateSummary[] | undefined }) {
  if (!duplicates?.length) return null;
  return (
    <div className="grid gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-medium">This looks like it may already exist:</p>
      <ul className="list-disc pl-5">
        {duplicates.map((d) => (
          <li key={`${d.kind}-${d.id}`}>
            <Link href={KIND_LINKS[d.kind](d.id)} className="underline" target="_blank">
              {d.label}
            </Link>{" "}
            <span className="text-amber-800">(same {d.matchedOn.join(" and ")})</span>
          </li>
        ))}
      </ul>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="confirm_duplicate" value="true" /> Create it anyway
      </label>
    </div>
  );
}

export function FormError({ error }: { error?: string | null }) {
  return error ? <Notice kind="error">{error}</Notice> : null;
}
