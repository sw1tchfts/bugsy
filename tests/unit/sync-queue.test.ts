import { describe, expect, it } from "vitest";
import type { QueuedChange, SyncResult } from "@/lib/tech/route-types";
import { applyResults, dropChange, pendingCount, pendingInOrder, pushPending } from "@/lib/tech/sync";

function change(id: string, visit: string, at: string, status: QueuedChange["status"] = "pending"): QueuedChange {
  return { id, visit_id: visit, created_at: at, payload: { kind: "note", note_kind: "note", content: id, recorded_at: at }, status, error: null, gaps: null };
}

describe("the offline queue (rule 5)", () => {
  it("sends pending changes in creation order and skips visits with a rejected change", () => {
    const queue = [change("c", "v1", "2026-11-02T10:02:00Z"), change("a", "v1", "2026-11-02T10:00:00Z"), change("b", "v2", "2026-11-02T10:01:00Z"), change("x", "v3", "2026-11-02T09:00:00Z", "rejected"), change("y", "v3", "2026-11-02T09:30:00Z")];
    expect(pendingInOrder(queue).map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(pendingCount(queue)).toBe(4);
  });

  it("marks duplicates as synced and keeps rejections with their reason", () => {
    const queue = [change("a", "v1", "1"), change("b", "v1", "2"), change("c", "v1", "3")];
    const results: SyncResult[] = [
      { id: "a", result: "applied" },
      { id: "b", result: "duplicate" },
      { id: "c", result: "rejected", error: "gaps", gaps: ["products"] },
    ];
    const after = applyResults(queue, results);
    expect(after.map((c) => c.status)).toEqual(["synced", "synced", "rejected"]);
    expect(after[2].gaps).toEqual(["products"]);
    expect(pendingInOrder(after)).toEqual([]);
    expect(pendingInOrder(dropChange(after, "c"))).toEqual([]);
  });

  it("pushes in batches, stops at a transport failure, and blocks a visit after a rejection mid-run", async () => {
    const queue = Array.from({ length: 25 }, (_, i) => change(`c${String(i).padStart(2, "0")}`, i < 20 ? "v1" : "v2", `2026-11-02T10:${String(i).padStart(2, "0")}:00Z`));
    const batches: string[][] = [];
    const flaky = async (batch: QueuedChange[]): Promise<SyncResult[]> => {
      batches.push(batch.map((c) => c.id));
      if (batches.length === 2) throw new Error("offline again");
      return batch.map((c) => ({ id: c.id, result: "applied" as const }));
    };
    const first = await pushPending(queue, flaky, 10);
    expect(first.failed).toBe(true);
    expect(first.sent).toBe(10);
    expect(pendingCount(first.changes)).toBe(15);

    // The server rejects c12 and, like the real endpoint, skips the rest of that visit's changes in the batch.
    const rejecting = async (batch: QueuedChange[]): Promise<SyncResult[]> => {
      const blocked = new Set<string>();
      return batch.map((c) => {
        if (blocked.has(c.visit_id)) return { id: c.id, result: "skipped" as const };
        if (c.id === "c12") {
          blocked.add(c.visit_id);
          return { id: c.id, result: "rejected" as const, error: "nope" };
        }
        return { id: c.id, result: "applied" as const };
      });
    };
    const second = await pushPending(first.changes, rejecting, 10);
    expect(second.failed).toBe(false);
    // c12 was rejected: c13 to c19 (same visit) stay pending; v2's five changes went through.
    const pendingIds = second.changes.filter((c) => c.status === "pending").map((c) => c.id);
    expect(pendingIds).toEqual(["c13", "c14", "c15", "c16", "c17", "c18", "c19"]);
    expect(second.changes.filter((c) => c.visit_id === "v2").every((c) => c.status === "synced")).toBe(true);
  });
});
