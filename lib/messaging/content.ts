// What a visit summary and a notice say (spec 11 rule 8, spec 07): built from the loaded visit, as text for SMS and
// email bodies and as HTML for the public page and the email. Pure.
import { NOTICE_KIND_LABELS, type NoticeKind } from "@/lib/compliance/notices";
import type { RouteVisit } from "@/lib/tech/route-types";
import { escapeHtml } from "./templates";

export type CompanyFacts = { name: string; phone: string | null; license: string | null; address: string | null };

function when(value: string | null, timeZone: string): string {
  return value ? new Date(value).toLocaleString("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" }) : "";
}

function lead(visit: RouteVisit) {
  return visit.crew.find((c) => c.role === "lead") ?? visit.crew[0] ?? null;
}

/** The facts of the stop, line by line: service, times, applicator, each product with its EPA number, amount, where
 *  and against what, areas, pests, conditions, recommendations. */
export function summaryLines(visit: RouteVisit, timeZone: string): string[] {
  const lines: string[] = [];
  const c = visit.captured;
  const applicator = lead(visit);
  lines.push(`Service: ${visit.service_type.name} at ${visit.property.address}`);
  if (c.arrived_at || c.departed_at) lines.push(`Applied: ${when(c.arrived_at, timeZone)}${c.departed_at ? ` to ${when(c.departed_at, timeZone)}` : ""}`);
  if (applicator) lines.push(`Applicator: ${applicator.name}${applicator.credential?.cert_number ? `, certification ${applicator.credential.cert_number}` : ""}`);
  for (const p of c.products) {
    const where = [p.site_treated.replace(/_/g, " "), p.location_description].filter(Boolean).join(", ");
    const pests = p.target_pests.length ? `; target pests ${p.target_pests.join(", ")}` : "";
    lines.push(`Product: ${p.product_name} (EPA Reg. No. ${p.epa_reg_no}), ${p.amount} ${p.amount_unit.replace(/_/g, " ")}${where ? `, ${where}` : ""}${pests}`);
  }
  if (c.areas_treated.length) lines.push(`Areas treated: ${c.areas_treated.map((a) => a.replace(/_/g, " ")).join(", ")}`);
  if (c.target_pests.length) lines.push(`Pests: ${c.target_pests.join(", ")}`);
  if (c.conditions) {
    const w = c.conditions;
    const parts = [w.temperature_f !== null && w.temperature_f !== undefined ? `${w.temperature_f} F` : null, w.wind_mph !== null && w.wind_mph !== undefined ? `${w.wind_mph} mph wind` : null, w.sky ?? null].filter(Boolean);
    if (parts.length) lines.push(`Conditions: ${parts.join(", ")}`);
  }
  for (const n of c.notes.filter((x) => x.kind === "recommendation")) lines.push(`Recommendation: ${n.content}`);
  return lines;
}

export function summaryText(visit: RouteVisit, timeZone: string): string {
  return summaryLines(visit, timeZone).join("\n");
}

/** The summary as HTML for the email and the public page: the company, then each fact on its own line. */
export function summaryHtml(visit: RouteVisit, timeZone: string, company: CompanyFacts): string {
  const header = [company.name, company.address, company.license ? `Business license ${company.license}` : null, company.phone].filter(Boolean).map((l) => escapeHtml(l as string));
  const items = summaryLines(visit, timeZone).map((l) => `<li>${escapeHtml(l)}</li>`).join("");
  return `<header><strong>${header[0]}</strong>${header.slice(1).map((h) => `<br>${h}`).join("")}</header><h2>${escapeHtml(NOTICE_KIND_LABELS.post_application)}</h2><ul>${items}</ul>`;
}

/** A notice's text for its message, by kind; a post-application notice is the visit summary. */
export function noticeText(kind: NoticeKind, input: { visit: RouteVisit | null; timeZone: string; propertyAddress: string; forScheduledFor: string | null }): string {
  const label = NOTICE_KIND_LABELS[kind];
  switch (kind) {
    case "post_application":
    case "resident_notice":
      return input.visit ? `${label}\n\n${summaryText(input.visit, input.timeZone)}` : `${label} for ${input.propertyAddress}.`;
    case "registry_advance":
      return `${label}: a pesticide application is planned at or near ${input.propertyAddress}${input.forScheduledFor ? ` on ${input.forScheduledFor}` : ""}. Your address is on the state's notification registry, so you are told in advance.`;
    case "pre_application_offer":
      return `${label}: you may ask to be told before each pesticide application at ${input.propertyAddress}. Reply or call us to ask for advance notice.`;
    default:
      return `${label} for ${input.propertyAddress}.`;
  }
}

export function noticeHtml(text: string, company: CompanyFacts): string {
  const header = [company.name, company.address, company.license ? `Business license ${company.license}` : null, company.phone].filter(Boolean).map((l) => escapeHtml(l as string));
  const [title, ...rest] = text.split("\n\n");
  const body = rest.join("\n\n").split("\n").filter(Boolean).map((l) => `<li>${escapeHtml(l)}</li>`).join("");
  return `<header><strong>${header[0]}</strong>${header.slice(1).map((h) => `<br>${h}`).join("")}</header><h2>${escapeHtml(title)}</h2>${body ? `<ul>${body}</ul>` : ""}`;
}
