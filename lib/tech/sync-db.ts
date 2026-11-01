// Applies one queued change from a device, under the technician's session. Every change is recorded once in sync_log
// by its client id; the completion gate runs here for real.
import type postgres from "postgres";
import { invoiceForVisit, recordPayment } from "@/lib/billing/db";
import { postProductUse, postVisit } from "@/lib/ledger/db";
import { queueOnTheWay, queueVisitSummary } from "@/lib/messaging/db";
import { safely } from "@/lib/messaging/safely";
import { checkLabelRate } from "@/lib/catalog/label-rates";
import { onVisitCompleted } from "@/lib/compliance/db";
import { decodeBase64File, putFile } from "@/lib/files";
import { checkProblems, isDeviceKind, validPosition, ZONES } from "@/lib/commercial/devices";
import { dateInZone } from "@/lib/dates";
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
        return { id: change.id, result: "applied" };
      }
      // The customer hears the technician is on the way (spec 11); a tap synced hours late is recorded, not sent.
      const [zone] = await tx<{ timezone: string }[]>`select timezone from public.tenants where id = ${tenantId}`;
      await safely(tx, "on-the-way text", (t) => queueOnTheWay(t, tenantId, visitId, new Date(instant(payload.at)), zone?.timezone ?? "UTC"));
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
      // The application record and the notice obligations are born in the same transaction (spec 07 rule 1).
      const [tenant] = await tx<{ timezone: string }[]>`select timezone from public.tenants where id = ${tenantId}`;
      await onVisitCompleted(tx, tenantId, visitId, tenant?.timezone ?? "UTC");
      // Per-visit billing invoices the stop in the same transaction (spec 08 rule 2), and the books earn the visit
      // and expense what it used (spec 09 rules 3 and 4).
      await invoiceForVisit(tx, tenantId, visitId, tenant?.timezone ?? "UTC");
      await postVisit(tx, tenantId, visitId, tenant?.timezone ?? "UTC");
      await postProductUse(tx, tenantId, visitId, tenant?.timezone ?? "UTC");
      // The summary goes to the customer, carrying the post-application notice when it can (spec 11 rule 8).
      await safely(tx, "visit summary", (t) => queueVisitSummary(t, tenantId, visitId, tenant?.timezone ?? "UTC"));
      return { id: change.id, result: "applied" };
    }
    case "payment": {
      // Cash or a check taken at the stop lands on the stop's own invoice (spec 08 rule 15); without one it stays as credit.
      const amount = Number(payload.amount_cents);
      if (!Number.isInteger(amount) || amount <= 0) return rejected(change.id, "a payment is a positive number of cents");
      const [v] = await tx<{ account_id: string }[]>`select account_id from public.visits where id = ${visitId} and tenant_id = ${tenantId}`;
      if (!v) return rejected(change.id, "visit not found");
      const [inv] = await tx<{ id: string }[]>`select id from public.invoices where tenant_id = ${tenantId} and source_key = ${`visit:${visitId}`}`;
      await recordPayment(tx, tenantId, {
        account_id: v.account_id,
        method: payload.method,
        amount_cents: amount,
        received_at: new Date(instant(payload.received_at)),
        reference: payload.reference,
        visit_id: visitId,
        recorded_by: actor.userId,
        invoice_id: inv?.id ?? null,
        allocate: Boolean(inv),
      });
      return { id: change.id, result: "applied" };
    }
    case "device_check":
    case "device_add":
    case "device_move":
    case "device_remove":
    case "recommendation":
      return applySiteChange(tx, actor, change, payload);
    default:
      return rejected(change.id, "unknown change kind");
  }
}

