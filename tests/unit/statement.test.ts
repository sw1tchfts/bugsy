import { describe, expect, it } from "vitest";
import { type StatementInvoice, type StatementPayment, statement } from "@/lib/billing/statement";

const invoice = (overrides: Partial<StatementInvoice>): StatementInvoice => ({
  id: "i1",
  number: 1,
  kind: "invoice",
  status: "issued",
  issued_on: "2026-10-01",
  due_on: "2026-10-01",
  total_cents: 10000,
  paid_cents: 0,
  source: "installment",
  memo: null,
  ...overrides,
});

const payment = (overrides: Partial<StatementPayment>): StatementPayment => ({
  id: "p1",
  kind: "payment",
  method: "check",
  status: "succeeded",
  amount_cents: 10000,
  received_at: "2026-10-05T15:00:00Z",
  reference: "1042",
  refund_of: null,
  ...overrides,
});

describe("the account statement (rule 14)", () => {
  it("runs a balance through invoices, credit memos, payments and refunds in date order", () => {
    const s = statement(
      [
        invoice({ id: "i1", number: 1, status: "paid", paid_cents: 10000 }),
        invoice({ id: "i2", number: 2, issued_on: "2026-11-01", due_on: "2026-11-01", total_cents: 4500, status: "past_due" }),
        invoice({ id: "cm", number: 3, kind: "credit_memo", issued_on: "2026-11-10", total_cents: -2000, source: "settlement", memo: "Cancellation" }),
        invoice({ id: "draft", number: null, status: "draft", issued_on: null, total_cents: 999 }),
        invoice({ id: "void", number: 4, status: "void", issued_on: "2026-11-11", total_cents: 999 }),
      ],
      [
        payment({ id: "p1", amount_cents: 12000 }),
        payment({ id: "r1", kind: "refund", method: "check", amount_cents: 2000, received_at: "2026-11-12T15:00:00Z", refund_of: "p1" }),
        payment({ id: "failed", status: "failed", amount_cents: 500, received_at: "2026-11-13T15:00:00Z" }),
      ],
      [{ payment_id: "p1", invoice_id: "i1", amount_cents: 10000 }],
      "2026-11-15",
    );
    expect(s.lines.map((l) => [l.date, l.type, l.amount_cents, l.balance_cents])).toEqual([
      ["2026-10-01", "invoice", 10000, 10000],
      ["2026-10-05", "payment", -12000, -2000],
      ["2026-11-01", "invoice", 4500, 2500],
      ["2026-11-10", "credit_memo", -2000, 500],
      ["2026-11-12", "refund", 2000, 2500],
    ]);
    expect(s.balance_cents).toBe(2500);
    expect(s.open_invoices_cents).toBe(4500);
    expect(s.past_due_cents).toBe(4500);
    // 12000 paid, 10000 allocated, 2000 refunded: nothing left unallocated.
    expect(s.unallocated_cents).toBe(0);
  });

  it("shows an overpayment as unallocated credit", () => {
    const s = statement([invoice({ status: "paid", paid_cents: 10000 })], [payment({ amount_cents: 15000 })], [{ payment_id: "p1", invoice_id: "i1", amount_cents: 10000 }]);
    expect(s.unallocated_cents).toBe(5000);
    expect(s.balance_cents).toBe(-5000);
  });

  it("puts a payment after an invoice issued the same day", () => {
    const s = statement([invoice({ issued_on: "2026-10-05" })], [payment({})], []);
    expect(s.lines.map((l) => l.type)).toEqual(["invoice", "payment"]);
  });
});
