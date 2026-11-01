"use client";

// Card entry for every form that saves a card (spec 08, spec 16 rule 3, spec 17 rule 3). With Stripe the card goes
// into Stripe's own field and the browser exchanges it for a payment method id before the form is sent, so the number
// never reaches this server. The local test gateway shows plain fields and treats the digits as its token.
import { useEffect, useRef, useState } from "react";
import { Field, Input, Select } from "@/components/ui";

type StripeElement = { mount: (el: HTMLElement) => void; destroy: () => void };
type StripeLike = {
  elements: () => { create: (type: "card", options?: Record<string, unknown>) => StripeElement };
  createPaymentMethod: (input: { type: "card"; card: StripeElement }) => Promise<{ paymentMethod?: { id: string }; error?: { message?: string } }>;
};
declare global {
  interface Window {
    Stripe?: (key: string, options?: { stripeAccount?: string }) => StripeLike;
  }
}

const box = "w-full rounded border border-stone-300 bg-white px-2.5 py-2 text-sm";

function loadStripe(): Promise<void> {
  if (window.Stripe) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://js.stripe.com/v3/";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Stripe.js did not load"));
    document.head.appendChild(s);
  });
}

export type PaymentFieldsProps = {
  gateway: "local" | "stripe";
  publishableKey: string | null;
  /** The company's connected account: payment methods are made on it, where the charges happen. */
  stripeAccount: string | null;
  idPrefix: string;
  /** Field names, so forms with older names keep working. */
  names?: { number?: string; month?: string; year?: string; token?: string; kind?: string };
  required?: boolean;
  /** The local gateway also takes a bank account number (the office form). */
  allowBank?: boolean;
};

export function PaymentFields({ gateway, publishableKey, stripeAccount, idPrefix, names = {}, required = false, allowBank = false }: PaymentFieldsProps) {
  const n = { number: "number", month: "exp_month", year: "exp_year", token: "payment_token", kind: "kind", ...names };
  const host = useRef<HTMLDivElement>(null);
  const tokenRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState("card");

  useEffect(() => {
    if (gateway !== "stripe" || !publishableKey || !host.current) return;
    let card: StripeElement | null = null;
    let stripe: StripeLike | null = null;
    let cancelled = false;
    const form = host.current.closest("form");
    const onSubmit = async (e: SubmitEvent) => {
      const tokenInput = tokenRef.current;
      if (!tokenInput || tokenInput.value || !stripe || !card) return;
      // Hold the submission until Stripe answers; the form is sent again with the payment method id.
      e.preventDefault();
      e.stopImmediatePropagation();
      const submitter = e.submitter as HTMLElement | null;
      const { paymentMethod, error: err } = await stripe.createPaymentMethod({ type: "card", card });
      if (err || !paymentMethod) {
        if (required) setError(err?.message ?? "The card could not be read.");
        else form?.requestSubmit(submitter as HTMLButtonElement | null);
        return;
      }
      tokenInput.value = paymentMethod.id;
      form?.requestSubmit(submitter as HTMLButtonElement | null);
    };
    loadStripe()
      .then(() => {
        if (cancelled || !host.current || !window.Stripe) return;
        stripe = window.Stripe(publishableKey, stripeAccount ? { stripeAccount } : undefined);
        card = stripe.elements().create("card", { hidePostalCode: false });
        card.mount(host.current);
        form?.addEventListener("submit", onSubmit, { capture: true });
      })
      .catch(() => setError("Card entry could not load. Check the connection and reload."));
    return () => {
      cancelled = true;
      form?.removeEventListener("submit", onSubmit, { capture: true });
      card?.destroy();
    };
  }, [gateway, publishableKey, stripeAccount, required]);

  if (gateway === "stripe") {
    if (!publishableKey) return <p className="text-sm text-red-700">Card entry is not set up for this site yet.</p>;
    return (
      <div className="col-span-full grid gap-1">
        <span className="text-sm font-medium text-stone-700">Card</span>
        <div ref={host} className={`${box} min-h-[2.4rem]`} data-testid={`${idPrefix}-stripe-card`} />
        <input ref={tokenRef} type="hidden" name={n.token} defaultValue="" />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <p className="text-xs text-stone-500">Entered into the payment processor&apos;s secure field; only the brand, last four digits and expiry are kept.</p>
      </div>
    );
  }
  return (
    <>
      {allowBank ? (
        <Field label="Kind" htmlFor={`${idPrefix}-kind`}>
          <Select id={`${idPrefix}-kind`} name={n.kind} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="card">Card</option>
            <option value="bank">Bank account</option>
          </Select>
        </Field>
      ) : null}
      <Field label={kind === "bank" ? "Account number" : "Card number"} htmlFor={`${idPrefix}-number`} hint="Handed to the gateway, never stored.">
        <Input id={`${idPrefix}-number`} name={n.number} inputMode="numeric" autoComplete="off" required={required} />
      </Field>
      {kind === "bank" ? null : (
        <>
          <Field label="Month" htmlFor={`${idPrefix}-month`}>
            <Input id={`${idPrefix}-month`} name={n.month} inputMode="numeric" placeholder="MM" required={required} />
          </Field>
          <Field label="Year" htmlFor={`${idPrefix}-year`}>
            <Input id={`${idPrefix}-year`} name={n.year} inputMode="numeric" placeholder="YYYY" required={required} />
          </Field>
        </>
      )}
    </>
  );
}
