// Spec 15 seed: per company, the specialty service types (a bed bug job plan with its prep checklist, a wildlife
// trapping job, a yearly termite warranty, the real estate WDI report), and one of each kind of job: a bed bug job
// with a prep check, a wildlife job with the owner's authorization, a capture and materials, a termite warranty
// earned evenly over its year (with the property's foundation plan, termite stations and diagram marks), and a WDI
// inspection with a draft report. Idempotent. Called from seed.ts after the ledger and commercial seeds.
import type postgres from "postgres";
import { syncVisits } from "../lib/agreements/db";
import { issuePrepayments } from "../lib/billing/db";
import { ensureStateRules } from "../lib/catalog/state-rules";
import { templateByKey } from "../lib/catalog/service-lines";
import { floorPlan } from "../lib/commercial/image";
import { addDays, addMonths, startOfMonth, todayInZone } from "../lib/dates";
import { putFile } from "../lib/files";
import { postStraightLine } from "../lib/ledger/db";
import type { SeedTenant } from "./seed-data";
import { seedUserEmail } from "./seed-data";

type Sql = postgres.Sql;

export const BED_BUG_PLAN = [
  { label: "Treatment", offset_days: 0, window_days: 3 },
  { label: "Follow-up", offset_days: 14, window_days: 3 },
  { label: "Final follow-up", offset_days: 28, window_days: 3 },
];
export const BED_BUG_PREP = [
  "Wash and dry all bedding and clothing on high heat, then bag it",
  "Clear the floor and under the beds",
  "Pull furniture 12 inches from the walls",
  "Keep pets and people out of treated rooms for 4 hours",
];
const WILDLIFE_PLAN = [
  { label: "Set traps", offset_days: 0, window_days: 1 },
  { label: "Trap check", offset_days: 2, window_days: 1 },
  { label: "Trap check", offset_days: 4, window_days: 1 },
  { label: "Exclusion and repair", offset_days: 7, window_days: 3 },
];
export const WARRANTY_FEE_CENTS = 29500;

