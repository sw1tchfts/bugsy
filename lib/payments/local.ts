// The local gateway: Stripe's shape with no network, for the local MVP and the tests. Ids are deterministic
// (`local_...`), the "token" is the digits typed into the office form and only its last four survive, and the outcome
// of a charge follows the card: ...0002 is declined, ...0341 fails the first autopay attempt and succeeds on the
// retry, everything else succeeds. Nothing here keeps card data.
import { createHash, randomUUID } from "node:crypto";
import type { AccountStatus, ChargeInput, ChargeResult, ConnectedAccount, GatewayEvent, PaymentGateway, RefundResult, SavedMethod } from "@/lib/payments/gateway";

const DECLINED = "0002";
const FAILS_FIRST = "0341";

function digits(token: string): string {
  return token.replace(/\D/g, "");
}

function brandFor(number: string): string {
  if (number.startsWith("4")) return "Visa";
  if (/^5[1-5]/.test(number) || /^2[2-7]/.test(number)) return "Mastercard";
  if (/^3[47]/.test(number)) return "American Express";
  if (number.startsWith("6")) return "Discover";
  return "Card";
}

/** What the local gateway pretends to keep on each charge when it pays out: a test convention, never Stripe's price. */
export const LOCAL_PAYOUT_FEE = { percent_bps: 290, fixed_cents: 30 } as const;

/** The fee on one charge, half up to the cent. */
export function localFeeCents(amountCents: number): number {
  if (amountCents <= 0) return 0;
  return Math.floor((amountCents * LOCAL_PAYOUT_FEE.percent_bps + 5000) / 10000) + LOCAL_PAYOUT_FEE.fixed_cents;
}

export const localGateway: PaymentGateway = {
  kind: "local",

  async connectAccount(tenant): Promise<ConnectedAccount> {
    return { account_id: `local_acct_${createHash("sha256").update(tenant.id).digest("hex").slice(0, 16)}`, onboarding_url: null };
  },

  async accountStatus(): Promise<AccountStatus> {
    return { charges_enabled: true, details_submitted: true };
  },

  async ensureCustomer(input): Promise<string> {
    return input.existing_customer_id ?? `local_cus_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  },

  async savePaymentMethod(input): Promise<SavedMethod> {
    // A token is "card:<digits>:<mm>:<yyyy>" from the office form or "bank:<digits>" for a bank account.
    const [kind, raw, mm, yyyy] = input.token.split(":");
    const number = digits(raw ?? "");
    if (number.length < 4) throw Object.assign(new Error("the card or account number is too short"), { code: "23514" });
    const last4 = number.slice(-4);
    const id = `local_pm_${createHash("sha256").update(`${input.customer_id}:${number}`).digest("hex").slice(0, 20)}`;
    if (kind === "bank") return { gateway_payment_method_id: id, kind: "us_bank_account", brand: "Bank account", last4, exp_month: null, exp_year: null };
    const exp_month = Number(mm);
    const exp_year = Number(yyyy);
    return {
      gateway_payment_method_id: id,
      kind: "card",
      brand: brandFor(number),
      last4,
      exp_month: Number.isInteger(exp_month) && exp_month >= 1 && exp_month <= 12 ? exp_month : null,
      exp_year: Number.isInteger(exp_year) && exp_year >= 2000 ? exp_year : null,
    };
  },

  async detachPaymentMethod(): Promise<void> {
    return;
  },

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const last4 = input.method_last4 ?? "";
    const id = `local_pi_${createHash("sha256").update(input.idempotency_key).digest("hex").slice(0, 20)}`;
    if (last4 === DECLINED) return { gateway_payment_id: id, status: "failed", failure_reason: "card_declined" };
    if (last4 === FAILS_FIRST && /:1$/.test(input.idempotency_key)) return { gateway_payment_id: id, status: "failed", failure_reason: "insufficient_funds" };
    return { gateway_payment_id: id, status: "succeeded", failure_reason: null };
  },

  async refund(input): Promise<RefundResult> {
    return { gateway_refund_id: `local_re_${createHash("sha256").update(input.idempotency_key).digest("hex").slice(0, 20)}`, status: "succeeded", failure_reason: null };
  },

  async parseWebhook(): Promise<GatewayEvent | null> {
    return null;
  },
};
