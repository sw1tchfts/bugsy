import { Field, Input, Select, Textarea } from "@/components/ui";
import { SIGNAL_WORDS } from "@/lib/catalog/product-form";

export type ProductValues = {
  name?: string;
  manufacturer?: string | null;
  epa_reg_no?: string;
  active_ingredients?: string[];
  signal_word?: string;
  restricted_use?: boolean;
  rei_hours?: string | number | null;
  formulation?: string | null;
  label_url?: string | null;
  sds_url?: string | null;
  label_rates?: unknown;
  upc?: string | null;
};

/** The product definition fields shared by the office "add a product" form and the platform console. */
export function ProductFields({ prefix, values = {}, withLabelRates = false }: { prefix: string; values?: ProductValues; withLabelRates?: boolean }) {
  const id = (key: string) => `${prefix}-${key}`;
  return (
    <>
      <Field label="Product name" htmlFor={id("name")} hint="As printed on the label.">
        <Input id={id("name")} name="name" required maxLength={120} defaultValue={values.name ?? ""} />
      </Field>
      <Field label="Manufacturer" htmlFor={id("manufacturer")}>
        <Input id={id("manufacturer")} name="manufacturer" maxLength={120} defaultValue={values.manufacturer ?? ""} />
      </Field>
      <Field label="EPA registration number" htmlFor={id("epa")} hint="For example 7969-210, or 25b-exempt for a minimum-risk product.">
        <Input id={id("epa")} name="epa_reg_no" required defaultValue={values.epa_reg_no ?? ""} />
      </Field>
      <Field label="Active ingredients" htmlFor={id("ai")} hint="Comma separated, with percentages.">
        <Input id={id("ai")} name="active_ingredients" defaultValue={(values.active_ingredients ?? []).join(", ")} />
      </Field>
      <Field label="Signal word" htmlFor={id("signal")}>
        <Select id={id("signal")} name="signal_word" defaultValue={values.signal_word ?? "caution"}>
          {SIGNAL_WORDS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Formulation" htmlFor={id("formulation")} hint="For example suspension concentrate, gel bait, dust.">
        <Input id={id("formulation")} name="formulation" maxLength={80} defaultValue={values.formulation ?? ""} />
      </Field>
      <Field label="Restricted entry interval (hours)" htmlFor={id("rei")}>
        <Input id={id("rei")} name="rei_hours" inputMode="decimal" defaultValue={values.rei_hours === null || values.rei_hours === undefined ? "" : String(values.rei_hours)} />
      </Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" name="restricted_use" value="true" defaultChecked={values.restricted_use ?? false} /> Restricted-use pesticide
      </label>
      <Field label="Label link" htmlFor={id("label")}>
        <Input id={id("label")} name="label_url" type="url" defaultValue={values.label_url ?? ""} />
      </Field>
      <Field label="SDS link" htmlFor={id("sds")}>
        <Input id={id("sds")} name="sds_url" type="url" defaultValue={values.sds_url ?? ""} />
      </Field>
      <Field label="Barcode (UPC)" htmlFor={id("upc")} hint="The digits under the bars on the label, so technicians can scan it in the app.">
        <Input id={id("upc")} name="upc" maxLength={32} defaultValue={values.upc ?? ""} />
      </Field>
      {withLabelRates ? (
        <div className="sm:col-span-2">
          <Field
            label="Label rates (JSON)"
            htmlFor={id("rates")}
            hint='One entry per site, for example [{"site":"perimeter","min_rate":0.2,"max_rate":0.8,"rate_unit":"fl_oz/gal","target_pests":["ants"]}].'
          >
            <Textarea id={id("rates")} name="label_rates" rows={3} defaultValue={values.label_rates ? JSON.stringify(values.label_rates) : ""} className="font-mono text-xs" />
          </Field>
        </div>
      ) : null}
    </>
  );
}
