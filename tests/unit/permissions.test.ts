import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, can, isOwnerRole } from "@/lib/auth/permissions";

describe("permissions", () => {
  it("grants only what a role lists", () => {
    expect(can(["customers.read"], "customers.read")).toBe(true);
    expect(can(["customers.read"], "customers.write")).toBe(false);
    expect(can([], "settings.write")).toBe(false);
  });

  it("treats * as every permission and as ownership", () => {
    for (const permission of ALL_PERMISSIONS) expect(can(["*"], permission)).toBe(true);
    expect(isOwnerRole(["*"])).toBe(true);
    expect(isOwnerRole(["settings.write", "users.write"])).toBe(false);
  });

  it("lists every permission exactly once", () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });
});
