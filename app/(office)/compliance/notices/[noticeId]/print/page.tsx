import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { NOTICE_KIND_LABELS, type NoticeKind } from "@/lib/compliance/notices";
import { formatBusinessDate, formatInstant } from "@/lib/dates";
import { loadRouteVisit } from "@/lib/tech/route-db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { recordNoticeProof } from "../../../actions";

export const metadata: Metadata = { title: "Print notice" };

type NoticeRow = {
  id: string;
  kind: NoticeKind;
  required: boolean;
  visit_id: string | null;
  recipient_name: string;
  recipient_address: string | null;
  channel: string;
  status: string;
  for_scheduled_for: string | null;
  address: string;
  branch_address: string | null;
  business_license_number: string | null;
};

/** The notice as a page to print or save as PDF: what was applied, where, by whom, and what the customer should know. */
export default async function PrintNoticePage({ params }: { params: Promise<{ noticeId: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "compliance.read");
  const { noticeId } = await params;
  const tenantId = active.tenantId;
  const tz = active.tenantTimezone;
  const canProve = can(active.permissions, "compliance.write") || can(active.permissions, "dispatch.write");

  const data = await dbAs(session, async (tx) => {
    const [notice] = await tx<NoticeRow[]>`
      select n.id, n.kind, n.required, n.visit_id, n.recipient_name, n.recipient_address, n.channel, n.status, n.for_scheduled_for,
             concat_ws(', ', concat_ws(' ', p.line1, p.line2), p.city, concat_ws(' ', p.state_code, p.postal_code)) as address,
             b.address as branch_address, b.business_license_number
      from public.notices n
        join public.properties p on p.id = n.property_id
        left join public.visits v on v.id = n.visit_id
        left join public.branches b on b.id = v.branch_id
      where n.id = ${noticeId} and n.tenant_id = ${tenantId}`;
    if (!notice) return null;
    const visit = notice.visit_id ? await loadRouteVisit(tx, tenantId, notice.visit_id) : null;
    return { notice, visit };
  });
  if (!data) notFound();
  const { notice, visit } = data;
  const lead = visit?.crew.find((c) => c.role === "lead") ?? visit?.crew[0] ?? null;
  const recommendations = visit?.captured.notes.filter((n) => n.kind === "recommendation") ?? [];

  return (
    <>
      <div className="flex items-center justify-between print:hidden">
        <p className="text-sm text-stone-500">
          <Link href={`/compliance/notices/${notice.id}`} className="hover:underline">
            Notice
          </Link>
        </p>
        {notice.status === "due" && canProve ? (
          <form action={recordNoticeProof}>
            <input type="hidden" name="tenant_id" value={tenantId} />
            <input type="hidden" name="notice_id" value={notice.id} />
            <input type="hidden" name="channel" value={notice.channel === "mail" || notice.channel === "posted" ? notice.channel : "print"} />
            <input type="hidden" name="note" value="printed from the office" />
            <Button type="submit" variant="secondary">
              Mark as printed and sent
            </Button>
          </form>
        ) : null}
      </div>
      <article className="mx-auto max-w-2xl rounded-lg border border-stone-200 bg-white p-8 text-sm print:border-0 print:p-0" data-testid="notice-print">
        <header className="mb-6 border-b border-stone-200 pb-4">
          <h1 className="text-xl font-semibold">{active.tenantName}</h1>
          {notice.branch_address ? <p className="text-stone-600">{notice.branch_address}</p> : null}
          {notice.business_license_number ? <p className="text-stone-600">Business license {notice.business_license_number}</p> : null}
        </header>
        <h2 className="text-lg font-semibold">{NOTICE_KIND_LABELS[notice.kind]}</h2>
        <p className="mt-2">
          To: {notice.recipient_name}
          {notice.recipient_address ? `, ${notice.recipient_address}` : ""}
        </p>
        <p>Property: {notice.address}</p>
        {notice.kind === "registry_advance" ? (
          <p className="mt-4">
            This is advance notice that a pesticide application is planned at or near the property above{notice.for_scheduled_for ? ` on ${formatBusinessDate(notice.for_scheduled_for)}` : ""}. Your address is on the state notification registry. Contact us with any question before that date.
          </p>
        ) : null}
        {visit ? (
          <>
            <p className="mt-4">
              Service: {visit.service_type.name}
              {visit.captured.arrived_at ? `, applied ${formatInstant(visit.captured.arrived_at, tz)}` : ""}
              {visit.captured.departed_at ? ` to ${formatInstant(visit.captured.departed_at, tz)}` : ""}.
              {lead ? ` Applicator: ${lead.name}${lead.credential?.cert_number ? `, certification ${lead.credential.cert_number}` : ""}.` : ""}
            </p>
            {visit.captured.products.length ? (
              <table className="mt-3 w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-stone-300 text-left">
                    <th className="py-1 pr-3">Product</th>
                    <th className="py-1 pr-3">EPA registration</th>
                    <th className="py-1 pr-3">Amount</th>
                    <th className="py-1 pr-3">Where</th>
                    <th className="py-1 pr-3">Target pests</th>
                  </tr>
                </thead>
                <tbody>
                  {visit.captured.products.map((p) => (
                    <tr key={p.id} className="border-b border-stone-100">
                      <td className="py-1 pr-3">{p.product_name}</td>
                      <td className="py-1 pr-3 font-mono text-xs">{p.epa_reg_no}</td>
                      <td className="py-1 pr-3">
                        {p.amount} {p.amount_unit.replace("_", " ")}
                        {p.carrier_amount ? ` in ${p.carrier_amount} ${p.carrier_unit?.replace("_", " ")}` : ""}
                      </td>
                      <td className="py-1 pr-3">
                        {p.site_treated}
                        {p.location_description ? ` (${p.location_description})` : ""}
                      </td>
                      <td className="py-1 pr-3">{p.target_pests.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {visit.captured.areas_treated.length ? <p className="mt-2">Areas treated: {visit.captured.areas_treated.join(", ")}.</p> : null}
            {recommendations.length ? (
              <div className="mt-3">
                <p className="font-medium">Recommendations</p>
                <ul className="list-disc pl-5">
                  {recommendations.map((n) => (
                    <li key={n.id}>{n.content}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
        <p className="mt-6 text-xs text-stone-600">
          Keep this notice with your records. Product labels and safety data sheets are available on request. {notice.required ? "This notice is required by state rule." : "Provided as a courtesy; no state rule on file requires it."}
        </p>
      </article>
    </>
  );
}
