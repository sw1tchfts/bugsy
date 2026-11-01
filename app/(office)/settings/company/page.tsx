import type { Metadata } from "next";
import { Button, Card, Field, Input, Notice, errorMessage } from "@/components/ui";
import { can, isOwnerRole } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { saveCompanyDetails } from "./actions";

export const metadata: Metadata = { title: "Company details" };

export default async function CompanyPage({ searchParams }: { searchParams: Promise<{ note?: string; error?: string }> }) {
  const { active } = await requireActiveTenant();
  const { session } = await requirePermission(active.tenantId, "settings.read");
  const { note, error } = await searchParams;
  const [t] = await dbAs(session, (tx) => tx<{ name: string; legal_name: string | null; timezone: string; status: string }[]>`select name, legal_name, timezone, status from public.tenants where id = ${active.tenantId}`);
  const writable = can(active.permissions, "settings.write") && t.status === "active";

  return (
    <>
      <h1 className="text-2xl font-semibold">Company details</h1>
      {note ? <Notice kind="success">Saved.</Notice> : null}
      {errorMessage(error) ? <Notice kind="error">{errorMessage(error)}</Notice> : null}
      <Card title="Names" description="The legal name prints on invoices, statements and notices. The time zone sets business dates; ask support to change it.">
        <form action={saveCompanyDetails} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="tenant_id" value={active.tenantId} />
          <Field label="Company name" htmlFor="company-name">
            <Input id="company-name" name="name" defaultValue={t.name} required maxLength={120} disabled={!writable} />
          </Field>
          <Field label="Legal name" htmlFor="company-legal">
            <Input id="company-legal" name="legal_name" defaultValue={t.legal_name ?? ""} maxLength={160} disabled={!writable} />
          </Field>
          <p className="text-sm text-stone-600">Time zone: {t.timezone}</p>
          {writable ? (
            <div className="sm:col-span-2">
              <Button type="submit">Save</Button>
            </div>
          ) : null}
        </form>
      </Card>
      {isOwnerRole(active.permissions) && !active.support ? (
        <Card title="Your data" description="Every table as a spreadsheet, with every photo, signature and document. Yours to take at any time, including after the company leaves Bugsy.">
          <a href="/api/company/export.zip" className="text-sm text-emerald-800 underline" data-testid="company-export">
            Download all company data
          </a>
        </Card>
      ) : null}
    </>
  );
}
