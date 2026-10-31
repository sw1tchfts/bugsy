import { describe, expect, it } from "vitest";
import { LEAD_STAGES, canTransition, nextStages } from "@/lib/customers/pipeline";

describe("lead pipeline", () => {
  it("allows the spec's transitions", () => {
    expect(canTransition("new", "inspection_booked")).toBe(true);
    expect(canTransition("new", "quoted")).toBe(true);
    expect(canTransition("inspection_booked", "quoted")).toBe(true);
    for (const open of ["new", "inspection_booked", "quoted"] as const) {
      expect(canTransition(open, "won")).toBe(true);
      expect(canTransition(open, "lost")).toBe(true);
    }
    expect(canTransition("lost", "new")).toBe(true);
  });

  it("forbids everything else", () => {
    expect(canTransition("quoted", "new")).toBe(false);
    expect(canTransition("quoted", "inspection_booked")).toBe(false);
    expect(canTransition("inspection_booked", "new")).toBe(false);
    expect(nextStages("won")).toEqual([]);
    expect(canTransition("lost", "quoted")).toBe(false);
    for (const stage of LEAD_STAGES) expect(canTransition(stage, stage)).toBe(false);
  });
});
