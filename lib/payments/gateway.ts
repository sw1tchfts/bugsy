// The payment gateway behind one interface (spec 08 rule 13). Stripe Connect when keys exist and the owner connected;
// the local gateway otherwise, with the same shape, so every flow runs end to end with no keys. Card and bank details
// are tokenized by the gateway; the product stores brand, last four and expiry and nothing else.

export type GatewayKind = "local" | "stripe";

export type ConnectedAccount = { account_id: string; onboarding_url: string | null };
export type AccountStatus = { charges_enabled: boolean; details_submitted: boolean };

export type SavedMethod = {
  gateway_payment_method_id: string;
  kind: "card" | "us_bank_account";
  brand: string | null;
  last4: string;
  exp_month: number | null;
  exp_year: number | null;
};

export type ChargeInput = {
  account_id: string | null;
  customer_id: string;
  payment_method_id: string;
  /** The stored last four of the method; the local gateway reads its outcome from it, Stripe ignores it. */
  method_last4?: string | null;
  amount_cents: number;
  currency?: string;
  description: string;
  idempotency_key: string;
  /** Basis points the platform keeps; zero until the platform sets one. */
  platform_fee_bps?: number;
};

export type ChargeResult = { gateway_payment_id: string; status: "succeeded" | "pending" | "failed"; failure_reason: string | null };
export type RefundResult = { gateway_refund_id: string; status: "succeeded" | "pending" | "failed"; failure_reason: string | null };

export type GatewayEvent = { event_id: string; type: string; data: Record<string, unknown> };

export interface PaymentGateway {
  readonly kind: GatewayKind;
  /** Creates the tenant's connected account and the link to finish onboarding. */
  connectAccount(tenant: { id: string; name: string; email: string | null; return_url: string; refresh_url: string }): Promise<ConnectedAccount>;
  accountStatus(account_id: string): Promise<AccountStatus>;
  /** The gateway's customer for an account, created on first use. */
  ensureCustomer(input: { account_id: string | null; existing_customer_id: string | null; name: string; email: string | null }): Promise<string>;
  /** Saves a tokenized method on the customer. The token is whatever the gateway's own form produced; it is never stored. */
  savePaymentMethod(input: { account_id: string | null; customer_id: string; token: string }): Promise<SavedMethod>;
  detachPaymentMethod(input: { account_id: string | null; gateway_payment_method_id: string }): Promise<void>;
  charge(input: ChargeInput): Promise<ChargeResult>;
  refund(input: { account_id: string | null; gateway_payment_id: string; amount_cents: number; idempotency_key: string }): Promise<RefundResult>;
  /** Verifies and parses a webhook delivery; the local gateway never sends one. */
  parseWebhook(rawBody: string, signature: string | null): Promise<GatewayEvent | null>;
}

/** Bugsy's platform fee in basis points, zero unless the platform sets it (spec 08 decision). */
export function platformFeeBps(): number {
  const raw = Number(process.env.PLATFORM_FEE_BPS ?? "0");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}
