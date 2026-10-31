import { describe, expect, it } from "vitest";
import type { QueuedChange, SyncResult } from "@/lib/tech/route-types";
import { TOO_LARGE, carriesFile, nextBatch, pushPending } from "@/lib/tech/sync";

function change(id: string, visit: string, payload: Record<string, unknown>, at = "2026-05-01T10:00:00Z"): QueuedChange {
  return { id, visit_id: visit, created_at: at, payload: payload as QueuedChange["payload"], status: "pending", error: null, gaps: null };
}

const note = (id: string, visit = "v1", at?: string) => change(id, visit, { kind: "note", note_kind: "note", content: "x", recorded_at: "2026-05-01T10:00:00Z" }, at);
const photo = (id: string, visit = "v1", at?: string) => change(id, visit, { kind: "photo", photo_kind: "other", caption: null, taken_at: "2026-05-01T10:00:00Z", data_url: "data:image/png;base64,AA==" }, at);

describe("file changes travel alone", () => {
  it("knows which changes carry bytes", () => {
    expect(carriesFile(photo("p"))).toBe(true);
    expect(carriesFile(note("n"))).toBe(false);
  });

  it("ends a batch before a file and sends the file on its own", () => {
    const ordered = [note("a"), note("b"), photo("p"), note("c")];
    expect(nextBatch(ordered, 10).map((c) => c.id)).toEqual(["a", "b"]);
    expect(nextBatch(ordered.slice(2), 10).map((c) => c.id)).toEqual(["p"]);
    expect(nextBatch(ordered.slice(3), 10).map((c) => c.id)).toEqual(["c"]);
    expect(nextBatch([], 10)).toEqual([]);
  });

  it("rejects a single file the server refuses as too large and keeps draining the rest", async () => {
    const queue = [note("a", "v1", "2026-05-01T10:00:00Z"), photo("p", "v2", "2026-05-01T10:01:00Z"), note("c", "v1", "2026-05-01T10:02:00Z")];
    const sent: string[][] = [];
    const result = await pushPending(queue, async (batch) => {
      sent.push(batch.map((c) => c.id));
      if (batch.some(carriesFile)) throw Object.assign(new Error("413"), { status: 413 });
      return batch.map((c): SyncResult => ({ id: c.id, result: "applied" }));
    });
    expect(sent).toEqual([["a"], ["p"], ["c"]]);
    expect(result.failed).toBe(false);
    const byId = new Map(result.changes.map((c) => [c.id, c]));
    expect(byId.get("p")?.status).toBe("rejected");
    expect(byId.get("p")?.error).toBe(TOO_LARGE);
    expect(byId.get("a")?.status).toBe("synced");
    expect(byId.get("c")?.status).toBe("synced");
  });

  it("still stops on any other transport failure so order holds", async () => {
    const queue = [note("a"), note("b", "v1", "2026-05-01T10:01:00Z")];
    const result = await pushPending(queue, async () => {
      throw Object.assign(new Error("500"), { status: 500 });
    });
    expect(result.failed).toBe(true);
    expect(result.changes.every((c) => c.status === "pending")).toBe(true);
  });
});
