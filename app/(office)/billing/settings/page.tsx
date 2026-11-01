import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Field, Input, Notice, Textarea, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { loadSettings } from "@/lib/billing/db";
import { formatInstant } from "@/lib/dates";
import { stripeConfigured } from "@/lib/payments/stripe";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { connectGateway, saveBillingSettings } from "../actions";

export const metadata: Metadata = { title: "Billing settings" };

export default async function BillingSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "billing.read");
  const { error } = await searchParams;
  const tenantId = active.tenantId;
  const canWrite = can(active.permissions, "billing.write");
  const settings = await dbAs(session, (tx) => loadSettings(tx, tenantId));
  const stripe = stripeConfigured();

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/billing" className="hover:underline">
          Billing
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Billing settings</h1>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      <Card title="Collections" description="Late fees are their own invoices, issued once per past-due invoice. The hold stops dispatch from scheduling a past-due account.">
        <form action={saveBillingSettings} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="tenant_id" value={tenantId} />
          <Field label="Late fee ($)" htmlFor="late-fee">
            <Input id="late-fee" name="late_fee" inputMode="decimal" defaultValue={(settings.late_fee_cents / 100).toFixed(2)} disabled={!canWrite} />
          </Field>
          <Field label="Late fee (% of the open balance)" htmlFor="late-pct">
            <Input id="late-pct" name="late_fee_percent" inputMode="decimal" defaultValue={settings.late_fee_percent} disabled={!canWrite} />
          </Field>
          <Field label="Grace days after the due date" htmlFor="grace">
            <Input id="grace" name="grace_days" inputMode="numeric" defaultValue={settings.grace_days} disabled={!canWrite} />
          </Field>
          <Field label="Autopay retry days after each failure" htmlFor="retry" hint="Comma separated; one retry per entry.">
            <Input id="retry" name="retry_days" defaultValue={settings.autopay_retry_days.join(", ")} disabled={!canWrite} />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="pause_when_past_due" value="true" defaultChecked={settings.pause_when_past_due} disabled={!canWrite} /> Hold service while an account is past due (dispatch refuses to schedule it)
          </label>
          <div className="sm:col-span-2">
            <Field label="Invoice footer" htmlFor="footer">
              <Textarea id="footer" name="invoice_footer" rows={2} defaultValue={settings.invoice_footer ?? ""} disabled={!canWrite} />
            </Field>
          </div>
          {canWrite ? (
            <div className="sm:col-span-2">
              <Button type="submit">Save settings</Button>
            </div>
          ) : null}
        </form>
      </Card>

      <Card title="Payment gateway" description="One connected account per company; money goes to you. Card and bank details are tokenized by the gateway and never stored here.">
        <p className="text-sm">
          Gateway: <Badge tone={settings.gateway === "stripe" ? "good" : "neutral"}>{settings.gateway === "stripe" ? "Stripe Connect" : "local"}</Badge>{" "}
          {settings.gateway_account_id ? <span className="font-mono text-xs">{settings.gateway_account_id}</span> : "not connected"}
          {settings.gateway_onboarded_at ? ` (connected ${formatInstant(settings.gateway_onboarded_at, active.tenantTimezone)})` : ""}
        </p>
        <p className="mt-1 text-xs text-stone-600">
          {stripe ? "Stripe keys are configured: connecting opens Stripe's onboarding." : "No Stripe keys in this environment: the local gateway runs the same flows without the network. Cards ending 0002 decline, 0341 fail the first autopay attempt."}
        </p>
        {canWrite ? (
          <form action={connectGateway} className="mt-3">
            <input type="hidden" name="tenant_id" value={tenantId} />
            <Button type="submit" variant="secondary">
              {settings.gateway_account_id ? "Reconnect" : "Connect"} {stripe ? "Stripe" : "local gateway"}
            </Button>
          </form>
        ) : null}
      </Card>
    </>
  );
}
