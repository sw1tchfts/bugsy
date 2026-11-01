// Commissions (spec 17 rules 4 to 7), pure: what a sale earns under a plan, when it releases, when it is charged back.
import { addDays, addMonths } from "@/lib/dates";

export type Plan = {
  id: string;
  role_keys: readonly string[];
  user_ids: readonly string[];
  basis: "initial" | "first_year" | "flat";
  percent: number | string | null;
  flat_cents: number | string | null;
  hold_days: number;
  hold_paid_invoices: number;
  chargeback_days: number;
  active: boolean;
};

export type Sale = { starts_on: string; signed_on: string; visits: readonly { kind: string; due_start: string; price_cents: number | string }[] };

/** Rule 4: whether a plan covers the seller, by their role or by name. */
export function covers(plan: Pick<Plan, "role_keys" | "user_ids" | "active">, seller: { user_id: string; role_key: string }): boolean {
  return plan.active && (plan.user_ids.includes(seller.user_id) || plan.role_keys.includes(seller.role_key));
}

/** Rule 4: the basis and the amount, half up to the cent. Percent is a rate (numeric), never floating money. */
export function commissionFor(plan: Pick<Plan, "basis" | "percent" | "flat_cents">, sale: Sale): { basis_cents: number; amount_cents: number } {
  if (plan.basis === "flat") {
    const flat = Number(plan.flat_cents ?? 0);
    return { basis_cents: flat, amount_cents: flat };
  }
  const priced = sale.visits.filter((v) => v.kind === "initial" || v.kind === "recurring");
  const yearEnd = addMonths(sale.starts_on, 12);
  const basis =
    plan.basis === "initial"
      ? priced.filter((v) => v.kind === "initial").reduce((s, v) => s + Number(v.price_cents), 0)
      : priced.filter((v) => v.due_start >= sale.starts_on && v.due_start < yearEnd).reduce((s, v) => s + Number(v.price_cents), 0);
  // Percent to three decimals as an integer of thousandths, so the product stays exact before the one rounding.
  const thousandths = Math.round(Number(plan.percent ?? 0) * 1000);
  const amount = Math.floor((basis * thousandths + 50_000) / 100_000);
  return { basis_cents: basis, amount_cents: amount };
}

export function releasableOn(plan: Pick<Plan, "hold_days">, earnedOn: string): string {
  return addDays(earnedOn, plan.hold_days);
}

/** Rule 5: a held commission releases once its hold days have passed and enough of the agreement's invoices are paid. */
export function shouldRelease(c: { status: string; releasable_on: string }, plan: Pick<Plan, "hold_paid_invoices">, today: string, paidInvoices: number): boolean {
  return c.status === "held" && today >= c.releasable_on && paidInvoices >= plan.hold_paid_invoices;
}

/** Rule 6: an agreement cancelled within the chargeback days of signing charges back what it earned. */
export function shouldChargeBack(c: { status: string }, plan: Pick<Plan, "chargeback_days">, signedOn: string, cancelledOn: string | null): boolean {
  if (!cancelledOn || c.status === "charged_back") return false;
  return cancelledOn <= addDays(signedOn, plan.chargeback_days);
}
