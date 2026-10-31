import { describe, expect, it } from "vitest";
import { type DuplicateCandidate, decodeMatches, encodeMatches, matchDuplicates } from "@/lib/customers/duplicates";

const candidates: DuplicateCandidate[] = [
  { kind: "account", id: "a1", label: "Maria Lopez", phoneDigits: "6145550100", email: "maria@example.com" },
  { kind: "property", id: "p1", label: "100 MAIN ST, COLUMBUS OH 43215", normalizedAddress: "100 MAIN ST, COLUMBUS OH 43215" },
  { kind: "contact", id: "c1", label: "Jo Resident", phoneDigits: "6145550199", email: null },
  { kind: "lead", id: "l1", label: "Sam Lead", phoneDigits: null, email: "sam@example.com", normalizedAddress: "9 ELM ST, DAYTON OH 45402" },
];

describe("matchDuplicates", () => {
  it("matches on normalized address", () => {
    const m = matchDuplicates(candidates, { normalizedAddress: "100 MAIN ST, COLUMBUS OH 43215" });
    expect(m.map((x) => x.id)).toEqual(["p1"]);
    expect(m[0].matchedOn).toEqual(["address"]);
  });

  it("matches on phone in any format and on email case-insensitively", () => {
    expect(matchDuplicates(candidates, { phone: "+1 (614) 555-0100" }).map((x) => x.id)).toEqual(["a1"]);
    expect(matchDuplicates(candidates, { email: "SAM@example.com" }).map((x) => x.id)).toEqual(["l1"]);
  });

  it("reports every field that matched and nothing for a clean probe", () => {
    const m = matchDuplicates(candidates, { phone: "614-555-0100", email: "maria@example.com" });
    expect(m[0].matchedOn).toEqual(["phone", "email"]);
    expect(matchDuplicates(candidates, { phone: "614-555-0000", email: "new@example.com", normalizedAddress: "1 NOWHERE RD, X OH 00000" })).toEqual([]);
    expect(matchDuplicates(candidates, {})).toEqual([]);
  });

  it("round-trips through the query string encoding", () => {
    const m = matchDuplicates(candidates, { phone: "614-555-0199" });
    expect(decodeMatches(encodeMatches(m))).toEqual([{ kind: "contact", id: "c1", label: "Jo Resident", matchedOn: ["phone"] }]);
    expect(decodeMatches("not json")).toEqual([]);
  });
});
