// The server side of idempotency (spec 06 rule 5): a change whose client id is already in sync_log is answered
// "duplicate" and never applied again. `applyChange` takes the transaction runner, so a fake ledger stands in for the
// database here; the full path runs in the RLS suite and the e2e.
import { describe, expect, it } from "vitest";
import type { QueuedChange } from "@/lib/tech/route-types";
import { applyChange } from "@/lib/tech/sync-db";

type Row = Record<string, unknown>;

/** A transaction whose only knowledge is the sync_log rows it was given; any write is recorded. */
function fakeRun(ledger: Row[]) {
  const writes: string[] = [];
  const tx = Object.assign(
    async (strings: TemplateStringsArray, ..._values: unknown[]) => {
      const text = strings.join("?");
      if (text.includes("from public.sync_log")) return ledger;
      writes.push(text.trim().slice(0, 40));
      return [];
    },
    { json: (v: unknown) => v },
  );
  const run = async <T,>(fn: (t: never) => Promise<T>): Promise<T> => fn(tx as never);
  return { run, writes };
}

const change: QueuedChange = {
  id: "11111111-1111-4111-8111-111111111111",
  visit_id: "22222222-2222-4222-8222-222222222222",
  created_at: "2026-05-01T10:00:00Z",
  payload: { kind: "en_route", at: "2026-05-01T10:00:00Z" },
  status: "pending",
  error: null,
  gaps: null,
};

describe("applyChange", () => {
  it("answers duplicate for a client id already in the ledger and writes nothing", async () => {
    const { run, writes } = fakeRun([{ result: "applied" }]);
    const result = await applyChange(run, { tenantId: "t", userId: "u" }, change);
    expect(result).toEqual({ id: change.id, result: "duplicate" });
    expect(writes).toEqual([]);
  });

  it("answers duplicate even when the earlier attempt was rejected, so a device never re-applies a change it already saw refused", async () => {
    const { run, writes } = fakeRun([{ result: "rejected" }]);
    const result = await applyChange(run, { tenantId: "t", userId: "u" }, change);
    expect(result.result).toBe("duplicate");
    expect(writes).toEqual([]);
  });
});