async function upsertType(sql: Sql, tenantId: string, values: Record<string, unknown>): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into public.service_types ${sql({ tenant_id: tenantId, ...values })}
    on conflict (tenant_id, lower(name)) where archived_at is null do update set job_plan = excluded.job_plan, prep_checklist = excluded.prep_checklist
    returning id`;
  return row.id;
}

async function confirmRules(sql: Sql, tenantId: string, serviceTypeId: string, managerId: string | null): Promise<void> {
  const states = await sql<{ state_code: string }[]>`select distinct state_code from public.branches where tenant_id = ${tenantId}`;
  await ensureStateRules(sql, tenantId, serviceTypeId, states.map((s) => s.state_code));
  if (managerId) {
    await sql`update public.service_type_state_rules set confirmed_at = now(), confirmed_by = ${managerId}
              where tenant_id = ${tenantId} and service_type_id = ${serviceTypeId} and pack_version is null and confirmed_at is null`;
  }
}

async function target(sql: Sql, tenantId: string, account: string, property: string): Promise<{ account_id: string; property_id: string } | null> {
  const [row] = await sql<{ account_id: string; property_id: string }[]>`
    select a.id as account_id, p.id as property_id from public.accounts a join public.properties p on p.account_id = a.id
    where a.tenant_id = ${tenantId} and a.name = ${account} and p.name = ${property} and p.archived_at is null order by p.created_at limit 1`;
  return row ?? null;
}

type JobSeed = {
  key: string;
  account: string;
  property: string;
  serviceTypeId: string;
  cadence: string;
  cadence_rule: Record<string, unknown>;
  billing_mode: string;
  recognition?: string;
  initial: number;
  recurring: number;
  starts_on: string;
};

async function job(sql: Sql, tenantId: string, ownerId: string, branchId: string | null, s: JobSeed): Promise<{ id: string; account_id: string; property_id: string } | null> {
  const where = await target(sql, tenantId, s.account, s.property);
  if (!where) return null;
  const [existing] = await sql<{ id: string }[]>`select id from public.agreements where tenant_id = ${tenantId} and notes = ${`seed:${s.key}`}`;
  if (existing) return { id: existing.id, ...where };
  const [row] = await sql<{ id: string }[]>`
    insert into public.agreements ${sql({
      tenant_id: tenantId,
      account_id: where.account_id,
      property_id: where.property_id,
      service_type_id: s.serviceTypeId,
      branch_id: branchId,
      status: "draft",
      cadence: s.cadence,
      cadence_rule: sql.json(s.cadence_rule as postgres.JSONValue),
      skip_months: [],
      interior_only_months: [],
      initial_price_cents: s.initial,
      recurring_price_cents: s.recurring,
      billing_mode: s.billing_mode,
      recognition: s.recognition ?? "per_visit",
      term_months: 12,
      auto_renew: s.recognition === "straight_line",
      cancel_fee_cents: 0,
      starts_on: s.starts_on,
      first_visit_on: s.starts_on,
      terms_text: "Demo terms: the visits listed for the price shown.",
      notes: `seed:${s.key}`,
      created_by: ownerId,
    })} returning id`;
  await sql`update public.agreements set status = 'active', signed_at = ${s.starts_on}::date::timestamptz, signed_name = ${s.account}, signed_ip = '127.0.0.1' where id = ${row.id}`;
  await syncVisits(sql, tenantId, row.id);
  return { id: row.id, ...where };
}

async function firstVisit(sql: Sql, agreementId: string): Promise<{ id: string; status: string } | null> {
  const [v] = await sql<{ id: string; status: string }[]>`select id, status from public.visits where agreement_id = ${agreementId} order by due_start, sequence limit 1`;
  return v ?? null;
}

export async function seedSpecialty(sql: Sql, tenant: SeedTenant, tenantId: string): Promise<void> {
  const today = todayInZone(tenant.timezone);
  const [owner] = await sql<{ id: string }[]>`select id from auth.users where email = ${seedUserEmail(tenant, "owner")}`;
  const [manager] = await sql<{ id: string }[]>`select id from auth.users where email = ${seedUserEmail(tenant, "compliance_manager")}`;
  const [tech] = await sql<{ user_id: string }[]>`
    select m.user_id from public.memberships m join public.roles r on r.id = m.role_id where m.tenant_id = ${tenantId} and r.key = 'technician' limit 1`;
  const [branch] = await sql<{ id: string }[]>`select id from public.branches where tenant_id = ${tenantId} and archived_at is null order by created_at limit 1`;

  // Service types: the bed bug job's plan and prep list, a wildlife job, the warranty, the real estate report.
  await sql`update public.service_types set job_plan = ${sql.json(BED_BUG_PLAN)}, prep_checklist = ${BED_BUG_PREP}
            where tenant_id = ${tenantId} and job_kind = 'bed_bug_treatment' and archived_at is null`;
  const [bedBug] = await sql<{ id: string }[]>`select id from public.service_types where tenant_id = ${tenantId} and job_kind = 'bed_bug_treatment' and archived_at is null limit 1`;
  const wildlifeT = templateByKey("wildlife_trapping")!;
  const wildlife = await upsertType(sql, tenantId, {
    service_line: "wildlife",
    name: "Wildlife removal and exclusion",
    description: "Trap set, trap checks, then exclusion and repair, sold as one job. The owner's authorization comes first.",
    job_kind: wildlifeT.jobKind,
    treatment_areas: [],
    pricing_method: "bid",
    default_duration_minutes: 60,
    job_plan: sql.json(WILDLIFE_PLAN),
    prep_checklist: [],
  });
  const warranty = await upsertType(sql, tenantId, {
    service_line: "termite",
    name: "Termite warranty",
    description: "Yearly termite warranty: an annual reinspection, renewed each year; the fee is earned evenly over the year.",
    job_kind: "inspection",
    treatment_areas: [],
    pricing_method: "price_book",
    default_duration_minutes: 60,
    job_plan: null,
    prep_checklist: [],
  });
  const wdiT = templateByKey("wdi_report")!;
  const wdi = await upsertType(sql, tenantId, {
    service_line: "termite",
    name: wdiT.name,
    description: wdiT.description,
    job_kind: wdiT.jobKind,
    treatment_areas: [],
    pricing_method: "bid",
    default_duration_minutes: wdiT.defaultDurationMinutes,
    job_plan: sql.json([{ label: "Inspection and report", offset_days: 0, window_days: 3 }]),
    prep_checklist: [],
  });
  for (const id of [bedBug?.id, wildlife, warranty, wdi].filter((x): x is string => Boolean(x))) await confirmRules(sql, tenantId, id, manager?.id ?? null);
  if (!owner) return;

  // A bed bug job at Harbor View Building B starting today: the first visit's prep check says the unit was not ready.
  if (bedBug) {
    const bb = await job(sql, tenantId, owner.id, branch?.id ?? null, {
      key: "harbor-bedbug",
      account: "Harbor View Apartments",
      property: "Building B",
      serviceTypeId: bedBug.id,
      cadence: "job_plan",
      cadence_rule: { steps: BED_BUG_PLAN },
      billing_mode: "per_visit",
      initial: 65000,
      recurring: 0,
      starts_on: addDays(today, 7),
    });
    const v = bb ? await firstVisit(sql, bb.id) : null;
    if (v && v.status !== "completed") {
      await sql`insert into public.prep_checks (tenant_id, visit_id, ready, missing, notes)
                values (${tenantId}, ${v.id}, false, ${[BED_BUG_PREP[1]]}, 'Unit 4 still had boxes under the bed; treated around them.')
                on conflict (visit_id) do nothing`;
    }
  }

  // A wildlife job at the Green residence: the owner's authorization, a raccoon caught, and the materials used.
  const wl = await job(sql, tenantId, owner.id, branch?.id ?? null, {
    key: "green-wildlife",
    account: "Green Residence",
    property: "Home",
    serviceTypeId: wildlife,
    cadence: "job_plan",
    cadence_rule: { steps: WILDLIFE_PLAN },
    billing_mode: "per_visit",
    initial: 35000,
    recurring: 7500,
    starts_on: addDays(today, 10),
  });
  if (wl) {
    const [auth] = await sql<{ id: string }[]>`select id from public.job_authorizations where agreement_id = ${wl.id} limit 1`;
    if (!auth) {
      await sql`insert into public.job_authorizations (tenant_id, agreement_id, signer_name, relationship, signed_on, scope, recorded_by)
                values (${tenantId}, ${wl.id}, 'Dana Green', 'owner', ${today}, 'Traps on the grounds and the attic; exclusion work on the house.', ${owner.id})`;
    }
    const v = await firstVisit(sql, wl.id);
    if (v && v.status !== "completed") {
      const [has] = await sql<{ n: number }[]>`select count(*)::int as n from public.wildlife_captures where visit_id = ${v.id}`;
      if (!has.n) {
        await sql`insert into public.wildlife_captures (tenant_id, visit_id, species, count, disposition, location, notes)
                  values (${tenantId}, ${v.id}, 'Raccoon', 1, 'relocated', 'Attic, by the soffit gap', 'Adult female; relocated per the permit.')`;
        await sql`insert into public.visit_materials (tenant_id, visit_id, description, quantity, unit, unit_price_cents, billable)
                  values (${tenantId}, ${v.id}, 'Galvanized hardware cloth, 1/4 inch', 6, 'sq ft', 450, true),
                         (${tenantId}, ${v.id}, 'Trap bait', 1, 'each', 0, false)`;
      }
    }
  }

  // A termite warranty at the Patel home, four months in on annual prepay, earned evenly over its year.
  const thisMonth = startOfMonth(today);
  const tw = await job(sql, tenantId, owner.id, branch?.id ?? null, {
    key: "patel-warranty",
    account: "Patel Family",
    property: "Home",
    serviceTypeId: warranty,
    cadence: "custom",
    cadence_rule: { every: 12, unit: "months" },
    billing_mode: "annual_prepay",
    recognition: "straight_line",
    initial: WARRANTY_FEE_CENTS,
    recurring: WARRANTY_FEE_CENTS,
    starts_on: addMonths(thisMonth, -4),
  });
  if (tw) {
    // The yearly reinspection that opened the warranty was done.
    await sql`update public.visits set status = 'scheduled', scheduled_for = due_start, technician_id = ${tech?.user_id ?? null}
              where agreement_id = ${tw.id} and status = 'planned' and due_end < ${today}`;
    await sql`
      update public.visits set status = 'completed', arrived_at = (due_start::timestamp + interval '9 hours'), departed_at = (due_start::timestamp + interval '10 hours'),
        completed_at = (due_start::timestamp + interval '10 hours')
      where agreement_id = ${tw.id} and status = 'scheduled' and due_end < ${today} and scheduled_for = due_start`;
    // The year's fee is billed up front (annual prepay), then earned month by month.
    await issuePrepayments(sql, tenantId, today, tenant.timezone);
    await postStraightLine(sql, tenantId, today);
    // The property's foundation plan with its termite stations and the inspector's marks.
    const [map] = await sql<{ id: string }[]>`select id from public.site_maps where property_id = ${tw.property_id} limit 1`;
    if (!map) {
      const png = await floorPlan(800, 500);
      const fileId = await putFile(sql, tenantId, { kind: "document", contentType: "image/png", data: png });
      const [m] = await sql<{ id: string }[]>`
        insert into public.site_maps (tenant_id, property_id, name, file_id, width, height) values (${tenantId}, ${tw.property_id}, 'House, foundation plan', ${fileId}, 800, 500) returning id`;
      const stations = [
        { n: "T1", location: "North wall, by the hose bib", x: 0.3, y: 0.04 },
        { n: "T2", location: "East wall, under the deck", x: 0.97, y: 0.5 },
        { n: "T3", location: "South wall, by the garage", x: 0.6, y: 0.96 },
        { n: "T4", location: "West wall, by the AC unit", x: 0.03, y: 0.45 },
      ];
      for (const s of stations) {
        await sql`insert into public.devices (tenant_id, property_id, number, kind, zone, location, map_id, x, y, installed_on)
                  values (${tenantId}, ${tw.property_id}, ${s.n}, 'termite_station', 'perimeter', ${s.location}, ${m.id}, ${s.x}, ${s.y}, ${addMonths(thisMonth, -4)})`;
      }
      await sql`insert into public.diagram_marks (tenant_id, property_id, map_id, kind, x, y, label)
                values (${tenantId}, ${tw.property_id}, ${m.id}, 'evidence', 0.62, 0.9, 'Old mud tubes on the garage sill plate'),
                       (${tenantId}, ${tw.property_id}, ${m.id}, 'treated', 0.5, 0.06, 'Trenched and treated along the north wall'),
                       (${tenantId}, ${tw.property_id}, ${m.id}, 'moisture', 0.12, 0.7, 'Wet crawlspace corner by the downspout')`;
    }
  }

  // A real estate WDI inspection at the Maria Lopez home, on the technician's route tomorrow, with a draft report.
  const wd = await job(sql, tenantId, owner.id, branch?.id ?? null, {
    key: "lopez-wdi",
    account: "Maria Lopez",
    property: "Home",
    serviceTypeId: wdi,
    cadence: "job_plan",
    cadence_rule: { steps: [{ label: "Inspection and report", offset_days: 0, window_days: 3 }] },
    billing_mode: "per_visit",
    initial: 12500,
    recurring: 0,
    starts_on: addDays(today, 1),
  });
  if (wd && tech) {
    const v = await firstVisit(sql, wd.id);
    if (v && v.status === "planned") {
      await sql`update public.visits set status = 'scheduled', scheduled_for = due_start, technician_id = ${tech.user_id}, route_position = 99 where id = ${v.id}`;
      await sql`insert into public.visit_crew (tenant_id, visit_id, user_id, role) values (${tenantId}, ${v.id}, ${tech.user_id}, 'lead') on conflict (visit_id, user_id) do nothing`;
    }
    if (v) {
      await sql`insert into public.wdi_reports (tenant_id, visit_id, requested_by, buyer, seller, structures)
                values (${tenantId}, ${v.id}, 'Lakeview Realty, J. Ortiz', 'Sam and Lee Carter', 'Maria Lopez', 'House and detached garage')
                on conflict (visit_id) do nothing`;
    }
  }
}
