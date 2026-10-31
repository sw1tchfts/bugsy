import { describe, expect, it } from "vitest";
import { LEAD_STAGES, type LeadStage, canTransition, nextStages } from "@/lib/customers/pipeline";

// Rule 2 of spec 02, copied as data: new to inspection_booked or quoted, inspection_booked to quoted,
// any open stage to won or lost, lost back to new. Won is final.
const ALLOWED: Record<LeadStage, LeadStage[]> = {
  new: ["inspection_booked", "quoted", "won", "lost"],
  inspection_booked: ["quoted", "won", "lost"],
  quoted: ["won", "lost"],
  won: [],
  lost: ["new"],
};

describe("lead pipeline", () => {
  it("covers every pair of stages exactly as rule 2 says", () => {
    for (const from of LEAD_STAGES) {
      for (const to of LEAD_STAGES) {
        expect(canTransition(from, to), `${from} to ${to}`).toBe(ALLOWED[from].includes(to));
      }
    }
  });

  it("lists the next stages from the same table", () => {
    for (const from of LEAD_STAGES) {
      expect([...nextStages(from)].sort()).toEqual([...ALLOWED[from]].sort());
    }
  });

  it("never allows a stage to move to itself", () => {
    for (const stage of LEAD_STAGES) expect(canTransition(stage, stage)).toBe(false);
  });
});
