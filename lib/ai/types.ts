// The AI features' shared shapes (spec 21). A provider drafts and answers; it never writes a record.
import type { LabelRate } from "@/lib/catalog/label-rates";

export type Usage = { model: string; input_tokens: number; output_tokens: number };

export type SummaryInput = {
  service: string;
  customer_first_name: string | null;
  notes: string[];
  conditions: string[];
  recommendations: string[];
  areas: string[];
  pests: string[];
  products: string[];
  language: "en" | "es";
};

export type PortalVisitFact = { id: string; date: string | null; status: string; service: string; address: string; window: string | null; products?: string[]; areas?: string[] };
export type PortalContext = {
  today: string;
  company: string;
  customer: string;
  properties: { id: string; address: string }[];
  upcoming: PortalVisitFact[];
  recent: PortalVisitFact[];
  balance_cents: number;
  open_invoices: { id: string; number: number | null; due_on: string | null; owed_cents: number }[];
  plans: { id: string; service: string; address: string; price_cents: number | null; cadence: string | null }[];
  requests: { id: string; kind: string; status: string; preferred_date: string | null }[];
};
export type PortalAnswer = { answer: string; needs_office: boolean; sources: string[] };

export interface AiProvider {
  readonly kind: "claude" | "local";
  draftSummary(input: SummaryInput): Promise<{ text: string; usage: Usage }>;
  readLabel(text: string): Promise<{ rows: LabelRate[]; note: string | null; usage: Usage }>;
  answerQuestion(question: string, context: PortalContext): Promise<PortalAnswer & { usage: Usage }>;
}

/** The model declined (a refusal) or gave nothing usable: the person takes over (spec 21 edge cases). */
export class AiUnavailable extends Error {
  constructor(
    message: string,
    readonly outcome: "refused" | "failed",
  ) {
    super(message);
  }
}
