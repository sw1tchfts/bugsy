// The local provider (spec 21 rule 8), deterministic: what a company without an API key, development and the tests
// get. Summaries from a template of the notes, label rows from a pattern reader, portal answers for the common asks.
import { type LabelRate, parseRateUnit } from "@/lib/catalog/label-rates";
import type { AiProvider, PortalAnswer, PortalContext, SummaryInput, Usage } from "./types";

const USAGE: Usage = { model: "local", input_tokens: 0, output_tokens: 0 };
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const sentence = (s: string) => {
  const t = s.trim().replace(/\s+/g, " ");
  return t ? `${t[0].toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? "" : "."}` : "";
};

/** Rule 3: nothing with rates, amounts or EPA numbers reaches the customer's note. */
const TECHNICAL = /\bEPA\b|\b\d+(\.\d+)?\s*(fl\.?\s*oz|oz|ml|gal(lons?)?|lbs?|g|grams?|%)(?![a-z])|\/\s*(gal|1000|sq)/i;
const plain = (xs: string[]) => xs.flatMap((x) => x.split(/(?<=[.!?])\s+/)).filter((x) => x.trim() && !TECHNICAL.test(x));

export function localSummary(input: SummaryInput): string {
  const i = { ...input, notes: plain(input.notes), conditions: plain(input.conditions), recommendations: plain(input.recommendations) };
  const es = i.language === "es";
  const parts: string[] = [];
  parts.push(es ? `${i.customer_first_name ? `Hola ${i.customer_first_name}, h` : "H"}oy completamos su servicio de ${i.service.toLowerCase()}.` : `${i.customer_first_name ? `Hi ${i.customer_first_name}, w` : "W"}e finished your ${i.service.toLowerCase()} today.`);
  if (i.areas.length) parts.push(es ? `Tratamos ${list(i.areas)}.` : `We treated the ${list(i.areas)}.`);
  if (i.pests.length) parts.push(es ? `Atendimos ${list(i.pests)}.` : `We targeted ${list(i.pests)}.`);
  for (const c of i.conditions) parts.push(sentence(es ? `Encontramos: ${c}` : `We found ${c.replace(/^found\s+/i, "")}`));
  for (const n of i.notes) parts.push(sentence(n));
  if (i.recommendations.length) parts.push(es ? `Le recomendamos: ${i.recommendations.map((r) => r.replace(/\.$/, "")).join("; ")}.` : `We recommend: ${i.recommendations.map((r) => r.replace(/\.$/, "")).join("; ")}.`);
  parts.push(es ? "Si ve actividad antes de su próxima visita, llámenos y regresamos sin costo." : "If you see activity before your next visit, call us and we will come back at no charge.");
  return parts.filter(Boolean).join(" ");
}

const UNIT_WORDS: [RegExp, string][] = [
  [/fl\.?\s*oz|fluid ounces?/i, "fl_oz"],
  [/\bml\b|milliliters?/i, "ml"],
  [/\bgal(lons?)?\b/i, "gal"],
  [/\blbs?\b|pounds?/i, "lb"],
  [/\boz\b|ounces?/i, "oz"],
  [/1,?000 sq\.?\s*ft|1,?000 square feet/i, "1000_sqft"],
  [/\bacres?\b/i, "acre"],
  [/\bliters?\b|\bl\b/i, "l"],
];
const unitOf = (s: string) => UNIT_WORDS.find(([re]) => re.test(s))?.[1] ?? null;

/** Reads lines such as "Perimeter: 0.2 to 0.8 fl oz per gallon of water" into rate rows; unsure lines are left out. */
export function localLabelRows(text: string): LabelRate[] {
  const rows: LabelRate[] = [];
  const re = /(?:^|\n)\s*([A-Za-z][A-Za-z ,/&-]{2,60}?)\s*[:-]\s*(?:use\s+|apply\s+)?(\d+(?:\.\d+)?)\s*(?:to|-)\s*(\d+(?:\.\d+)?)\s+([A-Za-z. ,0-9]+?)\s+(?:per|\/)\s+([A-Za-z. ,0-9]+?)(?:\s+(?:of\s+water|of\s+finished\s+spray))?(?:[.;]|\n|$)/gi;
  for (const m of text.matchAll(re)) {
    const amount = unitOf(m[4]);
    const per = unitOf(m[5]);
    if (!amount || !per) continue;
    const rate_unit = `${amount}/${per}`;
    if (!parseRateUnit(rate_unit)) continue;
    const min = Number(m[2]);
    const max = Number(m[3]);
    if (!(min <= max)) continue;
    rows.push({ site: m[1].trim().toLowerCase(), min_rate: min, max_rate: max, rate_unit, target_pests: [] });
  }
  return rows;
}

