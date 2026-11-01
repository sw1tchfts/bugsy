import { describe, expect, it } from "vitest";
import { chooseChannel, e164, keyword, nextAllowed, normalizeAddress, smsSegments, withinQuietHours } from "@/lib/messaging/rules";

describe("carrier keywords (spec 11 rule 3)", () => {
  it("knows STOP, START and HELP and their synonyms only as the whole message", () => {
    for (const k of ["STOP", " stop ", "Stop.", "UNSUBSCRIBE", "cancel", "End", "QUIT", "stopall"]) expect(keyword(k)).toBe("stop");
    for (const k of ["START", "unstop", "Yes"]) expect(keyword(k)).toBe("start");
    expect(keyword("HELP")).toBe("help");
    expect(keyword("please stop by tomorrow")).toBeNull();
    expect(keyword("running late?")).toBeNull();
  });
});

describe("SMS segments", () => {
  it("counts 160 GSM characters to one segment and 153 per part beyond, 70 and 67 for Unicode", () => {
    expect(smsSegments("a".repeat(160))).toBe(1);
    expect(smsSegments("a".repeat(161))).toBe(2);
    expect(smsSegments("a".repeat(306))).toBe(2);
    expect(smsSegments("a".repeat(307))).toBe(3);
    expect(smsSegments("{".repeat(80))).toBe(1);
    expect(smsSegments("{".repeat(81))).toBe(2);
    expect(smsSegments("é".repeat(160))).toBe(1);
    expect(smsSegments("✓".repeat(70))).toBe(1);
    expect(smsSegments("✓".repeat(71))).toBe(2);
  });
});

describe("quiet hours in the company's zone (spec 11 rule 4)", () => {
  const ny = "America/New_York";
  const day = { start: "08:00", end: "21:00" };
  it("allows texts between the start and the end, local time", () => {
    expect(withinQuietHours(new Date("2026-11-02T13:00:00Z"), ny, day)).toBe(true); // 08:00 EST
    expect(withinQuietHours(new Date("2026-11-02T12:59:00Z"), ny, day)).toBe(false); // 07:59
    expect(withinQuietHours(new Date("2026-11-03T01:59:00Z"), ny, day)).toBe(true); // 20:59
    expect(withinQuietHours(new Date("2026-11-03T02:00:00Z"), ny, day)).toBe(false); // 21:00
    expect(withinQuietHours(new Date("2026-07-01T12:00:00Z"), ny, day)).toBe(true); // 08:00 EDT
  });
  it("wraps midnight when the end is before the start, and allows any hour when they are equal", () => {
    const night = { start: "22:00", end: "06:00" };
    expect(withinQuietHours(new Date("2026-11-03T04:00:00Z"), ny, night)).toBe(true); // 23:00
    expect(withinQuietHours(new Date("2026-11-02T17:00:00Z"), ny, night)).toBe(false); // 12:00
    expect(withinQuietHours(new Date("2026-11-02T08:00:00Z"), ny, { start: "00:00", end: "00:00" })).toBe(true);
  });
  it("holds a text sent at night until the next allowed minute, across a DST change", () => {
    expect(nextAllowed(new Date("2026-11-03T02:30:00Z"), ny, day).toISOString()).toBe("2026-11-03T13:00:00.000Z");
    // Saturday 2026-03-07 22:00 EST: the next 08:00 is Sunday, which is EDT (UTC-4).
    expect(nextAllowed(new Date("2026-03-08T03:00:00Z"), ny, day).toISOString()).toBe("2026-03-08T12:00:00.000Z");
    const ok = new Date("2026-11-02T15:00:00Z");
    expect(nextAllowed(ok, ny, day)).toBe(ok);
  });
});

describe("the channel for a visit message (spec 11 rule 7)", () => {
  const c = { email: "m@example.com", phone: "614-555-0100", sms_opt_in: true, preferred_channel: null };
  it("prefers what the contact chose when usable, else SMS with opt-in, else email", () => {
    expect(chooseChannel(c)).toBe("sms");
    expect(chooseChannel({ ...c, preferred_channel: "email" })).toBe("email");
    expect(chooseChannel({ ...c, sms_opt_in: false })).toBe("email");
    expect(chooseChannel({ ...c, preferred_channel: "sms", sms_opt_in: false })).toBe("email");
    expect(chooseChannel(c, { sms: true, email: false })).toBe("email");
    expect(chooseChannel({ ...c, email: null, sms_opt_in: false })).toBeNull();
  });
  it("normalizes addresses for matching and E.164 for sending", () => {
    expect(normalizeAddress("sms", "+1 (614) 555-0100")).toBe("6145550100");
    expect(normalizeAddress("email", " Maria@Example.COM ")).toBe("maria@example.com");
    expect(e164("614.555.0100")).toBe("+16145550100");
    expect(e164("1-614-555-0100")).toBe("+16145550100");
    expect(e164("555-0100")).toBeNull();
  });
});
