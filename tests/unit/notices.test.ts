import { describe, expect, it } from "vitest";
import { type NoticeContact, type NoticeInput, type NoticeVisit, channelFor, registryApplies, requiredNotices } from "@/lib/compliance/notices";
import type { StatePack } from "@/lib/compliance/rules";

// A fixture pack for a state that cannot exist; no real rule is invented here.
const ZZ: StatePack = {
  stateCode: "ZZ",
  version: "test-1",
  effectiveOn: "2026-01-01",
  rules: {
    "notice.postApplication": { value: { withinDays: 2, channels: ["email", "sms", "print", "mail"] }, source: "fixture", effectiveOn: "2026-01-01" },
    "notice.electronicNeedsConsent": { value: true, source: "fixture", effectiveOn: "2026-01-01" },
    "notice.resident": { value: { propertyTypes: ["apartment_building"], channels: ["print", "posted"] }, source: "fixture", effectiveOn: "2026-01-01" },
    "notice.preApplicationOffer": { value: { beforeFirstApplicationDays: 7 }, source: "fixture", effectiveOn: "2026-01-01" },
    "sign.restrictedEntry": { value: { when: "after", removeAfterHours: 24 }, source: "fixture", effectiveOn: "2026-01-01" },
    "registry.triggers": { value: { treatmentAreas: ["yard"] }, source: "fixture", effectiveOn: "2026-01-01" },
    "registry.advanceNoticeHours": { value: 24, source: "fixture", effectiveOn: "2026-01-01" },
    "registry.mailLeadBusinessDays": { value: 3, source: "fixture", effectiveOn: "2026-01-01" },
  },
};

const TZ = "America/New_York";

const primary: NoticeContact = { id: "c1", role: "primary", unit_id: null, name: "Maria Lopez", email: "maria@example.test", phone: "6145550100", address: "1234 Neil Ave", e_notice_consent_at: null };

function visit(overrides: Partial<NoticeVisit> = {}): NoticeVisit {
  return {
    id: "v1",
    scheduled_for: "2026-10-31",
    arrived_at: "2026-11-01T01:30:00Z",
    // 22:30 on October 31 in New York (still daylight time); the clocks fall back the next morning.
    departed_at: "2026-11-01T02:30:00Z",
    job_kind: "recurring_treatment",
    treatment_areas: ["perimeter"],
    products: [{ rei_hours: null }],
    account: { name: "Maria Lopez" },
    property: { id: "p1", type: "house", state: "ZZ", unit_count: null, address: "1234 Neil Ave, Columbus ZZ 43201" },
    registry: [],
    ...overrides,
  };
}

function input(overrides: Partial<NoticeInput> = {}): NoticeInput {
  return { visit: visit(), agreement: null, contacts: [primary], timeZone: TZ, ...overrides };
}

const ofKind = (specs: ReturnType<typeof requiredNotices>, kind: string) => specs.filter((s) => s.kind === kind);

