// The completion gate applied to a route visit, shared by the device (before queuing) and the sync endpoint.
import { type RecordCrewMember, type RecordProduct, recordGaps } from "@/lib/compliance/records";
import type { RouteVisit } from "@/lib/tech/route-types";

export function gapsFor(visit: RouteVisit): string[] {
  const products: RecordProduct[] = visit.captured.products.map((p) => ({
    product_name: p.product_name,
    epa_reg_no: p.epa_reg_no,
    amount: p.amount,
    amount_unit: p.amount_unit,
    site_treated: p.site_treated,
    target_pests: p.target_pests,
  }));
  const crew: RecordCrewMember[] = visit.crew.map((c) => ({
    role: c.role,
    name: c.name,
    credential: c.credential ? { cert_number: c.credential.cert_number, trainee: c.credential.trainee } : null,
  }));
  return recordGaps(
    {
      job_kind: visit.job_kind,
      arrived_at: visit.captured.arrived_at,
      departed_at: visit.captured.departed_at,
      scheduled_for: visit.scheduled_for,
      areas_treated: visit.captured.areas_treated,
      target_pests: visit.captured.target_pests,
      conditions: visit.captured.conditions as Record<string, unknown> | null,
      property_address: visit.property.address,
      property_state: visit.property.state,
      service_type_name: visit.service_type.name,
    },
    products,
    crew,
    visit.required_fields,
    visit.captured.notes.length > 0 || visit.captured.photos.length > 0,
  ).map((g) => g.key);
}
