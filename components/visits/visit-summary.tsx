import { CREW_ROLE_LABELS } from "@/lib/dispatch/checks";
import { formatInstant } from "@/lib/dates";
import { type Locale, t } from "@/lib/tech/i18n";
import type { RouteVisit } from "@/lib/tech/route-types";
import { formatCents } from "@/lib/money";

/** What was done at the stop: the post-service summary (spec 11) and the facts the record locks (spec 07). */
export function VisitSummary({ visit, locale, timezone, names }: { visit: RouteVisit; locale: Locale; timezone: string; names: Map<string, string> }) {
  const c = visit.captured;
  const when = (iso: string | null) => (iso ? formatInstant(iso, timezone) : "");
  const labelText = (status: string) =>
    status === "ok" ? t(locale, "products.labelOk") : status === "below_label" ? t(locale, "products.labelBelow") : status === "above_label" ? t(locale, "products.labelAbove") : t(locale, "products.labelUnknown");
  return (
    <div className="grid gap-4 text-sm" data-testid="visit-summary">
      <section>
        <h2 className="font-semibold">{visit.service_type.name}</h2>
        <p>
          {visit.account.name}, {visit.property.address}
        </p>
        <p className="text-stone-600">
          {t(locale, `status.${visit.status}`)}
          {c.arrived_at ? `. ${t(locale, "stop.arrivedAt", { time: when(c.arrived_at) })}` : ""}
          {c.departed_at ? `. ${t(locale, "stop.completed", { time: when(c.departed_at) })}` : ""}
        </p>
        <p className="text-stone-600">
          {t(locale, "route.crew")}: {visit.crew.map((m) => `${m.name} (${CREW_ROLE_LABELS[m.role]}${m.credential?.cert_number ? `, ${m.credential.cert_number}` : ""})`).join(", ") || "none"}
        </p>
      </section>
      <section>
        <h3 className="font-semibold">{t(locale, "products.title")}</h3>
        {c.products.length === 0 ? (
          <p className="text-stone-500">{t(locale, "products.none")}</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="py-1 pr-3">{t(locale, "products.product")}</th>
                <th className="py-1 pr-3">EPA</th>
                <th className="py-1 pr-3">{t(locale, "products.amount")}</th>
                <th className="py-1 pr-3">{t(locale, "products.site")}</th>
                <th className="py-1 pr-3">{t(locale, "products.pests")}</th>
                <th className="py-1 pr-3">{t(locale, "products.appliedBy")}</th>
                <th className="py-1 pr-3" />
              </tr>
            </thead>
            <tbody>
              {c.products.map((p) => (
                <tr key={p.id} className="border-t border-stone-100">
                  <td className="py-1 pr-3 font-medium">{p.product_name}</td>
                  <td className="py-1 pr-3 font-mono text-xs">{p.epa_reg_no}</td>
                  <td className="py-1 pr-3">
                    {p.amount} {p.amount_unit.replace("_", " ")}
                    {p.carrier_amount ? ` / ${p.carrier_amount} ${p.carrier_unit?.replace("_", " ")}` : ""}
                  </td>
                  <td className="py-1 pr-3">
                    {p.site_treated}
                    {p.location_description ? ` (${p.location_description})` : ""}
                  </td>
                  <td className="py-1 pr-3">{p.target_pests.join(", ")}</td>
                  <td className="py-1 pr-3">{names.get(p.applied_by) ?? "Crew"}</td>
                  <td className={`py-1 text-xs ${p.label_check?.status === "ok" ? "text-emerald-800" : p.label_check && p.label_check.status !== "no_rate_on_file" ? "text-amber-800" : "text-stone-500"}`}>
                    {p.label_check ? labelText(p.label_check.status) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="grid gap-1">
        <p>
          <span className="font-semibold">{t(locale, "areas.areas")}:</span> {c.areas_treated.map((a) => t(locale, `area.${a}`)).join(", ") || "none"}
        </p>
        <p>
          <span className="font-semibold">{t(locale, "products.pests")}:</span> {c.target_pests.join(", ") || "none"}
        </p>
        <p>
          <span className="font-semibold">{t(locale, "conditions.title")}:</span>{" "}
          {c.conditions
            ? [c.conditions.temperature_f !== null ? `${c.conditions.temperature_f} F` : null, c.conditions.wind_mph !== null ? `${c.conditions.wind_mph} mph ${c.conditions.wind_direction ?? ""}`.trim() : null, c.conditions.sky]
                .filter(Boolean)
                .join(", ") + (c.conditions.source === "weather" ? ` (${t(locale, "conditions.fromWeather", { time: when(c.conditions.captured_at) })})` : "")
            : "none"}
        </p>
      </section>
      <section>
        <h3 className="font-semibold">{t(locale, "notes.title")}</h3>
        {c.notes.length === 0 ? <p className="text-stone-500">{t(locale, "notes.none")}</p> : null}
        <ul className="grid gap-1">
          {c.notes.map((n) => (
            <li key={n.id}>
              <span className="text-xs text-stone-500">{t(locale, `notes.kind.${n.kind}`)}: </span>
              {n.content}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="font-semibold">{t(locale, "photos.title")}</h3>
        {c.photos.length === 0 ? <p className="text-stone-500">{t(locale, "photos.none")}</p> : null}
        <ul className="flex flex-wrap gap-2">
          {c.photos.map((p) => (
            <li key={p.id} className="text-xs">
              <img src={`/api/files/${p.file_id}`} alt={p.caption ?? t(locale, `photos.kind.${p.kind}`)} className="h-24 w-24 rounded object-cover" />
              <span>
                {t(locale, `photos.kind.${p.kind}`)}
                {p.caption ? `: ${p.caption}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="font-semibold">{t(locale, "signature.title")}</h3>
        {c.signature ? (
          <div>
            <img src={`/api/files/${c.signature.file_id}`} alt={`${c.signature.signer_name} signature`} className="h-20 rounded border border-stone-200 bg-white" data-testid="signature-image" />
            <p className="text-xs text-stone-600">{t(locale, "signature.saved", { name: c.signature.signer_name, time: when(c.signature.signed_at) })}</p>
          </div>
        ) : (
          <p className="text-stone-500">none</p>
        )}
      </section>
      {visit.billing_mode === "per_visit" ? <p className="text-stone-600">{formatCents(visit.price_cents)}</p> : null}
    </div>
  );
}