describe("notices from the pack (rules 6 and 8)", () => {
  it("creates the post-application notice due at the end of the business day withinDays after departure, across the fall-back night", () => {
    const [post] = ofKind(requiredNotices(input(), ZZ), "post_application");
    expect(post.required).toBe(true);
    expect(post.rule_key).toBe("notice.postApplication");
    // Departure is October 31 in New York; two days later is November 2, whose end is 23:59:59 EST (UTC-5).
    expect(post.due_by).toBe("2026-11-03T04:59:59.000Z");
    expect(post.recipient_contact_id).toBe("c1");
    expect(post.dedupe_key).toBe("post_application:v1");
  });

  it("picks the channel from consent: paper without it, email with it, email when the pack needs no consent", () => {
    expect(channelFor(primary, ZZ)).toBe("print");
    expect(channelFor({ ...primary, e_notice_consent_at: "2026-01-01T00:00:00Z" }, ZZ)).toBe("email");
    expect(channelFor({ ...primary, e_notice_consent_at: "2026-01-01T00:00:00Z", email: null }, ZZ)).toBe("sms");
    const lax: StatePack = { ...ZZ, rules: { ...ZZ.rules, "notice.electronicNeedsConsent": { value: false, source: "fixture", effectiveOn: "2026-01-01" } } };
    expect(channelFor(primary, lax)).toBe("email");
    expect(channelFor({ ...primary, email: null, phone: null }, ZZ, ["mail"])).toBe("mail");
  });

  it("notifies each resident of an apartment building, and posts a sign when none is on file", () => {
    const residents: NoticeContact[] = [
      { id: "r1", role: "resident", unit_id: "u1", name: "Unit 1", email: null, phone: null, address: null, e_notice_consent_at: null },
      { id: "r2", role: "resident", unit_id: "u2", name: "Unit 2", email: null, phone: null, address: null, e_notice_consent_at: null },
    ];
    const building = visit({ property: { id: "p2", type: "apartment_building", state: "ZZ", unit_count: 12, address: "9 Elm St" } });
    const withResidents = ofKind(requiredNotices(input({ visit: building, contacts: [primary, ...residents] }), ZZ), "resident_notice");
    expect(withResidents.map((s) => s.recipient_contact_id)).toEqual(["r1", "r2"]);
    expect(withResidents.every((s) => s.required && s.due_by === building.departed_at && s.channel === "print")).toBe(true);
    const posted = requiredNotices(input({ visit: building }), ZZ).filter((s) => s.dedupe_key === "resident_posting:v1");
    expect(posted).toHaveLength(1);
    expect(posted[0].kind).toBe("posting_sign");
    expect(posted[0].channel).toBe("posted");
    expect(ofKind(requiredNotices(input(), ZZ), "resident_notice")).toHaveLength(0);
  });

  it("posts a sign after an application of a product with a restricted entry interval", () => {
    const specs = requiredNotices(input({ visit: visit({ products: [{ rei_hours: 4 }] }) }), ZZ);
    const sign = specs.find((s) => s.dedupe_key === "rei_posting:v1");
    expect(sign?.rule_key).toBe("sign.restrictedEntry");
    expect(sign?.required).toBe(true);
    expect(sign?.due_by).toBe("2026-11-01T02:30:00Z");
    expect(requiredNotices(input(), ZZ).find((s) => s.dedupe_key === "rei_posting:v1")).toBeUndefined();
  });

  it("gives every registry match an advance notice: hours before the day by email, business days before by mail", () => {
    const registry = [
      { id: "g1", kind: "general", name: "A", address: "1 Main St", phone: null, email: "a@example.test" },
      { id: "g2", kind: "general", name: "B", address: "2 Main St", phone: null, email: null },
    ];
    // November 10, 2026 is a Tuesday in standard time.
    const specs = ofKind(requiredNotices(input({ visit: visit({ scheduled_for: "2026-11-10", treatment_areas: ["yard"], registry }) }), ZZ), "registry_advance");
    expect(specs).toHaveLength(2);
    const [byEmail, byMail] = specs;
    expect(byEmail.channel).toBe("email");
    expect(byEmail.due_by).toBe("2026-11-09T05:00:00.000Z");
    expect(byMail.channel).toBe("mail");
    expect(byMail.due_by).toBe("2026-11-05T05:00:00.000Z");
    expect(specs.every((s) => s.required && s.for_scheduled_for === "2026-11-10")).toBe(true);
    expect(byEmail.dedupe_key).toBe("registry_advance:v1:g1:2026-11-10");
  });

  it("counts the hours before a visit across the spring-forward night", () => {
    // March 15, 2027 starts at 00:00 EDT (04:00 UTC); 24 real hours earlier is 04:00 UTC on March 14, which is 23:00 EST on
    // March 13: the hour the clocks skip never shortens the lead time.
    const registry = [{ id: "g1", kind: "general", name: null, address: "1 Main St", phone: null, email: "a@example.test" }];
    const [spec] = ofKind(requiredNotices(input({ visit: visit({ scheduled_for: "2027-03-15", treatment_areas: ["yard"], registry }) }), ZZ), "registry_advance");
    expect(spec.due_by).toBe("2027-03-14T04:00:00.000Z");
  });

  it("applies the registry only to the work the pack names, and to everything without a pack", () => {
    const registry = [{ id: "g1", kind: "general", name: null, address: "1 Main St", phone: null, email: null }];
    const interior = visit({ scheduled_for: "2026-11-10", treatment_areas: ["interior"], registry });
    expect(registryApplies(interior, ZZ)).toBe(false);
    expect(ofKind(requiredNotices(input({ visit: interior }), ZZ), "registry_advance")).toHaveLength(0);
    expect(registryApplies(interior, undefined)).toBe(true);
    const [noPack] = ofKind(requiredNotices(input({ visit: interior }), undefined), "registry_advance");
    expect(noPack.required).toBe(true);
    expect(noPack.rule_key).toBe("default");
    expect(noPack.due_by).toBe("2026-11-10T05:00:00.000Z");
  });

  it("offers advance notice on a continuing contract before its first application", () => {
    const [offer] = ofKind(requiredNotices(input({ visit: null, agreement: { id: "a1", property_id: "p1", first_visit_on: "2026-11-20", signed_at: "2026-11-01T00:00:00Z" } }), ZZ), "pre_application_offer");
    expect(offer.due_by).toBe("2026-11-13T05:00:00.000Z");
    expect(offer.recipient_contact_id).toBe("c1");
    expect(offer.channel).toBe("print");
    expect(ofKind(requiredNotices(input({ visit: null, agreement: { id: "a1", property_id: "p1", first_visit_on: "2026-11-20", signed_at: "2026-11-01T00:00:00Z" } }), undefined), "pre_application_offer")).toHaveLength(0);
  });

  it("creates nothing for a visit that applied no pesticide", () => {
    expect(requiredNotices(input({ visit: visit({ job_kind: "inspection" }) }), ZZ)).toHaveLength(0);
  });
});

describe("notices without a pack (rule 7)", () => {
  it("keeps the customer summary as best practice with no legal due time, and paper without consent", () => {
    const [post] = ofKind(requiredNotices(input(), undefined), "post_application");
    expect(post.required).toBe(false);
    expect(post.rule_key).toBe("default");
    expect(post.due_by).toBeNull();
    expect(post.channel).toBe("print");
  });

  it("notifies residents of any multi-unit property and posts for a restricted entry interval, as best practice", () => {
    const multi = visit({ property: { id: "p3", type: "other", state: "ZZ", unit_count: 3, address: "5 Oak St" }, products: [{ rei_hours: 2 }] });
    const specs = requiredNotices(input({ visit: multi }), undefined);
    expect(specs.find((s) => s.dedupe_key === "resident_posting:v1")?.required).toBe(false);
    expect(specs.find((s) => s.dedupe_key === "rei_posting:v1")?.required).toBe(false);
    expect(specs.find((s) => s.dedupe_key === "rei_posting:v1")?.due_by).toBeNull();
  });
});
