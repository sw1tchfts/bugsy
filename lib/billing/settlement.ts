// Cancellation settlement as documents (spec 08 rule 12): spec 04's preview says how much; this says which invoice or
// credit memo carries it and with which lines. Pure and fixture tested.
import type { Settlement } from "@/lib/agreements/billing";

export type SettlementLine = { description: string; amount_cents: number; taxable: boolean };
export type SettlementDocument = { kind: "invoice" | "credit_memo"; source: "settlement"; lines: SettlementLine[] };

/**
 * Delivered but unbilled service becomes a final invoice with the cancellation fee as its own line; prepaid but
 * undelivered service becomes a credit memo, with any fee on a separate invoice so the credit stays whole.
 */
export function settlementDocuments(preview: Settlement, agreement: { number: number; service_type_name: string }): SettlementDocument[] {
  const documents: SettlementDocument[] = [];
  const label = `${agreement.service_type_name} (agreement #${agreement.number})`;
  if (preview.finalInvoiceCents > 0 || (preview.refundCents === 0 && preview.feeCents > 0)) {
    const lines: SettlementLine[] = [];
    if (preview.finalInvoiceCents > 0) lines.push({ description: `Service delivered before cancellation: ${label}`, amount_cents: preview.finalInvoiceCents, taxable: true });
    if (preview.feeCents > 0) lines.push({ description: `Early cancellation fee: ${label}`, amount_cents: preview.feeCents, taxable: false });
    documents.push({ kind: "invoice", source: "settlement", lines });
  }
  if (preview.refundCents > 0) {
    documents.push({ kind: "credit_memo", source: "settlement", lines: [{ description: `Prepaid service not delivered: ${label}`, amount_cents: -preview.refundCents, taxable: false }] });
    if (preview.feeCents > 0) {
      documents.push({ kind: "invoice", source: "settlement", lines: [{ description: `Early cancellation fee: ${label}`, amount_cents: preview.feeCents, taxable: false }] });
    }
  }
  return documents;
}
