// Spec 07 seed: a completed, fully captured visit from yesterday with a locked record, one amendment and a printed
// post-application notice; a registry with one matching property; a credential expiring in 45 days; a branch license.
// Idempotent: a second run adds nothing. Called from seed.ts after the technician seed.
import type postgres from "postgres";
import { createNotices, noticesForVisit, runCompliance } from "../lib/compliance/db";
import { hashRow } from "../lib/compliance/registry";
import { PESTICIDE_JOB_KINDS } from "../lib/catalog/service-lines";
import { addDays, addMonths, fromTenantLocal, todayInZone } from "../lib/dates";
import { scheduleVisit } from "../lib/dispatch/db";
import { putFile } from "../lib/files";
import { type SeedTenant, seedUserEmail } from "./seed-data";
import { DEMO_SIGNATURE } from "./seed-technician";

type Sql = postgres.Sql;

export async function seedCompliance(sql: Sql, tenant: SeedTenant, tenantId: string): Promise<void> {
  const today = todayInZone(tenant.timezone);
  const yesterday = addDays(today, -1);
  const state = tenant.branches[0].stateCode;
  const year = Number(today.slice(0, 4));
  const userId = async (key: Parameters<typeof seedUserEmail>[1]) => (await sql<{ id: string }[]>`select id from auth.users where email = ${seedUserEmail(tenant, key)}`)[0].id;
  const technician = await userId("technician");
  const manager = await userId("compliance_manager");
  const office = await userId("office");

  // The licensed manager's own certification lapses in 45 days (a 60-day alert); the technician's stays current, since
  // the demo and the tests schedule months ahead. The main branch holds a license, the second does not.
  await sql`update public.applicator_credentials set cert_expires_on = ${addDays(today, 45)} where tenant_id = ${tenantId} and user_id = ${manager} and archived_at is null`;
  await sql`update public.applicator_credentials set cert_expires_on = ${addMonths(today, 14)} where tenant_id = ${tenantId} and user_id = ${technician} and archived_at is null and cert_expires_on < ${addMonths(today, 14)}`;
  const branches = await sql<{ id: string }[]>`select id from public.branches where tenant_id = ${tenantId} and archived_at is null order by created_at`;
  if (branches[0]) {
    await sql`update public.branches set business_license_number = coalesce(business_license_number, ${`${state}-BUS-2201`}), license_year = coalesce(license_year, ${year}), license_expires_on = coalesce(license_expires_on, ${addDays(today, 200)}) where id = ${branches[0].id}`;
  }

  // One completed visit yesterday with everything the record needs.
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from public.application_records where tenant_id = ${tenantId}`;
  if (n === 0) {
    const [planned] = await sql<{ id: string; account_id: string }[]>`
      select v.id, v.account_id from public.visits v join public.service_types st on st.id = v.service_type_id
      where v.tenant_id = ${tenantId} and v.status = 'planned' and st.job_kind = any(${[...PESTICIDE_JOB_KINDS]}::text[])
      order by v.due_start, v.sequence limit 1`;
    if (planned) {
      const result = await scheduleVisit(sql, tenantId, planned.id, technician, yesterday, today);
      if (!result.ok) console.warn(`seed: could not schedule yesterday's visit: ${result.blockers.map((b) => b.message).join(" ")}`);
      else {
        const arrived = fromTenantLocal(`${yesterday}T09:05:00`, tenant.timezone) as Date;
        const departed = fromTenantLocal(`${yesterday}T09:50:00`, tenant.timezone) as Date;
        await sql`update public.visits set status = 'in_progress', arrived_at = ${arrived}, started_by = ${technician} where id = ${planned.id}`;
        const [product] = await sql<{ id: string }[]>`select id from public.products where tenant_id is null and epa_reg_no = '100-1066'`;
        await sql`
          insert into public.visit_products (tenant_id, visit_id, product_id, applied_by, site_treated, location_description, amount, amount_unit, carrier_amount, carrier_unit, target_pests, label_check, recorded_at)
          values (${tenantId}, ${planned.id}, ${product.id}, ${technician}, 'perimeter', 'Foundation band, all sides', 0.5, 'fl_oz', 1, 'gal', ${["ants", "spiders"]},
                  ${sql.json({ status: "ok", reason: "0.5 fl_oz/gal is within the label" })}, ${new Date(arrived.getTime() + 15 * 60_000)})`;
        await sql`
          insert into public.visit_notes (tenant_id, visit_id, kind, content, recorded_at) values
            (${tenantId}, ${planned.id}, 'note', 'Perimeter treated; spider webbing cleared from the eaves.', ${new Date(arrived.getTime() + 30 * 60_000)}),
            (${tenantId}, ${planned.id}, 'recommendation', 'Keep firewood off the foundation and trim the hedge back from the siding.', ${new Date(arrived.getTime() + 32 * 60_000)})`;
        await sql`update public.visits set areas_treated = ${["perimeter"]}, target_pests = ${["ants", "spiders"]},
                  conditions = ${sql.json({ temperature_f: 64, wind_mph: 4, wind_direction: "NW", sky: "clear", captured_at: arrived.toISOString(), source: "manual" })}
                  where id = ${planned.id}`;
        const [contact] = await sql<{ name: string }[]>`
          select coalesce(c.name, a.name) as name from public.accounts a left join public.contacts c on c.account_id = a.id and c.role = 'primary' and c.archived_at is null
          where a.id = ${planned.account_id} order by c.created_at limit 1`;
        const signatureId = await putFile(sql, tenantId, { kind: "signature", contentType: "image/svg+xml", data: new TextEncoder().encode(DEMO_SIGNATURE) });
        await sql`insert into public.visit_signatures (tenant_id, visit_id, file_id, signer_name, signed_at) values (${tenantId}, ${planned.id}, ${signatureId}, ${contact?.name ?? "Customer"}, ${new Date(departed.getTime() - 3 * 60_000)})`;
        await sql`update public.visits set status = 'completed', departed_at = ${departed}, completed_at = ${departed} where id = ${planned.id}`;
      }
    }
  }

  // A registry entry for one property that is not Maria Lopez's (the end-to-end tests use hers).
  const [property] = await sql<{ id: string; line1: string; line2: string | null; city: string; postal_code: string; normalized_address: string }[]>`
    select p.id, p.line1, p.line2, p.city, p.postal_code, p.normalized_address from public.properties p join public.accounts a on a.id = p.account_id
    where p.tenant_id = ${tenantId} and p.state_code = ${state} and p.archived_at is null and a.name <> 'Maria Lopez' order by p.created_at limit 1`;
  if (property) {
    const row = { name: "Registered neighbor", line1: property.line1, line2: property.line2, city: property.city, postal_code: property.postal_code, normalized_address: property.normalized_address, contact_name: null, phone: "614-555-0199", email: null, notes: "Chemical sensitivity; wants a call the day before." };
    await sql`
      insert into public.notification_registries ${sql({ tenant_id: tenantId, state_code: state, registry_kind: "general", registry_year: year, ...row, row_hash: hashRow(row) })}
      on conflict (tenant_id, state_code, registry_kind, registry_year, row_hash) do nothing`;
    await sql`select app.rematch_registry_state(${tenantId}, ${state})`;
  }

  // The job: the record is created and locked (yesterday's end of day has passed), notices and tasks follow.
  await runCompliance(sql, tenantId, tenant.timezone);

  // The manager corrected the wind speed; the office printed the customer's post-application notice.
  const [record] = await sql<{ id: string; visit_id: string }[]>`select id, visit_id from public.application_records where tenant_id = ${tenantId} and status = 'locked' and complete order by business_date desc limit 1`;
  if (record) {
    const [{ amended }] = await sql<{ amended: number }[]>`select count(*)::int as amended from public.application_record_amendments where record_id = ${record.id}`;
    if (amended === 0) {
      await sql`insert into public.application_record_amendments (tenant_id, record_id, changed_fields, reason, author_id)
                values (${tenantId}, ${record.id}, ${sql.json({ "conditions.wind_mph": { from: 4, to: 6 } })}, 'Technician read the gauge again: 6 mph, not 4.', ${manager})`;
    }
    await createNotices(sql, tenantId, await noticesForVisit(sql, tenantId, record.visit_id, tenant.timezone));
    await sql`update public.notices set status = 'sent', channel = 'print', sent_at = now(),
              proof = ${sql.json({ method: "print", recorded_by: office, recorded_at: new Date().toISOString(), note: "printed at the office and mailed with the invoice" })}
              where tenant_id = ${tenantId} and visit_id = ${record.visit_id} and kind = 'post_application' and status = 'due'`;
  }

  const [{ exported }] = await sql<{ exported: number }[]>`select count(*)::int as exported from public.compliance_exports where tenant_id = ${tenantId}`;
  if (exported === 0) {
    await sql`insert into public.compliance_exports (tenant_id, from_date, to_date, state_code, file_count, created_by) values (${tenantId}, ${addDays(today, -30)}, ${today}, ${state}, 7, ${manager})`;
  }
}
