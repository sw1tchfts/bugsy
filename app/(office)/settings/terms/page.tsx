import type { Metadata } from "next";
import { updateAgreementTerms } from "@/app/(office)/agreements/actions";
import { Button, Card, Field, Notice, Textarea, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

export const metadata: Metadata = { title: "Agreement terms" };

export default async function TermsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  const { error } = await searchParams;
  const canWrite = can(active.permissions, "settings.write");
  const [tenant] = await dbAs(session, (tx) => tx<{ agreement_terms: string | null }[]>`select agreement_terms from public.tenants where id = ${active.tenantId}`);

  return (
    <>
      <h1 className="text-2xl font-semibold">Agreement terms</h1>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}
      <Card title="Default terms" description="Copied onto every new agreement and shown to the customer when they sign. Each agreement can still carry its own text.">
        {canWrite ? (
          <form action={updateAgreementTerms} className="grid gap-4">
            <input type="hidden" name="tenant_id" value={active.tenantId} />
            <Field label="Terms" htmlFor="agreement_terms">
              <Textarea id="agreement_terms" name="agreement_terms" rows={10} defaultValue={tenant?.agreement_terms ?? ""} />
            </Field>
            <div>
              <Button type="submit">Save terms</Button>
            </div>
          </form>
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-sm text-stone-700">{tenant?.agreement_terms ?? "No terms set."}</pre>
        )}
      </Card>
    </>
  );
}
