// Applies one queued change from a device, under the technician's session. Every change is recorded once in sync_log
// by its client id; the completion gate runs here for real.
import type postgres from "postgres";
import { checkLabelRate } from "@/lib/catalog/label-rates";
import { decodeBase64File, putFile } from "@/lib/files";
import { gapsFor } from "@/lib/tech/gaps";
import { loadRouteVisit } from "@/lib/tech/route-db";
import type { ChangePayload, QueuedChange, SyncResult } from "@/lib/tech/route-types";

type Sql = postgres.TransactionSql;

type Actor = { tenantId: string; userId: string };

function rejected(id: string, error: string, gaps?: string[]): SyncResult {
  return { id, result: "rejected", error, gaps };
}

async function onCrew(tx: Sql, tenantId: string, visitId: string, userId: string): Promise<boolean> {
  const [row] = await tx<{ ok: boolean }[]>`
    select exists (select 1 from public.visit_crew c where c.tenant_id = ${tenantId} and c.visit_id = ${visitId} and c.user_id = ${userId})
        or exists (select 1 from public.visits v where v.tenant_id = ${tenantId} and v.id = ${visitId} and v.technician_id = ${userId}) as ok`;
  return row?.ok ?? false;
}

function instant(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw Object.assign(new Error("the change carries no valid time"), { code: "23514" });
  // A device clock ahead of the server never produces a time after receipt.
  return (parsed.getTime() > Date.now() ? new Date() : parsed).toISOString();
}

async function apply(tx: Sql, actor: Actor, change: QueuedChange): Promise<SyncResult> {
  const { tenantId, userId } = actor;
  const payload = change.payload as ChangePayload;
  const visitId = change.visit_id;
  if (!(await onCrew(tx, tenantId, visitId, userId))) return rejected(change.id, "sync.notOnCrew");

  switch (payload.kind) {
    case "en_route": {
      const r = await tx`update public.visits set status = 'en_route' where id = ${visitId} and tenant_id = ${tenantId} and status = 'scheduled'`;
      if (r.count === 0) {
        const [v] = await tx<{ status: string }[]>`select status from public.visits where id = ${visitId}`;
        if (!v || !["en_route", "in_progress", "completed"].includes(v.status)) return rejected(change.id, `the visit is ${v?.status ?? "gone"}, not scheduled`);
      }
      return { id: change.id, result: "applied" };
    }
    case "arrive": {
      const at = instant(payload.at);
      const r = await tx`
        update public.visits set status = 'in_progress', arrived_at = ${at}, started_by = ${userId}
        where id = ${visitId} and tenant_id = ${tenantId} and status in ('scheduled', 'en_route')`;
      if (r.count === 0) {
        const [v] = await tx<{ status: string }[]>`select status from public.visits where id = ${visitId}`;
        if (!v || !["in_progress", "completed"].includes(v.status)) return rejected(change.id, `the visit is ${v?.status ?? "gone"}, not scheduled`);
      }
      return { id: change.id, result: "applied" };
    }
    case "conditions": {
      await tx`update public.visits set conditions = ${tx.json(payload.conditions)} where id = ${visitId} and tenant_id = ${tenantId}`;
      return { id: change.id, result: "applied" };
    }
    case "areas_pests": {
      await tx`update public.visits set areas_treated = ${payload.areas_treated}, target_pests = ${payload.target_pests} where id = ${visitId} and tenant_id = ${tenantId}`;
      return { id: change.id, result: "applied" };
    }
    case "product": {
      const [product] = await tx<{ label_rates: unknown; name: string }[]>`select label_rates, name from public.products where id = ${payload.product_id}`;
      if (!product) return rejected(change.id, "unknown product");
      const amount = Number(payload.amount);
      const labelCheck =
        payload.carrier_amount && payload.carrier_unit
          ? checkLabelRate({ label_rates: product.label_rates }, { site: payload.site_treated, amount, amountUnit: payload.amount_unit, per: Number(payload.carrier_amount), perUnit: payload.carrier_unit })
          : { status: "no_rate_on_file", reason: "no carrier amount to compare against the label" };
      await tx`
        insert into public.visit_products ${tx({
          tenant_id: tenantId,
          visit_id: visitId,
          product_id: payload.product_id,
          applied_by: payload.applied_by,
          site_treated: payload.site_treated,
          location_description: payload.location_description,
          amount: payload.amount,
          amount_unit: payload.amount_unit,
          carrier_amount: payload.carrier_amount,
          carrier_unit: payload.carrier_unit,
          target_pests: payload.target_pests,
          label_check: tx.json({ status: labelCheck.status, reason: labelCheck.reason }),
          client_id: change.id,
          recorded_at: instant(payload.recorded_at),
        })}`;
      return { id: change.id, result: "applied" };
    }
    case "note": {
      await tx`insert into public.visit_notes (tenant_id, visit_id, kind, content, client_id, recorded_at)
               values (${tenantId}, ${visitId}, ${payload.note_kind}, ${payload.content}, ${change.id}, ${instant(payload.recorded_at)})`;
      return { id: change.id, result: "applied" };
    }
    case "photo": {
      const file = decodeBase64File(payload.data_url, "image/jpeg");
      const fileId = await putFile(tx, tenantId, { kind: "photo", contentType: file.contentType, data: file.data, clientId: change.id });
      await tx`insert into public.visit_photos (tenant_id, visit_id, file_id, kind, caption, taken_at, client_id)
               values (${tenantId}, ${visitId}, ${fileId}, ${payload.photo_kind}, ${payload.caption}, ${instant(payload.taken_at)}, ${change.id})`;
      return { id: change.id, result: "applied" };
    }
    case "signature": {
      const file = decodeBase64File(payload.data_url, "image/png");
      const fileId = await putFile(tx, tenantId, { kind: "signature", contentType: file.contentType, data: file.data, clientId: change.id });
      await tx`insert into public.visit_signatures (tenant_id, visit_id, file_id, signer_name, signed_at, client_id)
               values (${tenantId}, ${visitId}, ${fileId}, ${payload.signer_name}, ${instant(payload.signed_at)}, ${change.id})
               on conflict (visit_id) do update set file_id = excluded.file_id, signer_name = excluded.signer_name, signed_at = excluded.signed_at`;
      return { id: change.id, result: "applied" };
    }
    case "complete": {
      const visit = await loadRouteVisit(tx, tenantId, visitId);
      if (!visit) return rejected(change.id, "visit not found");
      if (visit.status === "completed") return { id: change.id, result: "applied" };
      const gaps = gapsFor(visit);
      if (gaps.length) return rejected(change.id, "record incomplete", gaps);
      const at = instant(payload.at);
      const r = await tx`update public.visits set status = 'completed', departed_at = ${at}, completed_at = ${at} where id = ${visitId} and tenant_id = ${tenantId} and status = 'in_progress'`;
      if (r.count === 0) return rejected(change.id, `the visit is ${visit.status}, not in progress`);
      return { id: change.id, result: "applied" };
    }
    default:
      return rejected(change.id, "unknown change kind");
  }
}

