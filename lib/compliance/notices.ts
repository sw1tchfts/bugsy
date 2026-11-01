// The notice engine (spec 07 rules 6 to 8): which notices a visit, agreement or property needs, when each is due and by
// which channel, as a pure function of the state's rule pack, the contacts' consent and the property. Nothing here
// names a state; without a pack the conservative defaults from the pesticide-compliance skill apply.
import { isPesticideVisit } from "@/lib/compliance/records";
import type { NoticeChannel, StatePack } from "@/lib/compliance/rules";
import { addBusinessDays, addDays, endOfDayInZone, startOfDayInZone } from "@/lib/dates";
import type { JobKind, TreatmentArea } from "@/lib/catalog/service-lines";

export type NoticeKind = "post_application" | "pre_application_offer" | "resident_notice" | "posting_sign" | "registry_advance" | "other";

export const NOTICE_KIND_LABELS: Record<NoticeKind, string> = {
  post_application: "Post-application information",
  pre_application_offer: "Pre-application offer",
  resident_notice: "Resident notice",
  posting_sign: "Posted sign",
  registry_advance: "Registry advance notice",
  other: "Other",
};

export type NoticeContact = {
  id: string;
  role: string;
  unit_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  e_notice_consent_at: string | null;
};

export type RegistryEntry = { id: string; kind: string; name: string | null; address: string; phone: string | null; email: string | null };

export type NoticeVisit = {
  id: string;
  scheduled_for: string | null;
  arrived_at: string | null;
  departed_at: string | null;
  job_kind: JobKind;
  treatment_areas: TreatmentArea[];
  products: { rei_hours: number | null }[];
  account: { name: string };
  property: { id: string; type: string; state: string; unit_count: number | null; address: string };
  registry: RegistryEntry[];
};

export type NoticeAgreement = { id: string; property_id: string; first_visit_on: string | null; signed_at: string | null };

export type NoticeInput = {
  visit: NoticeVisit | null;
  agreement: NoticeAgreement | null;
  contacts: NoticeContact[];
  timeZone: string;
};

export type NoticeSpec = {
  kind: NoticeKind;
  rule_key: string;
  required: boolean;
  dedupe_key: string;
  visit_id: string | null;
  agreement_id: string | null;
  property_id: string;
  unit_id: string | null;
  recipient_contact_id: string | null;
  recipient_name: string;
  recipient_address: string | null;
  recipient_email: string | null;
  recipient_phone: string | null;
  channel: NoticeChannel;
  due_by: string | null;
  for_scheduled_for: string | null;
};

const ALL_CHANNELS: NoticeChannel[] = ["email", "sms", "print", "mail"];

/** Whether email or text may be used for this contact: the pack says consent is not needed, or consent is on file. */
export function electronicAllowed(contact: Pick<NoticeContact, "e_notice_consent_at">, pack: StatePack | undefined): boolean {
  const needsConsent = pack?.rules["notice.electronicNeedsConsent"]?.value ?? true;
  return !needsConsent || contact.e_notice_consent_at !== null;
}

/** The channel a notice to this contact goes by: electronic when allowed and the contact has an address for it, else paper. */
export function channelFor(contact: NoticeContact, pack: StatePack | undefined, allowed: readonly NoticeChannel[] = ALL_CHANNELS): NoticeChannel {
  const electronic = electronicAllowed(contact, pack);
  if (electronic && contact.email && allowed.includes("email")) return "email";
  if (electronic && contact.phone && allowed.includes("sms")) return "sms";
  // Paper: a contact reachable only by post is mailed; anyone else gets a printed copy handed over or left.
  if (contact.address && !contact.email && !contact.phone && allowed.includes("mail")) return "mail";
  if (allowed.includes("print")) return "print";
  if (allowed.includes("mail") && contact.address) return "mail";
  return "phone";
}

function recipient(contact: NoticeContact): Pick<NoticeSpec, "recipient_contact_id" | "recipient_name" | "recipient_address" | "recipient_email" | "recipient_phone"> {
  return { recipient_contact_id: contact.id, recipient_name: contact.name, recipient_address: contact.address, recipient_email: contact.email, recipient_phone: contact.phone };
}

function isMultiUnit(property: NoticeVisit["property"]): boolean {
  return property.type === "apartment_building" || (property.unit_count ?? 0) > 1;
}

