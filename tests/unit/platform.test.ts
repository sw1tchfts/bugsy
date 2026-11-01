import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS } from "@/lib/auth/permissions";
import type { StatePack } from "@/lib/compliance/rules";
import { STEPS, progress } from "@/lib/platform/onboarding";
import { coverage, packRules } from "@/lib/platform/rules";
import { checkRequest, grantPermissions, grantState } from "@/lib/platform/support";

const now = new Date("2027-03-10T15:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

describe("support grants (spec 13 rules 2 to 4)", () => {
  it("moves from pending to live to ended, and lapses unanswered after 7 days", () => {
    expect(grantState({ approved: null, requested_at: hoursAgo(1), expires_at: null, revoked_at: null }, now)).toBe("pending");
    expect(grantState({ approved: null, requested_at: hoursAgo(24 * 8), expires_at: null, revoked_at: null }, now)).toBe("lapsed");
    expect(grantState({ approved: true, requested_at: hoursAgo(3), expires_at: hoursAgo(-1), revoked_at: null }, now)).toBe("live");
    expect(grantState({ approved: true, requested_at: hoursAgo(3), expires_at: hoursAgo(0), revoked_at: null }, now)).toBe("expired");
    expect(grantState({ approved: true, requested_at: hoursAgo(3), expires_at: hoursAgo(-1), revoked_at: hoursAgo(0.5) }, now)).toBe("revoked");
    expect(grantState({ approved: false, requested_at: hoursAgo(3), expires_at: null, revoked_at: null }, now)).toBe("denied");
  });

  it("gives a read grant every read permission and nothing else, and a write grant all but people, settings and imports", () => {
    const read = grantPermissions("read");
    expect(read.length).toBeGreaterThan(5);
    expect(read.every((p) => p.endsWith(".read"))).toBe(true);
    expect(read).toContain("audit.read");
    const write = grantPermissions("write");
    expect(write).toContain("billing.write");
    expect(write).not.toContain("users.write");
    expect(write).not.toContain("settings.write");
    expect(write).not.toContain("data.import");
    expect(write).not.toContain("*");
    expect(write.length).toBe(ALL_PERMISSIONS.length - 3);
  });

  it("checks a request before it is sent", () => {
    expect(checkRequest({ access: "read", hours: 2, reason: "Statements print without a footer" })).toEqual([]);
    expect(checkRequest({ access: "admin", hours: 0, reason: "short" })).toHaveLength(3);
    expect(checkRequest({ access: "write", hours: 73, reason: "Fixing an import mapping" })).toEqual(["Ask for 1 to 72 hours."]);
  });
});

describe("the setup checklist (spec 13 rule 9)", () => {
  it("counts done steps and names the first one left, in order", () => {
    expect(progress({})).toMatchObject({ done: 0, total: STEPS.length, complete: false });
    expect(progress({}).next?.key).toBe("details");
    const most = Object.fromEntries(STEPS.map((s) => [s.key, s.key !== "payments" && s.key !== "first_route"]));
    expect(progress(most)).toMatchObject({ done: STEPS.length - 2, complete: false });
    expect(progress(most).next?.key).toBe("payments");
    expect(progress(Object.fromEntries(STEPS.map((s) => [s.key, true])))).toMatchObject({ complete: true, next: null });
  });
});

describe("the rule pack console (spec 13 rule 12)", () => {
  const pack: StatePack = {
    stateCode: "ZZ",
    version: "2027.1",
    effectiveOn: "2027-01-01",
    rules: { "records.retentionYears": { value: 2, source: "Example Admin Code 1.2", effectiveOn: "2027-01-01" }, "notice.electronicNeedsConsent": { value: true, source: "Example Stat 3", effectiveOn: "2026-07-01" } },
  };

  it("lists every rule with its source and date, and marks the states without a pack", () => {
    expect(packRules(pack)).toEqual([
      { key: "notice.electronicNeedsConsent", value: "true", source: "Example Stat 3", effectiveOn: "2026-07-01" },
      { key: "records.retentionYears", value: "2", source: "Example Admin Code 1.2", effectiveOn: "2027-01-01" },
    ]);
    const rows = coverage([{ state_code: "ZZ", companies: 1, properties: 4 }, { state_code: "YY", companies: 2, properties: 9 }], { ZZ: pack });
    expect(rows.map((r) => [r.state_code, r.pack?.version ?? null])).toEqual([["ZZ", "2027.1"], ["YY", null]]);
  });
});