/** "Thursday, November 12": a business date in words, without a time zone. */
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** The common asks (rule 8): next visit, last visit and what was used, balance, plan. Anything else goes to the office. */
export function localAnswer(question: string, c: PortalContext): PortalAnswer {
  const q = question.toLowerCase();
  const office = (extra = ""): PortalAnswer => ({ answer: `${extra}I can't answer that from your records. I've sent your question to the office, and their answer will show here.`, needs_office: true, sources: [] });
  // Health, exposure and anything that asks for an action go to people first (rule 7); a possible poisoning gets the
  // number to call now.
  if (/\b(sick|ill|poison(ed|ing)?|ate|eaten|lick(ed|ing)?|swallow(ed)?|rash|breath(e|ing)?|vomit(ing|ed)?|hospital|doctor|allerg(y|ic)|exposed|exposure)\b/.test(q)) {
    return office("If someone, or a pet, may have been poisoned, call Poison Control at 1-800-222-1222 now, or your vet. ");
  }
  if (/\b(safe|safety|toxic|pets?|dogs?|cats?|kids?|child(ren)?|baby|pregnant|cancel(l?ing|l?ed)?|refund|reschedule|book|change|stop|complain(t)?)\b/.test(q)) return office();
  if (/\b(next|upcoming|when)\b.*\b(visit|service|appointment|come|coming)\b|\bwhen (are|is|will) (you|the tech)/.test(q)) {
    const v = c.upcoming[0];
    if (!v) return { answer: "You have no visit scheduled or due right now. The office can set one up for you.", needs_office: false, sources: [] };
    const when = v.date ? `on ${day(v.date)}${v.window && v.window !== "any" ? ` (${v.window})` : ""}` : "soon; it is due but not yet on the schedule";
    return { answer: `Your next visit, ${v.service} at ${v.address}, is ${when}.`, needs_office: false, sources: [v.id] };
  }
  if (/\b(last|previous|recent)\b.*\b(visit|service|time)\b|\bwhat did (you|they) (spray|use|apply|put)\b|\bwhat (was|were) (sprayed|used|applied)\b/.test(q)) {
    const v = c.recent[0];
    if (!v) return { answer: "There is no completed visit on your account yet.", needs_office: false, sources: [] };
    const used = v.products?.length ? ` We used ${list(v.products)}${v.areas?.length ? ` on the ${list(v.areas)}` : ""}.` : "";
    return { answer: `Your last visit was ${v.service} at ${v.address}${v.date ? ` on ${day(v.date)}` : ""}.${used} The full record is under Visits.`, needs_office: false, sources: [v.id] };
  }
  if (/\b(balance|owe|bill|invoices?|pay|due)\b/.test(q)) {
    if (c.balance_cents <= 0) return { answer: "You have no balance due. Thank you!", needs_office: false, sources: [] };
    const next = c.open_invoices[0];
    return { answer: `Your balance is ${money(c.balance_cents)}${next?.due_on ? `; the next invoice is due ${day(next.due_on)}` : ""}. You can pay under Billing.`, needs_office: false, sources: c.open_invoices.map((i) => i.id) };
  }
  if (/\b(plan|agreement|contract|how often|price|cost)\b/.test(q)) {
    const p = c.plans[0];
    if (!p) return office();
    return { answer: `You are on ${p.service} at ${p.address}${p.cadence ? `, ${p.cadence}` : ""}${p.price_cents !== null ? `, at ${money(p.price_cents)} a visit` : ""}.`, needs_office: false, sources: [p.id] };
  }
  return office();
}

export const localAi: AiProvider = {
  kind: "local",
  draftSummary: async (input) => ({ text: localSummary(input), usage: USAGE }),
  readLabel: async (text) => {
    const rows = localLabelRows(text);
    return { rows, note: rows.length ? null : "No rates were found in that text. Paste the label's directions for use, or type the rates.", usage: USAGE };
  },
  answerQuestion: async (question, context) => ({ ...localAnswer(question, context), usage: USAGE }),
};
