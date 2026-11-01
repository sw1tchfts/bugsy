import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Empty, Field, Input, Notice, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { addDays, formatBusinessDate, todayInZone } from "@/lib/dates";
import { listMembers } from "@/lib/dispatch/db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { saveBranchLicense } from "../actions";

export const metadata: Metadata = { title: "Branch licenses" };

type Branch = { id: string; name: string; state_code: string; business_license_number: string | null; license_year: number | null; license_expires_on: string | null };
type Credential = { user_id: string; state_code: string; cert_number: string | null; categories: string[]; cert_expires_on: string | null; trainee_registered_on: string | null };

export default async function LicensesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "compliance.read");
  const { error } = await searchParams;
  const tenantId = active.tenantId;
  const canWrite = can(active.permissions, "compliance.write");
  const today = todayInZone(active.tenantTimezone);
  const soon = addDays(today, 60);

  const { branches, credentials, members } = await dbAs(session, async (tx) => ({
    branches: await tx<Branch[]>`select id, name, state_code, business_license_number, license_year, license_expires_on from public.branches where tenant_id = ${tenantId} and archived_at is null order by name`,
    credentials: await tx<Credential[]>`select user_id, state_code, cert_number, categories, cert_expires_on, trainee_registered_on from public.applicator_credentials where tenant_id = ${tenantId} and archived_at is null order by user_id`,
    members: await listMembers(tx, tenantId),
  }));
  const nameOf = (id: string) => members.find((m) => m.user_id === id)?.name ?? "Unknown member";

  const badge = (date: string | null) => {
    if (!date) return <Badge tone="warn">no license on file</Badge>;
    if (date < today) return <Badge tone="bad">expired {formatBusinessDate(date)}</Badge>;
    if (date <= soon) return <Badge tone="warn">expires {formatBusinessDate(date)}</Badge>;
    return <Badge tone="good">to {formatBusinessDate(date)}</Badge>;
  };

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/compliance" className="hover:underline">
          Compliance
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Branch licenses</h1>
      <p className="text-sm text-stone-600">
        The business license each location holds where the state requires one, and the people licensed to apply in that state. Whether a state licenses each location comes from its pack; until then an expired license blocks dispatch and a missing one is a warning.
      </p>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}
      {branches.length === 0 ? <Empty>No branches.</Empty> : null}
      {branches.map((b) => {
        const roster = credentials.filter((c) => c.state_code === b.state_code);
        return (
          <Card key={b.id} title={`${b.name} (${b.state_code})`} actions={badge(b.license_expires_on)}>
            {canWrite ? (
              <form action={saveBranchLicense} className="grid gap-3 sm:grid-cols-4" data-testid={`branch-license-${b.id}`}>
                <input type="hidden" name="tenant_id" value={tenantId} />
                <input type="hidden" name="branch_id" value={b.id} />
                <Field label="Business license number" htmlFor={`lic-${b.id}-number`}>
                  <Input id={`lic-${b.id}-number`} name="business_license_number" defaultValue={b.business_license_number ?? ""} />
                </Field>
                <Field label="License year" htmlFor={`lic-${b.id}-year`}>
                  <Input id={`lic-${b.id}-year`} name="license_year" inputMode="numeric" defaultValue={b.license_year ?? ""} />
                </Field>
                <Field label="Expires on" htmlFor={`lic-${b.id}-expires`}>
                  <Input id={`lic-${b.id}-expires`} name="license_expires_on" type="date" defaultValue={b.license_expires_on ?? ""} />
                </Field>
                <div className="self-end">
                  <Button type="submit" variant="secondary">
                    Save license
                  </Button>
                </div>
              </form>
            ) : (
              <p className="text-sm">
                {b.business_license_number ? `License ${b.business_license_number}` : "No license number"}
                {b.license_year ? `, ${b.license_year}` : ""}
              </p>
            )}
            <h3 className="mt-4 text-sm font-semibold">Licensed roster in {b.state_code}</h3>
            {roster.length === 0 ? (
              <p className="text-sm text-stone-500">Nobody holds a credential in this state.</p>
            ) : (
              <ul className="mt-1 grid gap-1 text-sm">
                {roster.map((c) => (
                  <li key={`${c.user_id}-${c.state_code}`}>
                    {nameOf(c.user_id)}: {c.trainee_registered_on ? `trainee since ${formatBusinessDate(c.trainee_registered_on)}` : `${c.cert_number ?? "no number"} (${c.categories.join(", ") || "no categories"})`}
                    {c.cert_expires_on ? `, certification to ${formatBusinessDate(c.cert_expires_on)}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </>
  );
}
