// The offline queue's rules, kept pure so they are testable without a browser: changes go out in order per visit,
// an id is never sent twice as a new change, and a rejection stops that visit's later changes until the technician
// looks at it (a completion after a rejected product line would otherwise complete a visit missing that product).
import type { QueuedChange, SyncResult } from "@/lib/tech/route-types";

/** Pending changes in the order they should be sent: by creation time, grouped per visit. */
export function pendingInOrder(changes: readonly QueuedChange[]): QueuedChange[] {
  const blocked = new Set(changes.filter((c) => c.status === "rejected").map((c) => c.visit_id));
  return changes
    .filter((c) => c.status === "pending" && !blocked.has(c.visit_id))
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
}

/** Applies the server's answers to the queue. A duplicate counts as synced: the server already has it. */
export function applyResults(changes: readonly QueuedChange[], results: readonly SyncResult[]): QueuedChange[] {
  const byId = new Map(results.map((r) => [r.id, r]));
  return changes.map((c) => {
    const r = byId.get(c.id);
    if (!r || r.result === "skipped") return c;
    if (r.result === "rejected") return { ...c, status: "rejected", error: r.error ?? "rejected", gaps: r.gaps ?? null };
    return { ...c, status: "synced", error: null, gaps: null };
  });
}

/** A rejected change the technician chose to drop (or fix by re-entering) unblocks its visit's queue. */
export function dropChange(changes: readonly QueuedChange[], id: string): QueuedChange[] {
  return changes.filter((c) => c.id !== id);
}

export function pendingCount(changes: readonly QueuedChange[]): number {
  return changes.filter((c) => c.status === "pending").length;
}

/** A photo or signature change carries its bytes; it travels alone so one request stays small. */
export function carriesFile(change: QueuedChange): boolean {
  const payload = change.payload as { data_url?: unknown } | null;
  return typeof payload?.data_url === "string";
}

/** The next batch off the ordered queue: up to `batchSize` plain changes, or a single change that carries a file. */
export function nextBatch(ordered: readonly QueuedChange[], batchSize: number): QueuedChange[] {
  if (ordered.length === 0) return [];
  if (carriesFile(ordered[0])) return [ordered[0]];
  const batch: QueuedChange[] = [];
  for (const change of ordered) {
    if (batch.length >= batchSize || carriesFile(change)) break;
    batch.push(change);
  }
  return batch;
}

/** The key the app translates when a deployment refuses a file as too large. */
export const TOO_LARGE = "sync.tooLarge";

/**
 * Sends the pending changes in batches, in order, stopping at the first transport failure so order holds. A single
 * file change the server refuses as too large (HTTP 413) is rejected on its own and the rest of the queue goes on.
 */
export async function pushPending(
  changes: readonly QueuedChange[],
  send: (batch: QueuedChange[]) => Promise<SyncResult[]>,
  batchSize = 10,
): Promise<{ changes: QueuedChange[]; sent: number; failed: boolean }> {
  let current = [...changes];
  let sent = 0;
  let remaining = pendingInOrder(current);
  while (remaining.length > 0) {
    const batch = nextBatch(remaining, batchSize);
    try {
      const results = await send(batch);
      current = applyResults(current, results);
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      if (status === 413 && batch.length === 1) {
        current = applyResults(current, [{ id: batch[0].id, result: "rejected", error: TOO_LARGE }]);
      } else {
        return { changes: current, sent, failed: true };
      }
    }
    sent += batch.length;
    // A rejection inside the batch blocks that visit's remaining changes; recompute before the next batch.
    const stillPending = new Set(pendingInOrder(current).map((c) => c.id));
    remaining = remaining.slice(batch.length).filter((c) => stillPending.has(c.id));
  }
  return { changes: current, sent, failed: false };
}
