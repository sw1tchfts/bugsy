import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { dbAs, getSession } from "@/lib/auth/session";
import type { QueuedChange, SyncResult } from "@/lib/tech/route-types";
import { applyChange } from "@/lib/tech/sync-db";
import { resolveActiveTenant } from "@/lib/tenancy/active-tenant";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Applies queued changes in the order sent. Each change runs in its own transaction and is logged once by its client
 * id; after a rejection, later changes for the same visit in this batch are skipped so the device keeps them pending.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const { active } = await resolveActiveTenant(session);
  if (!active) return NextResponse.json({ error: "no company" }, { status: 403 });
  if (!can(active.permissions, "visits.write")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: { changes?: unknown };
  try {
    body = (await request.json()) as { changes?: unknown };
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const changes = Array.isArray(body.changes) ? (body.changes as QueuedChange[]) : [];
  if (changes.length > 50) return NextResponse.json({ error: "at most 50 changes per request" }, { status: 400 });

  const results: SyncResult[] = [];
  const blocked = new Set<string>();
  for (const change of changes) {
    if (!change || typeof change.id !== "string" || !UUID.test(change.id) || typeof change.visit_id !== "string" || !change.payload) {
      results.push({ id: String(change?.id ?? ""), result: "rejected", error: "malformed change" });
      continue;
    }
    if (blocked.has(change.visit_id)) {
      results.push({ id: change.id, result: "skipped" });
      continue;
    }
    const result = await applyChange((fn) => dbAs(session, fn), { tenantId: active.tenantId, userId: session.userId }, change);
    if (result.result === "rejected") blocked.add(change.visit_id);
    results.push(result);
  }
  return NextResponse.json({ results });
}
