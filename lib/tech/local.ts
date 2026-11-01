// Applies the device's pending changes on top of the cached route, so the stop screen shows what the technician
// did even before the office has it.
import type { ChangePayload, QueuedChange, RoutePayload, RouteVisit } from "@/lib/tech/route-types";

export function withLocalChanges(route: RoutePayload, visit: RouteVisit, changes: readonly QueuedChange[]): RouteVisit {
  const products = new Map(route.products.map((p) => [p.id, p]));
  let v: RouteVisit = {
    ...visit,
    site: visit.site ? { ...visit.site, devices: [...visit.site.devices], recommendations: [...visit.site.recommendations] } : null,
    specialty: visit.specialty ? { ...visit.specialty, captures: [...visit.specialty.captures], materials: [...visit.specialty.materials] } : visit.specialty,
    captured: { ...visit.captured, products: [...visit.captured.products], notes: [...visit.captured.notes], photos: [...visit.captured.photos], device_checks: [...(visit.captured.device_checks ?? [])] },
  };
  const pending = changes.filter((c) => c.visit_id === visit.id && c.status === "pending").sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  for (const change of pending) {
    const p = change.payload as ChangePayload;
    switch (p.kind) {
      case "en_route":
        if (v.status === "scheduled") v = { ...v, status: "en_route" };
        break;
      case "arrive":
        if (v.status !== "completed") v = { ...v, status: "in_progress", captured: { ...v.captured, arrived_at: v.captured.arrived_at ?? p.at } };
        break;
      case "conditions":
        v = { ...v, captured: { ...v.captured, conditions: p.conditions } };
        break;
      case "areas_pests":
        v = { ...v, captured: { ...v.captured, areas_treated: p.areas_treated, target_pests: p.target_pests } };
        break;
      case "product": {
        const product = products.get(p.product_id);
        v.captured.products.push({
          id: change.id,
          product_id: p.product_id,
          product_name: product?.name ?? "Product",
          epa_reg_no: product?.epa_reg_no ?? "",
          applied_by: p.applied_by,
          site_treated: p.site_treated,
          location_description: p.location_description,
          amount: p.amount,
          amount_unit: p.amount_unit,
          carrier_amount: p.carrier_amount,
          carrier_unit: p.carrier_unit,
          target_pests: p.target_pests,
          label_check: p.label_check,
          recorded_at: p.recorded_at,
        });
        break;
      }
      case "note":
        v.captured.notes.push({ id: change.id, kind: p.note_kind, content: p.content, recorded_at: p.recorded_at });
        break;
      case "photo":
        v.captured.photos.push({ id: change.id, file_id: `local:${change.id}`, kind: p.photo_kind, caption: p.caption, taken_at: p.taken_at });
        break;
      case "signature":
        v = { ...v, captured: { ...v.captured, signature: { signer_name: p.signer_name, signed_at: p.signed_at, file_id: `local:${change.id}` } } };
        break;
      case "complete":
        v = { ...v, status: "completed", captured: { ...v.captured, departed_at: p.at, completed_at: p.at } };
        break;
      case "payment":
        // Money taken at the stop shows in the queue; the office's invoice reflects it after sync.
        break;
      case "device_check": {
        // One answer per device per visit: a later check of the same device replaces the earlier one.
        const checks = v.captured.device_checks.filter((c) => c.device_id !== p.device_id);
        checks.push({ id: change.id, device_id: p.device_id, status: p.status, activity: p.activity, count: p.count, bait_consumed_pct: p.bait_consumed_pct, pest: p.pest, actions: p.actions, notes: p.notes, checked_at: p.checked_at });
        v = { ...v, captured: { ...v.captured, device_checks: checks } };
        break;
      }
      case "device_add":
        if (v.site && !v.site.devices.some((d) => d.id === p.device_id)) {
          v.site.devices.push({ id: p.device_id, number: p.number, barcode: p.barcode, kind: p.device_kind, zone: p.zone, location: p.location, map_id: p.map_id, x: p.x, y: p.y, status: "active", last: null });
        }
        break;
      case "device_move":
        if (v.site) v.site.devices = v.site.devices.map((d) => (d.id === p.device_id ? { ...d, zone: p.zone, location: p.location, map_id: p.map_id, x: p.x, y: p.y } : d));
        break;
      case "device_remove":
        if (v.site) v.site.devices = v.site.devices.map((d) => (d.id === p.device_id ? { ...d, status: "removed" } : d));
        break;
      case "recommendation":
        v.site?.recommendations.unshift({ id: change.id, category: p.category, description: p.description, status: "open", due_on: null });
        break;
      case "prep_check":
        if (v.specialty) v.specialty = { ...v.specialty, prep_check: { ready: p.ready, missing: p.missing, notes: p.notes, checked_at: p.at } };
        break;
      case "capture":
        v.specialty?.captures.push({ id: change.id, species: p.species, count: p.count, disposition: p.disposition, location: p.location, notes: p.notes, created_at: p.at });
        break;
      case "material":
        v.specialty?.materials.push({ id: change.id, description: p.description, quantity: p.quantity, unit: p.unit, unit_price_cents: p.unit_price_cents, billable: p.billable, created_at: p.at });
        break;
    }
  }
  return v;
}
