// Picks the gateway for a company: Stripe once keys exist and the owner connected, the local gateway otherwise.
import type { PaymentGateway } from "@/lib/payments/gateway";
import { localGateway } from "@/lib/payments/local";
import { stripeConfigured, stripeGateway } from "@/lib/payments/stripe";

export function gatewayFor(settings: { gateway: string } | null | undefined): PaymentGateway {
  return settings?.gateway === "stripe" && stripeConfigured() ? stripeGateway : localGateway;
}

/** What a card form needs to know: the gateway, and for Stripe the publishable key and the company's connected account. */
export function cardEntry(settings: { gateway: string; gateway_account_id: string | null } | null | undefined): {
  gateway: "local" | "stripe";
  publishableKey: string | null;
  stripeAccount: string | null;
} {
  const gateway = gatewayFor(settings).kind;
  if (gateway !== "stripe") return { gateway, publishableKey: null, stripeAccount: null };
  return { gateway, publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null, stripeAccount: settings?.gateway_account_id ?? null };
}
