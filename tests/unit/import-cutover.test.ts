import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planVisits } from "@/lib/agreements/visits";
import { defaultBilledToDate, deliveredCents, doneBeforeCutover, openingPosition, overdueAtCutover } from "@/lib/import/cutover";
import { readFile } from "@/lib/import/parse";
import { planInputOf, validateAgreement } from "@/lib/import/validate";

type Expected = {
  cutover_on: string;
  agreements: {
    external_id: string;
    visits: number;
    done_sequences: number[];
    overdue_sequences: number[];
    next_due: { sequence: number; due_start: string } | null;
    contract_total_cents: number;
    default_billed_cents: number;
    billed_cents: number;
    delivered_cents: number;
    opening_position_cents: number;
    warning: boolean;
  }[];
};

const expected = JSON.parse(readFileSync("fixtures/import/expected.json", "utf8")) as Expected;
const file = readFile("agreements", readFileSync("fixtures/import/agreements.csv", "utf8"));

describe("mid-term agreements at the cutover (spec 10 rules 7 to 10)", () => {
  it("reads every fixture agreement without a row error", () => {
    expect(file.errors).toEqual([]);
    expect(file.rows.map((r) => r.values.external_id)).toEqual(expected.agreements.map((a) => a.external_id));
  });

  for (const e of expected.agreements) {
    it(`agreement ${e.external_id}: visits done, overdue, billed to date and the opening position match the fixture`, () => {
      const row = file.rows.find((r) => r.values.external_id === e.external_id)!;
      const checked = validateAgreement(row, expected.cutover_on);
      expect(checked.errors).toEqual([]);
      const a = checked.value!;
      const planned = planVisits(planInputOf(a.columns));
      expect(planned).toHaveLength(e.visits);
      expect(planned.reduce((s, v) => s + v.price_cents, 0)).toBe(e.contract_total_cents);
      const done = doneBeforeCutover(planned, a.last_service_on);
      expect(done.map((v) => v.sequence)).toEqual(e.done_sequences);
      expect(overdueAtCutover(planned, a.last_service_on, expected.cutover_on).map((v) => v.sequence)).toEqual(e.overdue_sequences);
      const remaining = planned.filter((v) => !done.some((d) => d.sequence === v.sequence));
      expect(remaining[0] ? { sequence: remaining[0].sequence, due_start: remaining[0].due_start } : null).toEqual(e.next_due);
      expect(deliveredCents(done)).toBe(e.delivered_cents);
      const defaultBilled = defaultBilledToDate(a.columns, planned, done, expected.cutover_on);
      expect(defaultBilled).toBe(e.default_billed_cents);
      const billed = a.billed_to_date_cents ?? defaultBilled;
      expect(billed).toBe(e.billed_cents);
      expect(billed !== defaultBilled).toBe(e.warning);
      expect(openingPosition(billed, done)).toBe(e.opening_position_cents);
    });
  }
});
