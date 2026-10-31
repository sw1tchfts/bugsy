// The dispatch check: may this crew do this visit on this date at this property? Pure. Every rule value comes from
// the state pack or the service type's state rules; nothing here names a state, a date range or a category.
import { type JobKind, PESTICIDE_JOB_KINDS, type TreatmentArea } from "@/lib/catalog/service-lines";
import { type StatePack, blackoutRanges } from "@/lib/compliance/rules";
import { daysBetween } from "@/lib/dates";

export const ARRIVAL_WINDOWS = ["any", "morning", "afternoon", "evening"] as const;
export type ArrivalWindow = (typeof ARRIVAL_WINDOWS)[number];
export const ARRIVAL_WINDOW_LABELS: Record<ArrivalWindow, string> = { any: "Any time", morning: "Morning", afternoon: "Afternoon", evening: "Evening" };
const WINDOW_RANK: Record<ArrivalWindow, number> = { any: 0, morning: 1, afternoon: 2, evening: 3 };

export const CREW_ROLES = ["lead", "applicator", "supervisor", "helper"] as const;
export type CrewRole = (typeof CREW_ROLES)[number];
export const CREW_ROLE_LABELS: Record<CrewRole, string> = { lead: "Lead", applicator: "Applicator", supervisor: "Supervisor", helper: "Helper" };

export type Credential = {
  cert_number: string | null;
  categories: readonly string[];
  cert_expires_on: string | null;
  license_expires_on: string | null;
  trainee_registered_on: string | null;
  supervisor_id: string | null;
};

export type CrewMember = {
  user_id: string;
  name: string;
  role: CrewRole;
  /** The member's credential in the property's state, or null when they have none there. */
  credential: Credential | null;
  /** Branches the member works from; null means every branch. */
  branch_ids: readonly string[] | null;
};

export type CheckVisit = {
  job_kind: JobKind;
  treatment_areas: readonly TreatmentArea[];
  due_start: string;
  due_end: string;
  scheduled_for: string;
  arrival_window: ArrivalWindow;
  property_state: string;
  registry_matches: unknown;
  branch_id: string | null;
};

export type StateRuleInput = { required_cert_categories: readonly string[]; pack_version: string | null; confirmed_at: string | null } | null;

export type DayStop = { id: string; arrival_window: ArrivalWindow; route_position: number };

export type CheckInput = {
  visit: CheckVisit;
  stateRule: StateRuleInput;
  crew: readonly CrewMember[];
  pack: StatePack | undefined;
  today: string;
  /** The technician's other stops that day, with the visit itself at its intended position, for the order warning. */
  dayStops?: readonly DayStop[];
  visitId?: string;
  /** For the link in a state-rules refusal. */
  serviceTypeId?: string;
};

export type Issue = { code: string; message: string; href?: string };
export type CheckResult = { ok: boolean; blockers: Issue[]; warnings: Issue[] };

function inMonthDayRange(iso: string, range: { from: string; to: string }): boolean {
  const md = iso.slice(5);
  return range.from <= range.to ? md >= range.from && md <= range.to : md >= range.from || md <= range.to;
}

function hasRegistryMatches(value: unknown): boolean {
  if (!value) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return false;
}

/** A registered trainee or technician-in-training is not a certified applicator, whatever else the row carries. */
export function isTrainee(c: Pick<Credential, "trainee_registered_on">): boolean {
  return c.trainee_registered_on !== null;
}

/** A certified, current applicator with every required category on the given date. */
function qualifies(c: Credential | null, required: readonly string[], date: string): { ok: true } | { ok: false; code: string; detail: string } {
  if (!c) return { ok: false, code: "no_credential", detail: "no credential in this state" };
  if (isTrainee(c)) return { ok: false, code: "trainee", detail: "is a registered trainee" };
  if (c.cert_expires_on && c.cert_expires_on < date) return { ok: false, code: "cert_expired", detail: `certification expired ${c.cert_expires_on}` };
  if (c.license_expires_on && c.license_expires_on < date) return { ok: false, code: "license_expired", detail: `license expired ${c.license_expires_on}` };
  const missing = required.filter((r) => !c.categories.includes(r));
  if (missing.length) return { ok: false, code: "missing_categories", detail: `lacks categor${missing.length === 1 ? "y" : "ies"} ${missing.join(", ")}` };
  return { ok: true };
}

