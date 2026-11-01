// Picks the gateway for a company: Stripe once keys exist and the owner connected, the local gateway otherwise.
import type { PaymentGateway } from "@/lib/payments/gateway";
import { localGateway } from "@/lib/payments/local";
import { stripeConfigured, stripeGateway } from "@/lib/payments/stripe";

export function gatewayFor(settings: { gateway: string } | null | undefined): PaymentGateway {
  return settings?.gateway === "stripe" && stripeConfigured() ? stripeGateway : localGateway;
}