/** Spec 14: a program stop's device and recommendation changes, at the visit's own property, while it is open. */
async function applySiteChange(tx: Sql, actor: Actor, change: QueuedChange, payload: ChangePayload): Promise<SyncResult> {
  const { tenantId, userId } = actor;
  const visitId = change.visit_id;
  const [visit] = await tx<{ property_id: string; status: string; timezone: string }[]>`
    select v.property_id, v.status, t.timezone from public.visits v join public.tenants t on t.id = v.tenant_id where v.id = ${visitId} and v.tenant_id = ${tenantId}`;
  if (!visit) return rejected(change.id, "visit not found");
  if (!["scheduled", "en_route", "in_progress"].includes(visit.status)) return rejected(change.id, `the visit is ${visit.status}; its devices can no longer change`);
  // Device history names the visit it happened at (rule 2).
  await tx`select set_config('app.visit_id', ${visitId}, true)`;
  const device = async (id: string) =>
    (await tx<{ id: string; status: string }[]>`select id, status from public.devices where id = ${id} and tenant_id = ${tenantId} and property_id = ${visit.property_id}`)[0] ?? null;
  // A place on a map counts only on one of this site's maps still in use; a map archived while the phone was offline
  // leaves the device unmapped, with its location text, rather than losing the change (rules 3 and 7).
  const place = async (p: { map_id: string | null; x: number | null; y: number | null }) => {
    if (!p.map_id) return { map_id: null, x: null, y: null };
    const [map] = await tx`select id from public.site_maps where id = ${p.map_id} and tenant_id = ${tenantId} and property_id = ${visit.property_id} and archived_at is null`;
    return map ? { map_id: p.map_id, x: p.x, y: p.y } : { map_id: null, x: null, y: null };
  };

  switch (payload.kind) {
    case "device_check": {
      const d = await device(payload.device_id);
      if (!d) return rejected(change.id, "sync.deviceUnknown");
      const problems = checkProblems(payload);
      if (problems.length) return rejected(change.id, problems.join(" "));
      const checked = payload.status === "checked";
      await tx`
        insert into public.device_checks (tenant_id, device_id, visit_id, checked_at, checked_by, source, status, activity, count, bait_consumed_pct, pest, actions, notes, client_id)
        values (${tenantId}, ${d.id}, ${visitId}, ${instant(payload.checked_at)}, ${userId}, 'technician', ${payload.status}, ${checked ? (payload.activity ?? "none") : null},
                ${checked ? payload.count : null}, ${checked ? payload.bait_consumed_pct : null}, ${payload.pest || null}, ${payload.actions ?? []}, ${payload.notes || null}, ${change.id})
        on conflict (visit_id, device_id) where visit_id is not null do update set
          checked_at = excluded.checked_at, checked_by = excluded.checked_by, status = excluded.status, activity = excluded.activity, count = excluded.count,
          bait_consumed_pct = excluded.bait_consumed_pct, pest = excluded.pest, actions = excluded.actions, notes = excluded.notes, client_id = excluded.client_id`;
      return { id: change.id, result: "applied" };
    }
    case "device_add": {
      if (!isDeviceKind(payload.device_kind)) return rejected(change.id, "pick what kind of device it is");
      if (!(ZONES as readonly string[]).includes(payload.zone)) return rejected(change.id, "pick interior, exterior or perimeter");
      if (!payload.number.trim() || !payload.location.trim()) return rejected(change.id, "a device needs a number and a location");
      if (!validPosition(payload.x, payload.y) || (payload.x !== null && !payload.map_id)) return rejected(change.id, "the map position is not on the map");
      const at = await place(payload);
      try {
        await tx.savepoint((sp) => sp`
          insert into public.devices (id, tenant_id, property_id, number, barcode, kind, zone, location, map_id, x, y, installed_on, client_id)
          values (${payload.device_id}, ${tenantId}, ${visit.property_id}, ${payload.number.trim()}, ${payload.barcode?.trim() || null}, ${payload.device_kind}, ${payload.zone},
                  ${payload.location.trim()}, ${at.map_id}, ${at.x}, ${at.y}, ${dateInZone(instant(payload.at), visit.timezone)}, ${change.id})`);
      } catch (err) {
        if ((err as { code?: string }).code === "23505") return rejected(change.id, "sync.deviceNumberTaken");
        throw err;
      }
      return { id: change.id, result: "applied" };
    }
    case "device_move": {
      const d = await device(payload.device_id);
      if (!d || d.status !== "active") return rejected(change.id, "sync.deviceUnknown");
      if (!payload.location.trim() || !(ZONES as readonly string[]).includes(payload.zone)) return rejected(change.id, "a device needs a location");
      if (!validPosition(payload.x, payload.y) || (payload.x !== null && !payload.map_id)) return rejected(change.id, "the map position is not on the map");
      const at = await place(payload);
      await tx`update public.devices set zone = ${payload.zone}, location = ${payload.location.trim()}, map_id = ${at.map_id}, x = ${at.x}, y = ${at.y} where id = ${d.id}`;
      return { id: change.id, result: "applied" };
    }
    case "device_remove": {
      const d = await device(payload.device_id);
      if (!d) return rejected(change.id, "sync.deviceUnknown");
      if (d.status === "removed") return { id: change.id, result: "applied" };
      if (!payload.reason.trim()) return rejected(change.id, "say why the device came out");
      await tx`update public.devices set status = 'removed', removed_on = ${dateInZone(instant(payload.at), visit.timezone)}, removed_reason = ${payload.reason.trim()} where id = ${d.id}`;
      return { id: change.id, result: "applied" };
    }
    case "recommendation": {
      if (!payload.description.trim()) return rejected(change.id, "a recommendation says what to do");
      await tx`
        insert into public.recommendations (tenant_id, property_id, visit_id, category, description, responsibility, priority, client_id)
        values (${tenantId}, ${visit.property_id}, ${visitId}, ${payload.category}, ${payload.description.trim()}, ${payload.responsibility}, ${payload.priority}, ${change.id})`;
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
