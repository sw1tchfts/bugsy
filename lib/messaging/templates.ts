// Message templates (spec 11 rule 10): built-in defaults per purpose and channel, the variables each purpose may use,
// and rendering. A company's override replaces the default's subject and body; its variables are checked on save.
import type { Channel } from "./rules";

export const TEMPLATE_KEYS = [
  "reminder",
  "on_the_way",
  "summary",
  "review",
  "invoice",
  "notice.post_application",
  "notice.pre_application_offer",
  "notice.resident_notice",
  "notice.registry_advance",
  "notice.other",
  "keyword.stop",
  "keyword.start",
  "keyword.help",
  "campaign",
  "portal_invite",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export type Template = { subject: string | null; body: string };

const COMMON = ["company_name", "company_phone", "customer_name", "property_address"] as const;

/** The variables each purpose may use; anything else in a template is refused when it is saved. */
export const TEMPLATE_VARIABLES: Record<TemplateKey, readonly string[]> = {
  reminder: [...COMMON, "visit_date", "arrival_window", "service_name", "prep_checklist"],
  on_the_way: [...COMMON, "technician_name", "service_name", "eta"],
  summary: [...COMMON, "service_name", "visit_date", "technician_name", "summary_url", "customer_summary", "summary_text", "survey_line"],
  review: [...COMMON, "review_url", "service_name"],
  invoice: [...COMMON, "invoice_number", "invoice_total", "due_date"],
  "notice.post_application": [...COMMON, "service_name", "visit_date", "notice_url", "notice_text"],
  "notice.pre_application_offer": [...COMMON, "notice_url", "notice_text"],
  "notice.resident_notice": [...COMMON, "service_name", "visit_date", "notice_url", "notice_text"],
  "notice.registry_advance": [...COMMON, "visit_date", "notice_url", "notice_text"],
  "notice.other": [...COMMON, "notice_url", "notice_text"],
  "keyword.stop": ["company_name", "company_phone"],
  "keyword.start": ["company_name", "company_phone"],
  "keyword.help": ["company_name", "company_phone"],
  campaign: [...COMMON, "unsubscribe_url"],
  portal_invite: [...COMMON, "portal_url"],
};

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  reminder: "Visit reminder",
  on_the_way: "On the way",
  summary: "Visit summary",
  review: "Review request",
  invoice: "Invoice",
  "notice.post_application": "Post-application notice",
  "notice.pre_application_offer": "Pre-application offer",
  "notice.resident_notice": "Resident notice",
  "notice.registry_advance": "Registry advance notice",
  "notice.other": "Other notice",
  "keyword.stop": "STOP confirmation",
  "keyword.start": "START confirmation",
  "keyword.help": "HELP answer",
  campaign: "Campaign (starting text)",
  portal_invite: "Portal invitation",
};

const D = (subject: string | null, body: string): Template => ({ subject, body });