export function checkAssignment(input: CheckInput): CheckResult {
  const { visit, stateRule, crew, pack, today } = input;
  const blockers: Issue[] = [];
  const warnings: Issue[] = [];
  const date = visit.scheduled_for;
  const state = visit.property_state;

  if (crew.length === 0) blockers.push({ code: "no_crew", message: "Assign a technician." });

  // Rule 3 applies to every assignment in the state, pesticide or not: without a pack or a confirmation, nothing is dispatched there.
  const rulesHref = input.serviceTypeId ? `/catalog/service-types/${input.serviceTypeId}` : undefined;
  if (!stateRule) {
    blockers.push({ code: "no_state_rules", message: `This service type has no state rules for ${state} yet. Refresh its state rules in the catalog.`, href: rulesHref });
  } else if (!stateRule.pack_version && !stateRule.confirmed_at) {
    blockers.push({ code: "state_rules_unconfirmed", message: `No rule pack is researched for ${state}, and a licensed manager has not confirmed this service type's ${state} rules. Confirm them in the catalog to dispatch there.`, href: rulesHref });
  }

  const pesticide = PESTICIDE_JOB_KINDS.includes(visit.job_kind);
  if (pesticide) {
    const required = stateRule?.required_cert_categories ?? [];
    const applicators = crew.filter((m) => m.role === "lead" || m.role === "applicator");
    const qualifiedSupervisors = crew.filter((m) => (m.role === "supervisor" || m.role === "lead") && qualifies(m.credential, required, date).ok);
    for (const member of applicators) {
      const q = qualifies(member.credential, required, date);
      if (q.ok) continue;
      if (q.code === "trainee" && member.credential) {
        const maxDays = pack?.rules["trainee.maxDays"]?.value;
        const registered = member.credential.trainee_registered_on as string;
        if (typeof maxDays === "number" && daysBetween(registered, date) > maxDays) {
          blockers.push({ code: "trainee_over_limit", message: `${member.name} has been a trainee longer than ${state} allows (${maxDays} days from ${registered}).` });
        }
        if (!qualifiedSupervisors.some((s) => s.user_id !== member.user_id)) {
          blockers.push({ code: "trainee_unsupervised", message: `${member.name} is a registered trainee and needs a certified supervisor or lead on the crew.` });
        }
        if (typeof maxDays !== "number" || !pack?.rules["trainee.supervision"]) {
          warnings.push({ code: "trainee_rules_unknown", message: `Trainee limits for ${state} are not in a rule pack yet; a supervisor on site is required until they are.` });
        }
        continue;
      }
      blockers.push({ code: q.code, message: `${member.name} ${q.detail} (${state}).` });
    }
    for (const range of blackoutRanges(pack, visit.job_kind)) {
      if (inMonthDayRange(date, range)) {
        blockers.push({ code: "blackout", message: `${state} does not allow ${visit.job_kind.replace(/_/g, " ")} between ${range.from} and ${range.to}.` });
        break;
      }
    }
  } else {
    for (const range of blackoutRanges(pack, visit.job_kind)) {
      if (inMonthDayRange(date, range)) {
        blockers.push({ code: "blackout", message: `${state} does not allow ${visit.job_kind.replace(/_/g, " ")} between ${range.from} and ${range.to}.` });
        break;
      }
    }
  }

  const triggers = pack?.rules["registry.triggers"]?.value;
  if (triggers && hasRegistryMatches(visit.registry_matches)) {
    const byArea = (triggers.treatmentAreas ?? []).some((a) => visit.treatment_areas.includes(a));
    const byKind = (triggers.jobKinds ?? []).includes(visit.job_kind);
    if (byArea || byKind) {
      blockers.push({ code: "registry_notice_due", message: `This address is on the ${state} notification registry; the advance notice must be recorded before this work is scheduled (compliance, spec 07).` });
    }
  }

  if (date < visit.due_start || date > visit.due_end) {
    warnings.push({ code: "outside_window", message: `Scheduled ${date}, outside the due window ${visit.due_start} to ${visit.due_end}.` });
  }
  if (date < today) warnings.push({ code: "past_date", message: `${date} is in the past.` });
  for (const member of crew) {
    if (member.branch_ids && visit.branch_id && !member.branch_ids.includes(visit.branch_id)) {
      warnings.push({ code: "branch_mismatch", message: `${member.name} does not work from this visit's branch.` });
    }
  }
  if (input.dayStops) {
    const ordered = [...input.dayStops].sort((a, b) => a.route_position - b.route_position);
    let highest = 0;
    for (const stop of ordered) {
      const rank = WINDOW_RANK[stop.arrival_window];
      if (rank === 0) continue;
      if (rank < highest) {
        warnings.push({ code: "window_order", message: "A morning or afternoon stop is ordered after a later window; reorder the day." });
        break;
      }
      highest = Math.max(highest, rank);
    }
  }

  return { ok: blockers.length === 0, blockers, warnings };
}
