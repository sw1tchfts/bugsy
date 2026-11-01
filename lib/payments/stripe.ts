// Stripe Connect behind the gateway interface (spec 08 rule 13): Standard connected accounts, direct charges on the
// connected account, a platform fee of zero until the platform sets one, idempotency keys on every write, webhooks
// verified with the signing secret. Card and bank details never pass through here: Stripe tokenizes them.
import Stripe from "stripe";
import type { AccountStatus, ChargeInput, ChargeResult, ConnectedAccount, GatewayEvent, PaymentGateway, RefundResult, SavedMethod } from "@/lib/payments/gateway";

let client: Stripe | null = null;

export function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  client ??= new Stripe(key);
  return client;
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

const onAccount = (account_id: string | null): Stripe.RequestOptions => (account_id ? { stripeAccount: account_id } : {});

function toMethod(pm: Stripe.PaymentMethod): SavedMethod {
  if (pm.type === "us_bank_account" && pm.us_bank_account) {
    return { gateway_payment_method_id: pm.id, kind: "us_bank_account", brand: pm.us_bank_account.bank_name ?? "Bank account", last4: pm.us_bank_account.last4 ?? "0000", exp_month: null, exp_year: null };
  }
  return {
    gateway_payment_method_id: pm.id,
    kind: "card",
    brand: pm.card?.brand ?? null,
    last4: pm.card?.last4 ?? "0000",
    exp_month: pm.card?.exp_month ?? null,
    exp_year: pm.card?.exp_year ?? null,
  };
}

export const stripeGateway: PaymentGateway = {
  kind: "stripe",

  async connectAccount(tenant): Promise<ConnectedAccount> {
    const stripe = stripeClient();
    const account = await stripe.accounts.create({ type: "standard", email: tenant.email ?? undefined, business_profile: { name: tenant.name }, metadata: { tenant_id: tenant.id } });
    const link = await stripe.accountLinks.create({ account: account.id, type: "account_onboarding", return_url: tenant.return_url, refresh_url: tenant.refresh_url });
    return { account_id: account.id, onboarding_url: link.url };
  },

  async accountStatus(account_id): Promise<AccountStatus> {
    const account = await stripeClient().accounts.retrieve(account_id);
    return { charges_enabled: Boolean(account.charges_enabled), details_submitted: Boolean(account.details_submitted) };
  },

  async ensureCustomer(input): Promise<string> {
    if (input.existing_customer_id) return input.existing_customer_id;
    const customer = await stripeClient().customers.create({ name: input.name, email: input.email ?? undefined }, onAccount(input.account_id));
    return customer.id;
  },

  async savePaymentMethod(input): Promise<SavedMethod> {
    const stripe = stripeClient();
    const pm = await stripe.paymentMethods.attach(input.token, { customer: input.customer_id }, onAccount(input.account_id));
    return toMethod(pm);
  },

  async detachPaymentMethod(input): Promise<void> {
    await stripeClient().paymentMethods.detach(input.gateway_payment_method_id, undefined, onAccount(input.account_id));
  },

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const stripe = stripeClient();
    const fee = input.platform_fee_bps ? Math.floor((input.amount_cents * input.platform_fee_bps) / 10_000) : 0;
    try {
      const intent = await stripe.paymentIntents.create(
        {
          amount: input.amount_cents,
          currency: input.currency ?? "usd",
          customer: input.customer_id,
          payment_method: input.payment_method_id,
          off_session: true,
          confirm: true,
          description: input.description,
          ...(fee > 0 ? { application_fee_amount: fee } : {}),
        },
        { ...onAccount(input.account_id), idempotencyKey: input.idempotency_key },
      );
      const status = intent.status === "succeeded" ? "succeeded" : intent.status === "processing" ? "pending" : "failed";
      return { gateway_payment_id: intent.id, status, failure_reason: status === "failed" ? (intent.last_payment_error?.code ?? intent.status) : null };
    } catch (err) {
      const e = err as { code?: string; payment_intent?: { id?: string }; message?: string };
      return { gateway_payment_id: e.payment_intent?.id ?? `failed_${input.idempotency_key}`, status: "failed", failure_reason: e.code ?? e.message ?? "charge_failed" };
    }
  },

  async refund(input): Promise<RefundResult> {
    try {
      const refund = await stripeClient().refunds.create({ payment_intent: input.gateway_payment_id, amount: input.amount_cents }, { ...onAccount(input.account_id), idempotencyKey: input.idempotency_key });
      return { gateway_refund_id: refund.id, status: refund.status === "succeeded" ? "succeeded" : refund.status === "pending" ? "pending" : "failed", failure_reason: refund.failure_reason ?? null };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      return { gateway_refund_id: `failed_${input.idempotency_key}`, status: "failed", failure_reason: e.code ?? e.message ?? "refund_failed" };
    }
  },

  async parseWebhook(rawBody, signature): Promise<GatewayEvent | null> {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret || !signature) return null;
    const event = stripeClient().webhooks.constructEvent(rawBody, signature, secret);
    return { event_id: event.id, type: event.type, data: event.data.object as unknown as Record<string, unknown> };
  },
};
