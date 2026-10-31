import { afterEach, describe, expect, it, vi } from "vitest";
import { googleProvider } from "@/lib/geo/google";
import { normalizeAddress } from "@/lib/geo/normalize";

const address = { line1: "1234 Neil Ave", city: "Columbus", stateCode: "oh", postalCode: "43201" };

function answer(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({ ok, json: async () => body });
}

afterEach(() => vi.unstubAllGlobals());

describe("google geo provider (rule 4: a provider failure never blocks the save)", () => {
  it("returns failed with the address still normalized when the request throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await googleProvider("key").normalize(address);
    expect(result.status).toBe("failed");
    expect(result.normalizedAddress).toBe(normalizeAddress(address));
    expect(result.stateCode).toBe("OH");
    expect(result.lat).toBeNull();
    expect(result.lng).toBeNull();
  });

  it("returns failed when the API answers with an error status", async () => {
    vi.stubGlobal("fetch", answer({}, false));
    const result = await googleProvider("key").normalize(address);
    expect(result.status).toBe("failed");
    expect(result.normalizedAddress).toBe(normalizeAddress(address));
  });

  it("returns failed when the answer carries no coordinates", async () => {
    vi.stubGlobal("fetch", answer({ result: { address: { postalAddress: { addressLines: ["1234 NEIL AVE"] } } } }));
    const result = await googleProvider("key").normalize(address);
    expect(result.status).toBe("failed");
    expect(result.county).toBeNull();
  });

  it("maps a complete answer to ok with county and coordinates", async () => {
    vi.stubGlobal(
      "fetch",
      answer({
        result: {
          address: {
            postalAddress: { addressLines: ["1234 Neil Ave"], locality: "Columbus", administrativeArea: "OH", postalCode: "43201" },
            addressComponents: [{ componentType: "administrative_area_level_2", componentName: { text: "Franklin County" } }],
          },
          geocode: { location: { latitude: 39.985, longitude: -83.011 } },
          verdict: { addressComplete: true },
        },
      }),
    );
    const result = await googleProvider("key").normalize(address);
    expect(result.status).toBe("ok");
    expect(result.county).toBe("Franklin");
    expect(result.lat).toBe(39.985);
    expect(result.lng).toBe(-83.011);
    expect(result.normalizedAddress).toBe(normalizeAddress({ ...address, stateCode: "OH" }));
  });

  it("marks an incomplete verdict as failed even with coordinates", async () => {
    vi.stubGlobal(
      "fetch",
      answer({
        result: {
          address: { postalAddress: { addressLines: ["1234 Neil Ave"], locality: "Columbus", administrativeArea: "OH", postalCode: "43201" } },
          geocode: { location: { latitude: 39.985, longitude: -83.011 } },
          verdict: { addressComplete: false },
        },
      }),
    );
    const result = await googleProvider("key").normalize(address);
    expect(result.status).toBe("failed");
  });
});
