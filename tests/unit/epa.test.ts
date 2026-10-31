import { describe, expect, it } from "vitest";
import { EPA_EXEMPT, normalizeEpaRegNo } from "@/lib/catalog/epa";

describe("EPA registration numbers (rule 9)", () => {
  it("normalizes the forms people type", () => {
    expect(normalizeEpaRegNo("7969-210")).toBe("7969-210");
    expect(normalizeEpaRegNo(" 7969 - 210 ")).toBe("7969-210");
    expect(normalizeEpaRegNo("EPA Reg. No. 7969-210")).toBe("7969-210");
    expect(normalizeEpaRegNo("epa reg no: 100-1066")).toBe("100-1066");
    expect(normalizeEpaRegNo("EPA Registration Number 432-763")).toBe("432-763");
    expect(normalizeEpaRegNo("007969-0210")).toBe("7969-210");
  });

  it("keeps distributor numbers", () => {
    expect(normalizeEpaRegNo("7969-210-12345")).toBe("7969-210-12345");
  });

  it("maps minimum-risk products to the exempt marker", () => {
    expect(normalizeEpaRegNo("25b")).toBe(EPA_EXEMPT);
    expect(normalizeEpaRegNo("25(b)")).toBe(EPA_EXEMPT);
    expect(normalizeEpaRegNo("exempt")).toBe(EPA_EXEMPT);
    expect(normalizeEpaRegNo("25b-exempt")).toBe(EPA_EXEMPT);
  });

  it("rejects anything else", () => {
    expect(normalizeEpaRegNo("")).toBeNull();
    expect(normalizeEpaRegNo("7969")).toBeNull();
    expect(normalizeEpaRegNo("abc-123")).toBeNull();
    expect(normalizeEpaRegNo("7969-210-")).toBeNull();
    expect(normalizeEpaRegNo("7969-210-1-2")).toBeNull();
  });
});
