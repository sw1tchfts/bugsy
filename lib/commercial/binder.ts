// The audit binder (spec 14 rule 10), pure: a printable page and CSVs from the binder data. Every value is escaped; maps
// are drawn from the stored image with the devices on top, so the binder stands alone offline.
import { strToU8 } from "fflate";
import { toCsv } from "@/lib/compliance/export";
import type { BinderData } from "./db";
import { ACTION_LABELS, type Action, KIND_LABELS, KIND_TAGS, type DeviceKind, hasActivity } from "./devices";

export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

const kindLabel = (k: string) => KIND_LABELS[k as DeviceKind] ?? k;
/** A moment in the company's time zone with the zone's abbreviation (CLAUDE.md: business times are the tenant's). */
export function stamp(d: Date | string | null, timeZone: string): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).formatToParts(new Date(d));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} ${get("timeZoneName")}`;
}
const pct = (v: number | null) => (v === null ? "no data" : `${(v * 100).toFixed(0)}%`);

function table(headers: string[], rows: unknown[][]): string {
  if (rows.length === 0) return `<p class="empty">None in this period.</p>`;
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function mapFigure(data: BinderData, mapId: string, image: { type: string; base64: string } | undefined): string {
  const m = data.maps.find((x) => x.id === mapId);
  if (!m) return "";
  const devices = data.devices.filter((d) => d.status === "active" && d.map_id === m.id && d.x !== null && d.y !== null);
  const r = Math.max(9, Math.min(m.width, m.height) / 45);
  const marks = devices
    .map((d) => {
      const cx = (d.x as number) * m.width;
      const cy = (d.y as number) * m.height;
      const label = `${KIND_TAGS[d.kind as DeviceKind] ?? "?"} ${d.number}`;
      return `<g>${data.hot.has(d.id) ? `<circle cx="${cx}" cy="${cy}" r="${r + 4}" fill="none" stroke="#d03b3b" stroke-width="3"/>` : ""}<circle cx="${cx}" cy="${cy}" r="${r}" fill="#2a78d6" stroke="#fff" stroke-width="2"/><text x="${cx + r + 3}" y="${cy + r * 0.35}" font-size="${r * 0.9}" fill="#0b0b0b" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(label)}</text></g>`;
    })
    .join("");
  const bg = image ? `<image href="data:${esc(image.type)};base64,${image.base64}" x="0" y="0" width="${m.width}" height="${m.height}"/>` : `<rect width="${m.width}" height="${m.height}" fill="#f5f5f4"/>`;
  return `<figure><svg viewBox="0 0 ${m.width} ${m.height}" role="img" aria-label="${esc(m.name)}">${bg}${marks}</svg><figcaption>${esc(m.name)}: ${devices.length} device(s). Blue marks a device with its kind and number; a red ring marks a hot device (activity on 2 of its last 3 checks).</figcaption></figure>`;
}

/** The binder's files: binder.html for print and one CSV per section. */
export function binderFiles(data: BinderData, images: Map<string, { type: string; base64: string }>): Record<string, Uint8Array> {
  const iso = (d: Date | string | null) => stamp(d, data.time_zone);
  const active = data.devices.filter((d) => d.status === "active");
  const deviceRows = data.devices.map((d) => [d.number, kindLabel(d.kind), d.zone, d.location, d.barcode ?? "", d.status, d.installed_on, d.removed_on ?? "", d.removed_reason ?? "", data.hot.has(d.id) ? "hot" : ""]);
  const checkRows = data.checks.map((c) => [
    iso(c.checked_at),
    c.number,
    kindLabel(c.kind),
    c.status,
    c.activity ?? "",
    c.count ?? "",
    c.bait_consumed_pct === null ? "" : `${c.bait_consumed_pct}%`,
    c.pest ?? "",
    c.actions.map((a) => ACTION_LABELS[a as Action] ?? a).join("; "),
    hasActivity(c) ? "yes" : "no",
    c.checked_by_name ?? c.source,
    c.notes ?? "",
  ]);
  const eventRows = data.events.map((e) => [iso(e.at), e.number, e.kind, JSON.stringify(e.before ?? {}), JSON.stringify(e.after ?? {}), e.by_name ?? ""]);
  const trendRows = data.trend.map((t) => [t.month, kindLabel(t.kind), t.checked, t.active, pct(t.rate), t.captures]);
  const sightingRows = data.sightings.map((s) => [iso(s.seen_at), s.pest, s.location, s.count ?? "", s.reported_by ?? "", s.source, s.notes ?? "", s.resolved_at ? iso(s.resolved_at) : "open", s.resolution ?? ""]);
  const recRows = data.recommendations.map((r) => [iso(r.created_at), r.category, r.description, r.responsibility, r.priority, r.owner_name ?? "", r.due_on ?? "", r.status, r.closed_on ?? "", r.closed_note ?? ""]);
  const appRows = data.applications.map((a) => [a.business_date, a.product, a.epa_reg_no, `${a.amount} ${a.unit}`, a.site_treated, a.target_pests.join("; "), a.applicator ?? ""]);
  const docRows = data.documents.map((d) => [d.title, d.kind, d.valid_until ?? ""]);

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Audit binder: ${esc(data.property.account_name)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:system-ui,sans-serif;color:#1c1917;margin:24px;max-width:1100px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px;border-bottom:1px solid #d6d3d1;padding-bottom:4px}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{border-bottom:1px solid #e7e5e4;padding:4px 6px;text-align:left;vertical-align:top}
th{color:#57534e;font-weight:600}.empty{color:#78716c;font-size:13px}figure{margin:12px 0;break-inside:avoid}svg{width:100%;height:auto;border:1px solid #d6d3d1}
figcaption{font-size:12px;color:#57534e}.meta{color:#57534e;font-size:13px}@media print{h2{break-after:avoid}table{break-inside:auto}}
</style></head><body>
<h1>Pest management audit binder</h1>
<p class="meta">${esc(data.property.account_name)}, ${esc(data.property.address)}<br>Period ${esc(data.range.from)} to ${esc(data.range.to)}. Made ${esc(iso(data.made_at))}.</p>
<h2>Service provider</h2>
<p>${esc(data.company.legal_name ?? data.company.name)}</p>
${table(["Branch", "Business license", "Expires"], data.company.licenses.map((l) => [l.branch, l.number ?? "not on file", l.expires ?? ""]))}
<h2>Applicators who serviced the site</h2>
${table(["Name", "Certification", "Categories", "Expires"], data.applicators.map((a) => [a.name, a.cert_number ?? "not on file", a.categories.join(", "), a.expires ?? ""]))}
<h2>Device maps</h2>
${data.maps.length ? data.maps.map((m) => mapFigure(data, m.id, images.get(m.file_id))).join("") : `<p class="empty">No map on file.</p>`}
<h2>Devices (${active.length} active)</h2>
${table(["Number", "Kind", "Zone", "Location", "Barcode", "Status", "Installed", "Removed", "Why removed", ""], deviceRows)}
<h2>Device changes in the period</h2>
${table(["When", "Device", "Change", "Before", "After", "By"], eventRows)}
<h2>Activity trend</h2>
${table(["Month", "Kind", "Checked", "With activity", "Activity rate", "Captures"], trendRows)}
<h2>Device checks</h2>
${table(["When", "Device", "Kind", "Status", "Activity", "Caught", "Bait eaten", "Pest", "Actions", "Activity seen", "By", "Notes"], checkRows)}
<h2>Sightings</h2>
${table(["Seen", "Pest", "Location", "Count", "Reported by", "Source", "Notes", "Resolved", "Resolution"], sightingRows)}
<h2>Recommendations and corrective actions</h2>
${table(["Raised", "Category", "What", "Who acts", "Priority", "Owner", "Due", "Status", "Closed", "Closing note"], recRows)}
<h2>Pesticide applications</h2>
${table(["Date", "Product", "EPA reg. no.", "Amount", "Site", "Target pests", "Applicator"], appRows)}
<h2>Service visits</h2>
${table(["Date", "Service", "Technician"], data.visits.map((v) => [v.date ?? "", v.service, v.technician ?? ""]))}
<h2>Site documents</h2>
${table(["Title", "Kind", "Valid until"], docRows)}
</body></html>
`;
  return {
    "binder.html": strToU8(html),
    "devices.csv": strToU8(toCsv(["number", "kind", "zone", "location", "barcode", "status", "installed_on", "removed_on", "removed_reason", "hot"], deviceRows)),
    "device_checks.csv": strToU8(toCsv(["checked_at", "device", "kind", "status", "activity", "count", "bait_consumed", "pest", "actions", "activity_seen", "by", "notes"], checkRows)),
    "device_changes.csv": strToU8(toCsv(["at", "device", "change", "before", "after", "by"], eventRows)),
    "trend.csv": strToU8(toCsv(["month", "kind", "checked", "with_activity", "activity_rate", "captures"], trendRows)),
    "sightings.csv": strToU8(toCsv(["seen_at", "pest", "location", "count", "reported_by", "source", "notes", "resolved", "resolution"], sightingRows)),
    "recommendations.csv": strToU8(toCsv(["raised", "category", "description", "responsibility", "priority", "owner", "due_on", "status", "closed_on", "closed_note"], recRows)),
    "applications.csv": strToU8(toCsv(["date", "product", "epa_reg_no", "amount", "site_treated", "target_pests", "applicator"], appRows)),
  };
}
