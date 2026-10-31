import { describe, expect, it } from "vitest";
import { compassDirection, currentConditions, parseOpenMeteo, skyFromCode } from "@/lib/weather/provider";

describe("weather provider (rule 7)", () => {
  it("parses an answer into record conditions", () => {
    const parsed = parseOpenMeteo({ current: { temperature_2m: 61.3, wind_speed_10m: 4.6, wind_direction_10m: 300, weather_code: 2 } }, "2026-11-02T14:05:00Z");
    expect(parsed).toEqual({ temperature_f: 61.3, wind_mph: 4.6, wind_direction: "NW", sky: "partly cloudy", captured_at: "2026-11-02T14:05:00Z", source: "weather" });
    expect(parseOpenMeteo({}, "x")).toBeNull();
  });

  it("maps directions and sky codes", () => {
    expect(compassDirection(0)).toBe("N");
    expect(compassDirection(89)).toBe("E");
    expect(compassDirection(225)).toBe("SW");
    expect(compassDirection(359)).toBe("N");
    expect(skyFromCode(0)).toBe("clear");
    expect(skyFromCode(61)).toBe("rain");
    expect(skyFromCode(95)).toBe("thunderstorm");
    expect(skyFromCode(null)).toBeNull();
  });

  it("returns null when the service fails or times out", async () => {
    const failing = (async () => ({ ok: false })) as unknown as typeof fetch;
    expect(await currentConditions(40, -83, failing)).toBeNull();
    const throwing = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    expect(await currentConditions(40, -83, throwing)).toBeNull();
    const fine = (async () => ({ ok: true, json: async () => ({ current: { temperature_2m: 70, wind_speed_10m: 3, wind_direction_10m: 90, weather_code: 0 } }) })) as unknown as typeof fetch;
    expect((await currentConditions(40, -83, fine))?.wind_direction).toBe("E");
  });
});
