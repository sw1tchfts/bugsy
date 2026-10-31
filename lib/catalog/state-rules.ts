import type postgres from "postgres";
import type { ServiceLine, TreatmentArea } from "@/lib/catalog/service-lines";
import { stateDefaults } from "@/lib/catalog/state-defaults";

type Sql = postgres.Sql | postgres.TransactionSql;

/**
 * Makes sure a service type has one state rule row per state the tenant works in (plus any extra states given),
 * refreshing what the pack says. Tenant additions to the categories are kept; a tax class the tenant set is kept;
 * an unknown tax class takes the pack's answer. Used by the office actions under RLS and by the seed as superuser.
 */
export async function ensureStateRules(tx: Sql, tenantId: string, serviceTypeId: string, extraStates: readonly string[] = []): Promise<string[]> {
  const [serviceType] = await tx<{ service_line: ServiceLine; treatment_areas: TreatmentArea[] }[]>`
    select service_line, treatment_areas from public.service_types where id = ${serviceTypeId} and tenant_id = ${tenantId}`;
  if (!serviceType) return [];

  const tenantStates = await tx<{ state_code: string }[]>`select app.tenant_states(${tenantId}) as state_code`;
  const codes = new Set<string>([
    ...tenantStates.map((s) => s.state_code),
    ...extraStates.map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)),
  ]);

  for (const code of codes) {
    const defaults = stateDefaults(code, serviceType.service_line, serviceType.treatment_areas);
    await tx`
      insert into public.service_type_state_rules
        (tenant_id, service_type_id, state_code, required_cert_categories, pack_cert_categories, tax_class, pack_tax_class, pack_version)
      values
        (${tenantId}, ${serviceTypeId}, ${code}, ${defaults.certCategories}, ${defaults.certCategories}, ${defaults.taxClass}, ${defaults.taxClass}, ${defaults.packVersion})
      on conflict (service_type_id, state_code) do update set
        pack_cert_categories = excluded.pack_cert_categories,
        required_cert_categories = coalesce(
          (select array_agg(distinct c order by c) from unnest(public.service_type_state_rules.required_cert_categories || excluded.pack_cert_categories) as c),
          '{}'),
        pack_tax_class = excluded.pack_tax_class,
        tax_class = case when public.service_type_state_rules.tax_class = 'unknown' then excluded.pack_tax_class else public.service_type_state_rules.tax_class end,
        pack_version = excluded.pack_version`;
  }
  return [...codes].sort();
}