/** Applies one change in its own transaction and records it in sync_log. The caller handles ordering and skipping. */
export async function applyChange(run: <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>, actor: Actor, change: QueuedChange): Promise<SyncResult> {
  const kind = (change.payload as ChangePayload)?.kind ?? "unknown";
  const duplicate = await run(async (tx) => {
    const [row] = await tx<{ result: string }[]>`select result from public.sync_log where client_change_id = ${change.id}`;
    return row ?? null;
  });
  if (duplicate) return { id: change.id, result: "duplicate" };

  try {
    return await run(async (tx) => {
      const result = await apply(tx, actor, change);
      if (result.result === "rejected") throw Object.assign(new Error(result.error ?? "rejected"), { code: "SYNC", result });
      await tx`insert into public.sync_log (tenant_id, user_id, client_change_id, kind, visit_id, result, detail)
               values (${actor.tenantId}, ${actor.userId}, ${change.id}, ${kind}, ${change.visit_id}, 'applied', ${tx.json({})})`;
      return result;
    });
  } catch (err) {
    const e = err as { code?: string; message?: string; result?: SyncResult };
    const result: SyncResult = e.result ?? rejected(change.id, (e.message ?? "rejected").replace(/\s+/g, " ").slice(0, 200));
    // The rejection is a fact too; it goes in the ledger in its own transaction.
    await run((tx) =>
      tx`insert into public.sync_log (tenant_id, user_id, client_change_id, kind, visit_id, result, detail)
         values (${actor.tenantId}, ${actor.userId}, ${change.id}, ${kind}, ${change.visit_id}, 'rejected', ${tx.json({ error: result.error ?? null, gaps: result.gaps ?? null })})
         on conflict (client_change_id) do nothing`,
    ).catch(() => undefined);
    return result;
  }
}
