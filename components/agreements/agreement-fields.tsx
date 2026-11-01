import { BILLING_MODES, BILLING_MODE_LABELS, CADENCES, CADENCE_LABELS } from "@/lib/agreements/cadence";
import { MONTHS, formatJobSteps } from "@/lib/agreements/forms";
import { Field, Input, Select, Textarea } from "@/components/ui";

export type AgreementFieldValues = {
  cadence?: string;
  cadence_rule?: { every?: number; unit?: string; rounds?: number; steps?: { label: string; offset_days: number; window_days?: number }[] } | null;
  recognition?: string;
  season_start?: string | null;
  season_end?: string | null;
  skip_months?: readonly number[];
  interior_only_months?: readonly number[];
  initial_price_cents?: number | string;
  recurring_price_cents?: number | string;
  billing_mode?: string;
  term_months?: number;
  auto_renew?: boolean;
  cancel_fee_cents?: number | string;
  starts_on?: string;
  first_visit_on?: string | null;
  window_days?: number;
  terms_text?: string | null;
  notes?: string | null;
};

function dollars(cents: number | string | undefined): string {
  return cents === undefined ? "" : (Number(cents) / 100).toFixed(2);
}

/** The plan fields shared by the new-agreement and edit forms. Account, property and service type are chosen outside. */
export function AgreementFields({ prefix, values = {}, locked = false }: { prefix: string; values?: AgreementFieldValues; locked?: boolean }) {
  const id = (key: string) => `${prefix}-${key}`;
  const rule = values.cadence_rule ?? {};
  return (
    <>
      <Field label="Cadence" htmlFor={id("cadence")}>
        <Select id={id("cadence")} name="cadence" defaultValue={values.cadence ?? "quarterly"}>
          {CADENCES.map((c) => (
            <option key={c} value={c}>
              {CADENCE_LABELS[c]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Billing mode" htmlFor={id("billing")}>
        <Select id={id("billing")} name="billing_mode" defaultValue={values.billing_mode ?? "flat_monthly"}>
          {BILLING_MODES.map((m) => (
            <option key={m} value={m}>
              {BILLING_MODE_LABELS[m]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Custom interval" htmlFor={id("every")} hint="Only for a custom cadence.">
        <div className="flex gap-2">
          <Input id={id("every")} name="every" type="number" min={1} defaultValue={rule.every ?? ""} className="w-24" />
          <Select name="unit" defaultValue={rule.unit ?? "weeks"} aria-label="Interval unit">
            <option value="weeks">weeks</option>
            <option value="months">months</option>
          </Select>
        </div>
      </Field>
      <Field label="Season" htmlFor={id("rounds")} hint="Only for seasonal rounds: how many, from when to when.">
        <div className="flex flex-wrap gap-2">
          <Input id={id("rounds")} name="rounds" type="number" min={1} max={52} defaultValue={rule.rounds ?? ""} placeholder="rounds" className="w-24" />
          <Input name="season_start" type="date" defaultValue={values.season_start ?? ""} aria-label="Season start" />
          <Input name="season_end" type="date" defaultValue={values.season_end ?? ""} aria-label="Season end" />
        </div>
      </Field>
      <Field label="Job steps" htmlFor={id("job-steps")} hint="Only for a job plan: one visit per line, Label @ days after the first visit (add / days for its window). Leave empty to use the service type's plan.">
        <Textarea id={id("job-steps")} name="job_steps" rows={3} defaultValue={formatJobSteps(rule.steps)} placeholder={"Treatment @ 0\nFollow-up @ 14\nFinal check @ 28"} />
      </Field>
      <Field label="Revenue" htmlFor={id("recognition")} hint="Warranties earn their fee evenly over each year rather than at the visit.">
        <Select id={id("recognition")} name="recognition" defaultValue={values.recognition ?? "per_visit"}>
          <option value="per_visit">Earned at each visit</option>
          <option value="straight_line">Earned evenly over each term (warranty)</option>
        </Select>
      </Field>
      <Field label="Initial visit price ($)" htmlFor={id("initial")}>
        <Input id={id("initial")} name="initial_price" inputMode="decimal" defaultValue={dollars(values.initial_price_cents)} />
      </Field>
      <Field label="Recurring visit price ($)" htmlFor={id("recurring")}>
        <Input id={id("recurring")} name="recurring_price" inputMode="decimal" defaultValue={dollars(values.recurring_price_cents)} />
      </Field>
      <Field label="Starts on" htmlFor={id("starts")}>
        <Input id={id("starts")} name="starts_on" type="date" required defaultValue={values.starts_on ?? ""} readOnly={locked} />
      </Field>
      <Field label="First visit on or after" htmlFor={id("first")} hint="Defaults to the start date.">
        <Input id={id("first")} name="first_visit_on" type="date" defaultValue={values.first_visit_on ?? ""} />
      </Field>
      <Field label="Term (months)" htmlFor={id("term")}>
        <Input id={id("term")} name="term_months" type="number" min={1} max={60} defaultValue={values.term_months ?? 12} readOnly={locked} />
      </Field>
      <Field label="Early cancellation fee ($)" htmlFor={id("fee")}>
        <Input id={id("fee")} name="cancel_fee" inputMode="decimal" defaultValue={dollars(values.cancel_fee_cents ?? 0)} />
      </Field>
      <fieldset className="sm:col-span-2">
        <legend className="text-sm font-medium text-stone-700">Skipped months</legend>
        <div className="mt-1 flex flex-wrap gap-3 text-sm">
          {MONTHS.map((m, i) => (
            <label key={m} className="flex items-center gap-1">
              <input type="checkbox" name="skip_months" value={i + 1} defaultChecked={values.skip_months?.includes(i + 1) ?? false} /> {m}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="sm:col-span-2">
        <legend className="text-sm font-medium text-stone-700">Interior-only months</legend>
        <div className="mt-1 flex flex-wrap gap-3 text-sm">
          {MONTHS.map((m, i) => (
            <label key={m} className="flex items-center gap-1">
              <input type="checkbox" name="interior_only_months" value={i + 1} defaultChecked={values.interior_only_months?.includes(i + 1) ?? false} /> {m}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="auto_renew" value="true" defaultChecked={values.auto_renew ?? true} /> Auto-renew at the end of the term
      </label>
      <Field label="Due window (days)" htmlFor={id("window")} hint="For weekly cadences; monthly plans are due any day in the month.">
        <Input id={id("window")} name="window_days" type="number" min={1} max={90} defaultValue={values.window_days ?? 7} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Terms" htmlFor={id("terms")} hint="Shown to the customer when they sign. Defaults to the company's terms from settings.">
          <Textarea id={id("terms")} name="terms_text" rows={3} defaultValue={values.terms_text ?? ""} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Notes" htmlFor={id("notes")}>
          <Textarea id={id("notes")} name="notes" rows={2} defaultValue={values.notes ?? ""} />
        </Field>
      </div>
    </>
  );
}