/** Everything the pack (or, without one, the conservative default) requires for this visit, agreement and property. */
export function requiredNotices(input: NoticeInput, pack: StatePack | undefined): NoticeSpec[] {
  const specs: NoticeSpec[] = [];
  const { visit, agreement, contacts, timeZone } = input;
  const primary = contacts.find((c) => c.role === "primary") ?? contacts.find((c) => c.role === "billing") ?? null;

  if (visit && visit.departed_at && isPesticideVisit(visit.job_kind)) {
    const departed = visit.departed_at;
    const base = { visit_id: visit.id, agreement_id: null, property_id: visit.property.id, unit_id: null, for_scheduled_for: visit.scheduled_for };

    // Post-application information to the customer.
    const post = pack?.rules["notice.postApplication"]?.value;
    const customer: NoticeContact = primary ?? { id: "", role: "primary", unit_id: null, name: visit.account.name, email: null, phone: null, address: visit.property.address, e_notice_consent_at: null };
    const customerRecipient = primary ? recipient(primary) : { recipient_contact_id: null, recipient_name: visit.account.name, recipient_address: visit.property.address, recipient_email: null, recipient_phone: null };
    specs.push({
      kind: "post_application",
      rule_key: post ? "notice.postApplication" : "default",
      required: Boolean(post),
      dedupe_key: `post_application:${visit.id}`,
      ...base,
      ...customerRecipient,
      channel: channelFor(customer, pack, post?.channels ?? ALL_CHANNELS),
      due_by: post ? endOfDayInZone(addDays(dateOf(departed, timeZone), post.withinDays), timeZone) : null,
    });

    // Residents and occupants of multi-unit properties.
    const resident = pack?.rules["notice.resident"]?.value;
    const residentsApply = resident ? resident.propertyTypes.includes(visit.property.type) || (resident.propertyTypes.includes("multi_unit") && isMultiUnit(visit.property)) : isMultiUnit(visit.property);
    if (residentsApply) {
      const residents = contacts.filter((c) => c.role === "resident");
      for (const r of residents) {
        specs.push({
          kind: "resident_notice",
          rule_key: resident ? "notice.resident" : "default",
          required: Boolean(resident),
          dedupe_key: `resident_notice:${visit.id}:${r.id}`,
          ...base,
          unit_id: r.unit_id,
          ...recipient(r),
          channel: channelFor(r, pack, resident?.channels ?? ALL_CHANNELS),
          due_by: resident ? departed : null,
        });
      }
      if (residents.length === 0) {
        specs.push({
          kind: "posting_sign",
          rule_key: resident ? "notice.resident" : "default",
          required: Boolean(resident),
          dedupe_key: `resident_posting:${visit.id}`,
          ...base,
          recipient_contact_id: null,
          recipient_name: `Residents of ${visit.property.address}`,
          recipient_address: visit.property.address,
          recipient_email: null,
          recipient_phone: null,
          channel: "posted",
          due_by: resident ? departed : null,
        });
      }
    }

    // A sign when a product carries a restricted entry interval.
    const sign = pack?.rules["sign.restrictedEntry"]?.value;
    if (visit.products.some((p) => (p.rei_hours ?? 0) > 0)) {
      specs.push({
        kind: "posting_sign",
        rule_key: sign ? "sign.restrictedEntry" : "default",
        required: Boolean(sign),
        dedupe_key: `rei_posting:${visit.id}`,
        ...base,
        recipient_contact_id: null,
        recipient_name: "Treated property",
        recipient_address: visit.property.address,
        recipient_email: null,
        recipient_phone: null,
        channel: "posted",
        due_by: sign ? (sign.when === "before" ? (visit.arrived_at ?? departed) : departed) : null,
      });
    }
  }

  // Advance notice to registry addresses before a scheduled visit that matches.
  if (visit && visit.scheduled_for && visit.registry.length > 0 && registryApplies(visit, pack)) {
    const hours = pack?.rules["registry.advanceNoticeHours"]?.value ?? 0;
    const mailDays = pack?.rules["registry.mailLeadBusinessDays"]?.value ?? 0;
    const start = startOfDayInZone(visit.scheduled_for, timeZone);
    for (const entry of visit.registry) {
      const channel: NoticeChannel = entry.email ? "email" : entry.address ? "mail" : "phone";
      const dueBy =
        channel === "mail" && mailDays > 0 ? startOfDayInZone(addBusinessDays(visit.scheduled_for, -mailDays), timeZone) : new Date(new Date(start).getTime() - hours * 3_600_000).toISOString();
      specs.push({
        kind: "registry_advance",
        rule_key: pack ? "registry.advanceNoticeHours" : "default",
        required: true,
        dedupe_key: `registry_advance:${visit.id}:${entry.id}:${visit.scheduled_for}`,
        visit_id: visit.id,
        agreement_id: null,
        property_id: visit.property.id,
        unit_id: null,
        recipient_contact_id: null,
        recipient_name: entry.name ?? `Registry ${entry.kind}`,
        recipient_address: entry.address,
        recipient_email: entry.email,
        recipient_phone: entry.phone,
        channel,
        due_by: dueBy,
        for_scheduled_for: visit.scheduled_for,
      });
    }
  }

  // The offer of advance notice on a continuing contract, before its first application.
  const offer = pack?.rules["notice.preApplicationOffer"]?.value;
  if (agreement && agreement.signed_at && agreement.first_visit_on && offer) {
    const contact = primary;
    specs.push({
      kind: "pre_application_offer",
      rule_key: "notice.preApplicationOffer",
      required: true,
      dedupe_key: `pre_application_offer:${agreement.id}`,
      visit_id: null,
      agreement_id: agreement.id,
      property_id: agreement.property_id,
      unit_id: null,
      ...(contact ? recipient(contact) : { recipient_contact_id: null, recipient_name: "Customer", recipient_address: null, recipient_email: null, recipient_phone: null }),
      channel: contact ? channelFor(contact, pack) : "print",
      due_by: startOfDayInZone(addDays(agreement.first_visit_on, -offer.beforeFirstApplicationDays), timeZone),
      for_scheduled_for: agreement.first_visit_on,
    });
  }

  return specs;
}

/** Registry matches block (and need notice) when the pack's triggers cover the work, or whenever no pack exists. */
export function registryApplies(visit: Pick<NoticeVisit, "job_kind" | "treatment_areas">, pack: StatePack | undefined): boolean {
  if (!pack) return true;
  const triggers = pack.rules["registry.triggers"]?.value;
  if (!triggers) return false;
  return Boolean(triggers.jobKinds?.includes(visit.job_kind) || triggers.treatmentAreas?.some((a) => visit.treatment_areas.includes(a)));
}

function dateOf(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
}
