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

/** Sends the pending changes in batches, in order, stopping at the first transport failure so order holds. */
export async function pushPending(
  changes: readonly QueuedChange[],
  send: (batch: QueuedChange[]) => Promise<SyncResult[]>,
  batchSize = 10,
): Promise<{ changes: QueuedChange[]; sent: number; failed: boolean }> {
  let current = [...changes];
  let sent = 0;
  const ordered = pendingInOrder(current);
  for (let i = 0; i < ordered.length; i += batchSize) {
    const batch = ordered.slice(i, i + batchSize);
    try {
      const results = await send(batch);
      current = applyResults(current, results);
      sent += batch.length;
      // A rejection inside the batch blocks that visit's remaining changes; recompute before the next batch.
      const stillPending = new Set(pendingInOrder(current).map((c) => c.id));
      const remaining = ordered.slice(i + batchSize).filter((c) => stillPending.has(c.id));
      if (remaining.length !== ordered.slice(i + batchSize).length) {
        ordered.splice(i + batchSize, ordered.length, ...remaining);
      }
    } catch {
      return { changes: current, sent, failed: true };
    }
  }
  return { changes: current, sent, failed: false };
}
