import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { postPayment, postPayout, tenantTimeZone } from "@/lib/ledger/db";
import { stripeConfigured, stripeGateway, stripePayoutDetails } from "@/lib/payments/stripe";

export const dynamic = "force-dynamic";

/**
 * Stripe's webhook (spec 08 rule 13): every event is recorded once by its id, then applied idempotently. Payment
 * outcomes update the payment row the charge created; account updates mark onboarding done. The local gateway never
 * calls this. No user signs these requests, so it uses the privileged connection like the jobs (CLAUDE.md).
 */
export async function POST(request: Request) {
  if (!stripeConfigured()) return new NextResponse("stripe is not configured", { status: 404 });
  const raw = await request.text();
  let event;
  try {
    event = await stripeGateway.parseWebhook(raw, request.headers.get("stripe-signature"));
  } catch (err) {
    console.error("webhook signature failed", err);
    return new NextResponse("bad signature", { status: 400 });
  }
  if (!event) return new NextResponse("no event", { status: 400 });
  const inserted = await sql`insert into public.gateway_events (gateway, event_id, type, payload) values ('stripe', ${event.event_id}, ${event.type}, ${sql.json(event.data)}) on conflict (gateway, event_id) do nothing`;
  if (inserted.count === 0) return NextResponse.json({ ok: true, duplicate: true });

  const object = event.data as { id?: string; status?: string; last_payment_error?: { code?: string }; charges_enabled?: boolean; details_submitted?: boolean };
  if (event.type === "payment_intent.succeeded" || event.type === "payment_intent.payment_failed" || event.type === "payment_intent.processing") {
    const status = event.type === "payment_intent.succeeded" ? "succeeded" : event.type === "payment_intent.processing" ? "pending" : "failed";
    const [payment] = await sql<{ id: string; tenant_id: string }[]>`
      update public.payments set status = ${status}, failure_reason = ${status === "failed" ? (object.last_payment_error?.code ?? "payment_failed") : null}
      where gateway = 'stripe' and gateway_payment_id = ${object.id ?? ""} and status <> 'refunded' returning id, tenant_id`;
    if (payment) await sql`update public.gateway_events set tenant_id = ${payment.tenant_id} where gateway = 'stripe' and event_id = ${event.event_id}`;
    if (payment && status === "succeeded") await postPayment(sql, payment.tenant_id, payment.id, await tenantTimeZone(sql, payment.tenant_id));
  } else if (event.type === "payout.paid" && object.id && event.account) {
    // The payout settles clearing into the bank, fees apart (spec 09 rule 6); the payments it carried point at it.
    const [settings] = await sql<{ tenant_id: string }[]>`select tenant_id from public.billing_settings where gateway = 'stripe' and gateway_account_id = ${event.account}`;
    if (settings) {
      const payout = object as { id: string; arrival_date?: number };
      const details = await stripePayoutDetails(event.account, payout.id);
      const arrivedOn = new Date((payout.arrival_date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString().slice(0, 10);
      const [row] = await sql<{ id: string }[]>`
        insert into public.payouts (tenant_id, gateway, gateway_payout_id, arrived_on, gross_cents, fee_cents, net_cents, status, payload)
        values (${settings.tenant_id}, 'stripe', ${payout.id}, ${arrivedOn}, ${details.gross_cents}, ${details.fee_cents}, ${details.net_cents}, 'paid', ${sql.json(event.data as never)})
        on conflict (gateway, gateway_payout_id) do nothing returning id`;
      const payoutId = row?.id ?? (await sql<{ id: string }[]>`select id from public.payouts where gateway = 'stripe' and gateway_payout_id = ${payout.id}`)[0]?.id;
      if (payoutId) {
        if (details.payment_intent_ids.length) {
          await sql`update public.payments set payout_id = ${payoutId} where tenant_id = ${settings.tenant_id} and gateway = 'stripe' and gateway_payment_id = any(${details.payment_intent_ids}::text[]) and payout_id is null`;
        }
        await postPayout(sql, settings.tenant_id, payoutId);
      }
      await sql`update public.gateway_events set tenant_id = ${settings.tenant_id} where gateway = 'stripe' and event_id = ${event.event_id}`;
    }
  } else if (event.type === "account.updated" && object.id) {
    const [settings] = await sql<{ tenant_id: string }[]>`
      update public.billing_settings set gateway_onboarded_at = case when ${Boolean(object.charges_enabled)} then coalesce(gateway_onboarded_at, now()) else gateway_onboarded_at end
      where gateway = 'stripe' and gateway_account_id = ${object.id} returning tenant_id`;
    if (settings) await sql`update public.gateway_events set tenant_id = ${settings.tenant_id} where gateway = 'stripe' and event_id = ${event.event_id}`;
  } else {
    console.log("webhook stored, not applied", event.type);
  }
  return NextResponse.json({ ok: true });
}
