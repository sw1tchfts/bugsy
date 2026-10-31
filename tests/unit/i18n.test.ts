import { describe, expect, it } from "vitest";
import { MESSAGES, gapMessage, t } from "@/lib/tech/i18n";

describe("technician app strings (rule 9)", () => {
  it("has a Spanish string for every English key, and none empty", () => {
    const enKeys = Object.keys(MESSAGES.en);
    for (const key of enKeys) {
      const es = (MESSAGES.es as Record<string, string>)[key];
      expect(es, `missing Spanish for ${key}`).toBeTruthy();
    }
    expect(Object.keys(MESSAGES.es).length).toBe(enKeys.length);
  });

  it("interpolates variables and falls back to English", () => {
    expect(t("es", "app.pending", { count: 3 })).toBe("3 cambio(s) por sincronizar");
    expect(t("fr", "route.title")).toBe("My route");
    expect(t("en", "not.a.key")).toBe("not.a.key");
    expect(t("en", "stop.arrivedAt", {})).toBe("Arrived {time}");
  });

  it("translates gap keys, generic for pack fields", () => {
    expect(gapMessage("es", "products")).toBe("Al menos un producto aplicado");
    expect(gapMessage("en", "conditions.wind_mph")).toBe("Required by the state: conditions.wind_mph");
  });

  it("never uses the dash or arrow characters the project forbids", () => {
    for (const table of Object.values(MESSAGES)) {
      for (const text of Object.values(table)) expect(text).not.toMatch(/[\u2013\u2014\u2192]/);
    }
  });
});
