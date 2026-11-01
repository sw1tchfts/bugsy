// The wood-destroying insect report (spec 15 rule 7), pure: its findings, what stops it from being issued, and the
// printable report. Generic: a state's own form arrives with its rule pack (`report.format`).

export const FINDINGS = [
  { key: "live_insects", label: "Live wood-destroying insects" },
  { key: "dead_insects", label: "Dead insects, wings or shed parts" },
  { key: "damage", label: "Visible damage" },
  { key: "evidence", label: "Mud tubes, frass or exit holes" },
  { key: "previous_treatment", label: "Evidence of previous treatment" },
] as const;

export type FindingKey = (typeof FINDINGS)[number]["key"];
export type Finding = { seen: boolean | null; where: string };
export type Findings = Partial<Record<FindingKey, Finding>>;

export type WdiReport = {
  number: number | null;
  requested_by: string | null;
  buyer: string | null;
  seller: string | null;
  structures: string | null;
  inspected_areas: string | null;
  inaccessible_areas: string | null;
  findings: Findings;
  treatment_recommended: boolean | null;
  notes: string | null;
  status: string;
  issued_at: string | Date | null;
};

/** What must be answered before the report is issued. */
export function wdiProblems(r: WdiReport, inspector: { name: string; cert_number: string | null } | null): string[] {
  const problems: string[] = [];
  if (!r.inspected_areas?.trim()) problems.push("Say which areas were inspected.");
  if (!r.inaccessible_areas?.trim()) problems.push("Say which areas could not be inspected (or none).");
  for (const f of FINDINGS) {
    const answer = r.findings[f.key];
    if (!answer || answer.seen === null) problems.push(`Answer: ${f.label.toLowerCase()}.`);
    else if (answer.seen && !answer.where.trim()) problems.push(`Say where: ${f.label.toLowerCase()}.`);
  }
  if (r.treatment_recommended === null) problems.push("Say whether treatment is recommended.");
  if (!inspector) problems.push("The inspection needs an inspector on its crew.");
  else if (!inspector.cert_number) problems.push(`${inspector.name} has no credential on file for this state.`);
  return problems;
}

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export type WdiContext = {
  company: { name: string; legal_name: string | null; license: string | null };
  property: { address: string; state: string };
  inspected_on: string | null;
  /** The issue date in the company's time zone. */
  issued_on: string | null;
  inspector: { name: string; cert_number: string | null; license_number: string | null } | null;
};

/** The printable report. Every value is escaped. */
export function wdiHtml(r: WdiReport, ctx: WdiContext): string {
  const yesNo = (v: boolean | null) => (v === null ? "not answered" : v ? "Yes" : "No");
  const rows = FINDINGS.map((f) => {
    const a = r.findings[f.key];
    return `<tr><td>${esc(f.label)}</td><td>${esc(yesNo(a?.seen ?? null))}</td><td>${esc(a?.seen ? a.where : "")}</td></tr>`;
  }).join("");
  return `<article class="wdi">
<h1>Wood-destroying insect inspection report${r.number ? ` No. ${esc(r.number)}` : " (draft)"}</h1>
<p>${esc(ctx.company.legal_name ?? ctx.company.name)}${ctx.company.license ? `, license ${esc(ctx.company.license)}` : ""}</p>
<dl>
<dt>Property</dt><dd>${esc(ctx.property.address)}</dd>
<dt>Inspected on</dt><dd>${esc(ctx.inspected_on ?? "")}</dd>
<dt>Requested by</dt><dd>${esc(r.requested_by)}</dd>
<dt>Buyer</dt><dd>${esc(r.buyer)}</dd>
<dt>Seller</dt><dd>${esc(r.seller)}</dd>
<dt>Structures inspected</dt><dd>${esc(r.structures)}</dd>
<dt>Areas inspected</dt><dd>${esc(r.inspected_areas)}</dd>
<dt>Areas not inspected and why</dt><dd>${esc(r.inaccessible_areas)}</dd>
</dl>
<table><thead><tr><th>Finding</th><th>Seen</th><th>Where</th></tr></thead><tbody>${rows}</tbody></table>
<p>Treatment recommended: ${esc(yesNo(r.treatment_recommended))}</p>
${r.notes ? `<p>Notes: ${esc(r.notes)}</p>` : ""}
<p>Inspector: ${esc(ctx.inspector?.name ?? "")}${ctx.inspector?.cert_number ? `, certification ${esc(ctx.inspector.cert_number)}` : ""}${ctx.inspector?.license_number ? `, license ${esc(ctx.inspector.license_number)}` : ""}</p>
<p class="small">This report covers visible and accessible areas on the date of inspection. It is not a guarantee that no infestation or damage exists in areas not inspected.${ctx.issued_on ? ` Issued ${esc(ctx.issued_on)}.` : ""}</p>
</article>`;
}
