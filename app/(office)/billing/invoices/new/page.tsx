import type { Metadata } from "next";
import Link from "next/link";
import { Button, Card, Field, Input, Notice, Select, Textarea, errorMessage } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { createManualInvoice } from "../../actions";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ error?: string; account?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "billing.write");
  const { error, account } = await searchParams;
  const tenantId = active.tenantId;
  const data = await dbAs(session, async (tx) => ({
    accounts: await tx<{ id: string; name: string; po_required: boolean }[]>`select id, name, po_required from public.accounts where tenant_id = ${tenantId} and archived_at is null and status = 'active' order by name limit 500`,
    properties: await tx<{ id: string; account_id: string; normalized_address: string }[]>`select id, account_id, normalized_address from public.properties where tenant_id = ${tenantId} and archived_at is null order by normalized_address limit 1000`,
    serviceTypes: await tx<{ id: string; name: string }[]>`select id, name from public.service_types where tenant_id = ${tenantId} and archived_at is null order by name`,
  }));

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/billing" className="hover:underline">
          Billing
        </Link>{" "}
        /{" "}
        <Link href="/billing/invoices" className="hover:underline">
          Invoices
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">One-off invoice</h1>
      <p className="text-sm text-stone-600">For a charge no agreement produces. Pick the service type when the charge is for pest control work, so the property&apos;s state decides its tax; leave it blank for a nontaxable charge.</p>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}
      <Card title="Charge">
        <form action={createManualInvoice} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="tenant_id" value={tenantId} />
          <Field label="Account" htmlFor="inv-account">
            <Select id="inv-account" name="account_id" defaultValue={account ?? data.accounts[0]?.id ?? ""} required>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.po_required ? " (PO required)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Property (optional, for tax)" htmlFor="inv-property">
            <Select id="inv-property" name="property_id" defaultValue="">
              <option value="">None</option>
              {data.properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.normalized_address}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Service type (optional)" htmlFor="inv-service">
            <Select id="inv-service" name="service_type_id" defaultValue="">
              <option value="">Not pest control work (no tax)</option>
              {data.serviceTypes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount ($)" htmlFor="inv-amount">
            <Input id="inv-amount" name="amount" inputMode="decimal" required />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description" htmlFor="inv-description">
              <Input id="inv-description" name="description" required />
            </Field>
          </div>
          <Field label="PO number" htmlFor="inv-po">
            <Input id="inv-po" name="po_number" />
          </Field>
          <Field label="Issued on" htmlFor="inv-issued" hint="Blank for today; an earlier date for a charge from before Bugsy.">
            <Input id="inv-issued" name="issued_on" type="date" />
          </Field>
          <Field label="Memo" htmlFor="inv-memo">
            <Textarea id="inv-memo" name="memo" rows={2} />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="issue" value="true" defaultChecked /> Issue now (otherwise it stays a draft)
          </label>
          <div className="sm:col-span-2">
            <Button type="submit">Create invoice</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
