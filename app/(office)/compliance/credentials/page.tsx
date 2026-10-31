import type { Metadata } from "next";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Textarea, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { addDays, formatBusinessDate, todayInZone } from "@/lib/dates";
import { listMembers } from "@/lib/dispatch/db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { archiveCredential, saveCredential } from "./actions";

export const metadata: Metadata = { title: "Credentials" };

type Credential = {
  id: string;
  user_id: string;
  state_code: string;
  cert_number: string | null;
  categories: string[];
  cert_expires_on: string | null;
  license_number: string | null;
  license_expires_on: string | null;
  license_year: number | null;
  trainee_registered_on: string | null;
  supervisor_id: string | null;
  notes: string | null;
};

export default async function CredentialsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  const { error } = await searchParams;
  const tenantId = active.tenantId;
  const canWrite = can(active.permissions, "compliance.write");
  const today = todayInZone(active.tenantTimezone);
  const soon = addDays(today, 60);

  const { credentials, members } = await dbAs(session, async (tx) => {
    const credentials = await tx<Credential[]>`
      select id, user_id, state_code, cert_number, categories, cert_expires_on, license_number, license_expires_on, license_year, trainee_registered_on, supervisor_id, notes
      from public.applicator_credentials where tenant_id = ${tenantId} and archived_at is null order by state_code, user_id`;
    const members = await listMembers(tx, tenantId);
    return { credentials, members };
  });
  const nameOf = (id: string | null) => (id ? (members.find((m) => m.user_id === id)?.name ?? "Unknown member") : "");

  const expiryBadge = (date: string | null) => {
    if (!date) return <Badge>no expiry</Badge>;
    if (date < today) return <Badge tone="bad">expired {formatBusinessDate(date)}</Badge>;
    if (date <= soon) return <Badge tone="warn">expires {formatBusinessDate(date)}</Badge>;
    return <Badge tone="good">to {formatBusinessDate(date)}</Badge>;
  };

  const fields = (prefix: string, c?: Credential) => (
    <>
      <Field label="Person" htmlFor={`${prefix}-user`}>
        <Select id={`${prefix}-user`} name="user_id" defaultValue={c?.user_id ?? ""} required>
          <option value="" disabled>
            Pick a person
          </option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="State" htmlFor={`${prefix}-state`}>
        <Input id={`${prefix}-state`} name="state_code" required maxLength={2} pattern="[A-Za-z]{2}" defaultValue={c?.state_code ?? ""} className="w-20" />
      </Field>
      <Field label="Certification number" htmlFor={`${prefix}-cert`}>
        <Input id={`${prefix}-cert`} name="cert_number" defaultValue={c?.cert_number ?? ""} />
      </Field>
      <Field label="Categories" htmlFor={`${prefix}-cats`} hint="As the state writes them, comma separated.">
        <Input id={`${prefix}-cats`} name="categories" defaultValue={c?.categories.join(", ") ?? ""} />
      </Field>
      <Field label="Certification expires" htmlFor={`${prefix}-cert-exp`}>
        <Input id={`${prefix}-cert-exp`} name="cert_expires_on" type="date" defaultValue={c?.cert_expires_on ?? ""} />
      </Field>
      <Field label="License number" htmlFor={`${prefix}-lic`}>
        <Input id={`${prefix}-lic`} name="license_number" defaultValue={c?.license_number ?? ""} />
      </Field>
      <Field label="License expires" htmlFor={`${prefix}-lic-exp`}>
        <Input id={`${prefix}-lic-exp`} name="license_expires_on" type="date" defaultValue={c?.license_expires_on ?? ""} />
      </Field>
      <Field label="License year" htmlFor={`${prefix}-year`}>
        <Input id={`${prefix}-year`} name="license_year" type="number" min={2000} max={2100} defaultValue={c?.license_year ?? ""} />
      </Field>
      <Field label="Trainee registered on" htmlFor={`${prefix}-trainee`} hint="Set for a registered trainee; leave blank for a certified applicator.">
        <Input id={`${prefix}-trainee`} name="trainee_registered_on" type="date" defaultValue={c?.trainee_registered_on ?? ""} />
      </Field>
      <Field label="Supervisor" htmlFor={`${prefix}-sup`}>
        <Select id={`${prefix}-sup`} name="supervisor_id" defaultValue={c?.supervisor_id ?? ""}>
          <option value="">None</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Field label="Notes" htmlFor={`${prefix}-notes`}>
          <Textarea id={`${prefix}-notes`} name="notes" rows={2} defaultValue={c?.notes ?? ""} />
        </Field>
      </div>
    </>
  );

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Applicator credentials</h1>
        <p className="mt-1 text-sm text-stone-600">
          One row per person per state: certification, categories, license and trainee status. Dispatch refuses work a technician is not credentialed for in the property&apos;s state. Expiry alerts and renewal tasks arrive with compliance (spec 07).
        </p>
      </div>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      <Card title="Credentials on file">
        {credentials.length === 0 ? (
          <Empty>No credentials yet.</Empty>
        ) : (
          <div className="grid gap-6">
            {credentials.map((c) =>
              canWrite ? (
                <form key={c.id} action={saveCredential} className="grid gap-4 border-b border-stone-200 pb-6 last:border-0 last:pb-0 sm:grid-cols-2">
                  <input type="hidden" name="tenant_id" value={tenantId} />
                  <input type="hidden" name="credential_id" value={c.id} />
                  <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                    <span className="font-medium">{nameOf(c.user_id)}</span>
                    <Badge>{c.state_code}</Badge>
                    {c.trainee_registered_on ? <Badge tone="warn">trainee since {formatBusinessDate(c.trainee_registered_on)}</Badge> : expiryBadge(c.cert_expires_on)}
                    {c.license_expires_on && c.license_expires_on < today ? <Badge tone="bad">license expired</Badge> : null}
                  </div>
                  {fields(`c-${c.id}`, c)}
                  <div className="flex gap-3 sm:col-span-2">
                    <Button type="submit" variant="secondary">
                      Save
                    </Button>
                    <Button type="submit" variant="danger" formAction={archiveCredential}>
                      Archive
                    </Button>
                  </div>
                </form>
              ) : (
                <div key={c.id} className="flex flex-wrap items-center gap-2 border-b border-stone-200 pb-3 text-sm last:border-0">
                  <span className="font-medium">{nameOf(c.user_id)}</span>
                  <Badge>{c.state_code}</Badge>
                  <span>{c.cert_number ? `cert ${c.cert_number}` : "trainee"}</span>
                  <span>{c.categories.join(", ")}</span>
                  {expiryBadge(c.cert_expires_on)}
                </div>
              ),
            )}
          </div>
        )}
      </Card>

      {canWrite ? (
        <Card title="Add a credential">
          <form action={saveCredential} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="tenant_id" value={tenantId} />
            {fields("new")}
            <div>
              <Button type="submit">Add credential</Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