/** Built-in templates. SMS has no subject; mail uses the email text. */
export const DEFAULT_TEMPLATES: Record<TemplateKey, Partial<Record<Channel, Template>>> = {
  reminder: {
    sms: D(null, "{{company_name}}: reminder, your {{service_name}} visit at {{property_address}} is {{visit_date}}{{arrival_window}}.{{prep_checklist}} Reply here with any questions. Reply STOP to opt out."),
    email: D("Your visit {{visit_date}}", "Hi {{customer_name}},\n\nThis is a reminder that your {{service_name}} visit at {{property_address}} is {{visit_date}}{{arrival_window}}.{{prep_checklist}}\n\nQuestions? Call {{company_phone}} or reply to this email.\n\n{{company_name}}"),
  },
  on_the_way: {
    sms: D(null, "{{company_name}}: {{technician_name}} is on the way for your {{service_name}} visit{{eta}}."),
    email: D("{{technician_name}} is on the way", "Hi {{customer_name}},\n\n{{technician_name}} is on the way to {{property_address}} for your {{service_name}} visit{{eta}}.\n\n{{company_name}}"),
  },
  summary: {
    sms: D(null, "{{company_name}}: your {{service_name}} visit is done. What we applied and what to know: {{summary_url}}"),
    email: D("Your {{service_name}} visit {{visit_date}}", "Hi {{customer_name}},\n\n{{technician_name}} finished your {{service_name}} visit at {{property_address}}. Here is what was done:\n\n{{customer_summary}}{{summary_text}}\n\nThe same summary online: {{summary_url}}\n\nQuestions? Call {{company_phone}}.\n\n{{company_name}}"),
  },
  review: {
    sms: D(null, "{{company_name}}: thanks for having us. Would you leave a quick review? {{review_url}}"),
    email: D("How did we do?", "Hi {{customer_name}},\n\nThanks for choosing {{company_name}}. If you have a minute, a review helps a local business a lot: {{review_url}}\n\n{{company_name}}"),
  },
  invoice: {
    email: D("Invoice #{{invoice_number}} from {{company_name}}", "Hi {{customer_name}},\n\nYour invoice #{{invoice_number}} for {{invoice_total}} is due {{due_date}}.\n\nQuestions? Call {{company_phone}}.\n\n{{company_name}}"),
  },
  "notice.post_application": {
    sms: D(null, "{{company_name}}: pesticide application information for {{property_address}} on {{visit_date}}: {{notice_url}}"),
    email: D("Pesticide application information, {{visit_date}}", "{{customer_name}},\n\n{{notice_text}}\n\nOnline: {{notice_url}}\n\n{{company_name}}, {{company_phone}}"),
    mail: D("Pesticide application information", "{{customer_name}}\n\n{{notice_text}}\n\n{{company_name}}, {{company_phone}}"),
  },
  "notice.pre_application_offer": {
    sms: D(null, "{{company_name}}: you may ask to be told before each pesticide application at {{property_address}}. Details: {{notice_url}}"),
    email: D("Advance notice of pesticide applications", "{{customer_name}},\n\n{{notice_text}}\n\nOnline: {{notice_url}}\n\n{{company_name}}, {{company_phone}}"),
    mail: D("Advance notice of pesticide applications", "{{customer_name}}\n\n{{notice_text}}\n\n{{company_name}}, {{company_phone}}"),
  },
  "notice.resident_notice": {
    sms: D(null, "{{company_name}}: notice of a pesticide application at {{property_address}}: {{notice_url}}"),
    email: D("Notice of pesticide application", "{{customer_name}},\n\n{{notice_text}}\n\nOnline: {{notice_url}}\n\n{{company_name}}, {{company_phone}}"),
    mail: D("Notice of pesticide application", "{{customer_name}}\n\n{{notice_text}}\n\n{{company_name}}, {{company_phone}}"),
  },
  "notice.registry_advance": {
    sms: D(null, "{{company_name}}: advance notice of a pesticide application near {{property_address}} on {{visit_date}}: {{notice_url}}"),
    email: D("Advance notice: pesticide application {{visit_date}}", "{{customer_name}},\n\n{{notice_text}}\n\nOnline: {{notice_url}}\n\n{{company_name}}, {{company_phone}}"),
    mail: D("Advance notice of a pesticide application", "{{customer_name}}\n\n{{notice_text}}\n\n{{company_name}}, {{company_phone}}"),
  },
  "notice.other": {
    sms: D(null, "{{company_name}}: a notice about {{property_address}}: {{notice_url}}"),
    email: D("A notice from {{company_name}}", "{{customer_name}},\n\n{{notice_text}}\n\nOnline: {{notice_url}}\n\n{{company_name}}, {{company_phone}}"),
    mail: D("A notice from {{company_name}}", "{{customer_name}}\n\n{{notice_text}}\n\n{{company_name}}, {{company_phone}}"),
  },
  "keyword.stop": { sms: D(null, "{{company_name}}: you are unsubscribed and will get no more texts. Reply START to resubscribe.") },
  "keyword.start": { sms: D(null, "{{company_name}}: you are subscribed to texts again. Reply STOP to opt out, HELP for help.") },
  "keyword.help": { sms: D(null, "{{company_name}}: call {{company_phone}} for help. Reply STOP to opt out.") },
  campaign: {
    sms: D(null, "{{company_name}}: "),
    email: D("News from {{company_name}}", "Hi {{customer_name}},\n\n\n\n{{company_name}}\nUnsubscribe: {{unsubscribe_url}}"),
  },
  portal_invite: {
    email: D("Your {{company_name}} account online", "Hi {{customer_name}},\n\n{{company_name}} set up your account online: see your next visit, what was applied at your home, your invoices and cards, and ask for a re-service.\n\nOpen it here to set your password: {{portal_url}}\n\nQuestions? Call {{company_phone}}.\n\n{{company_name}}"),
  },
};

const VAR = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** The variables a template text uses. */
export function templateVariables(text: string): string[] {
  return [...new Set([...text.matchAll(VAR)].map((m) => m[1]))];
}

/** Unknown variables for the purpose (rule 10); empty when the template is fine. */
export function checkTemplate(key: TemplateKey, template: Template): string[] {
  const allowed = new Set(TEMPLATE_VARIABLES[key]);
  return [...templateVariables(template.subject ?? ""), ...templateVariables(template.body)].filter((v) => !allowed.has(v));
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Fills the variables; a missing value renders empty. */
export function render(text: string, vars: Readonly<Record<string, string | null | undefined>>): string {
  return text.replace(VAR, (_, name: string) => vars[name] ?? "");
}

/** The email HTML for a rendered text: escaped, paragraphs on blank lines, links clickable. */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`)
    .join("\n");
}

/** The template a company uses: its override when it has one, else the default. */
export function templateFor(key: TemplateKey, channel: Channel, overrides: readonly { key: string; channel: string; subject: string | null; body: string }[]): Template | null {
  const own = overrides.find((o) => o.key === key && o.channel === channel);
  if (own) return { subject: own.subject, body: own.body };
  const d = DEFAULT_TEMPLATES[key][channel] ?? (channel === "mail" ? DEFAULT_TEMPLATES[key].email : undefined);
  return d ?? null;
}

/** Spec 15 rule 6: the prep checklist as one sentence after the reminder's date; empty when the service type has none. */
export function prepText(items: readonly string[] | null): string {
  const list = (items ?? []).map((i) => i.trim().replace(/[.;]+$/, "")).filter(Boolean);
  return list.length ? ` Before we arrive, please: ${list.join("; ")}.` : "";
}
