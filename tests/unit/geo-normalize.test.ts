import { describe, expect, it } from "vitest";
import { normalizeAddress, normalizeEmail, phoneDigits } from "@/lib/geo/normalize";

describe("normalizeAddress", () => {
  it("produces one uppercase USPS-style line", () => {
    expect(normalizeAddress({ line1: "100 main street", city: "Columbus", stateCode: "oh", postalCode: "43215-1234" })).toBe(
      "100 MAIN ST, COLUMBUS OH 43215",
    );
  });

  it("treats spelled-out and abbreviated forms the same", () => {
    const a = normalizeAddress({ line1: "4400 East Broad Street", line2: "Suite 200", city: "Columbus", stateCode: "OH", postalCode: "43213" });
    const b = normalizeAddress({ line1: "4400 E. Broad St.", line2: "Ste 200", city: "columbus", stateCode: "OH", postalCode: "43213" });
    expect(a).toBe(b);
    expect(a).toBe("4400 E BROAD ST STE 200, COLUMBUS OH 43213");
  });

  it("normalizes unit markers", () => {
    expect(normalizeAddress({ line1: "12 Oak Ln #2B", city: "Dayton", stateCode: "OH", postalCode: "45402" })).toBe("12 OAK LN UNIT 2B, DAYTON OH 45402");
    expect(normalizeAddress({ line1: "12 Oak Lane", line2: "Apartment 2B", city: "Dayton", stateCode: "OH", postalCode: "45402" })).toBe(
      "12 OAK LN APT 2B, DAYTON OH 45402",
    );
  });
});

describe("phoneDigits", () => {
  it("keeps digits only and drops the US country code", () => {
    expect(phoneDigits("(614) 555-0100")).toBe("6145550100");
    expect(phoneDigits("+1 614 555 0100")).toBe("6145550100");
    expect(phoneDigits("1-614-555-0100")).toBe("6145550100");
  });

  it("ignores extensions and empty input", () => {
    expect(phoneDigits("614-555-0100 x12")).toBe("6145550100");
    expect(phoneDigits("")).toBeNull();
    expect(phoneDigits(null)).toBeNull();
    expect(phoneDigits("ext only x5")).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Maria@Example.COM ")).toBe("maria@example.com");
    expect(normalizeEmail("")).toBeNull();
  });
});
