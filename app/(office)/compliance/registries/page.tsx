import type { Metadata } from "next";
import Link from "next/link";
import { Button, Card, Empty, Field, Input, Notice, Table, Textarea, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { formatInstant, todayInZone } from "@/lib/dates";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { importRegistry, rematchRegistry } from "../actions";

export const metadata: Metadata = { title: "Notification registries" };

type Set = { state_code: string; registry_kind: string; registry_year: number; rows: number; imported_at: string };
type Match = { id: string; account_id: string; address: string; state_code: string; matches: number };

export default async function RegistriesPage({ searchParams }: { searchParams: Promise<{ error?: string; note?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "compliance.read");
  const { error, note } = await searchParams;
  const tenantId = active.tenantId;
  const canWrite = can(active.permissions, "compliance.write");
  const year = Number(todayInZone(active.tenantTimezone).slice(0, 4));

  const { sets, matches, states } = await dbAs(session, async (tx) => ({
    sets: await tx<Set[]>`
      select state_code, registry_kind, registry_year, count(*)::int as rows, max(imported_at)::text as imported_at
      from public.notification_registries where tenant_id = ${tenantId} group by state_code, registry_kind, registry_year order by state_code, registry_year desc, registry_kind`,
    matches: await tx<Match[]>`
      select p.id, p.account_id, concat_ws(' ', p.line1, p.city) as address, p.state_code,
             (select coalesce(sum(jsonb_array_length(value)), 0)::int from jsonb_each(p.registry_matches)) as matches
      from public.properties p where p.tenant_id = ${tenantId} and p.archived_at is null and p.registry_matches <> '{}'::jsonb order by p.state_code, address`,
    states: await tx<{ state_code: string }[]>`select distinct state_code from public.branches where tenant_id = ${tenantId} and archived_at is null order by state_code`,
  }));

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/compliance" className="hover:underline">
          Compliance
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Notification registries</h1>
      <p className="text-sm text-stone-600">
        A state&apos;s list of people who must get advance notice before nearby applications. Import the state&apos;s file; every property at a listed address is matched by its normalized address, and dispatch refuses to schedule a matching job until the advance notice is recorded.
      </p>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}
      {note ? <Notice kind="success">{note}</Notice> : null}

      {canWrite ? (
        <Card title="Import a registry" description="CSV with a header row. Columns are found by name (address, city, state, zip, name, phone, email, notes); a state pack can carry its own layout. The rows of the same state, kind and year are replaced.">
          <form action={importRegistry} className="grid gap-3 sm:grid-cols-4" encType="multipart/form-data">
            <input type="hidden" name="tenant_id" value={tenantId} />
            <Field label="State" htmlFor="reg-state">
              <Input id="reg-state" name="state_code" list="reg-states" defaultValue={states[0]?.state_code ?? ""} maxLength={2} required />
              <datalist id="reg-states">
                {states.map((s) => (
                  <option key={s.state_code} value={s.state_code} />
                ))}
              </datalist>
            </Field>
            <Field label="Registry kind" htmlFor="reg-kind" hint="The state's name for the list, or general.">
              <Input id="reg-kind" name="registry_kind" defaultValue="general" />
            </Field>
            <Field label="Year" htmlFor="reg-year">
              <Input id="reg-year" name="registry_year" inputMode="numeric" defaultValue={year} required />
            </Field>
            <Field label="File" htmlFor="reg-file">
              <Input id="reg-file" name="file" type="file" accept=".csv,text/csv" />
            </Field>
            <div className="sm:col-span-4">
              <Field label="Or paste the rows" htmlFor="reg-text">
                <Textarea id="reg-text" name="csv_text" rows={3} className="font-mono text-xs" placeholder="name,address,city,state,zip,phone,email" />
              </Field>
            </div>
            <div className="sm:col-span-4">
              <Field label="Header mapping (optional)" htmlFor="reg-mapping" hint="One line per column the file names differently: Header=field, with fields name, line1, line2, city, state, postal_code, contact_name, phone, email, notes. A state pack's layout applies when a pack exists.">
                <Textarea id="reg-mapping" name="mapping" rows={2} className="font-mono text-xs" placeholder={"Service Address=line1\nZIP5=postal_code"} />
              </Field>
            </div>
            <div className="sm:col-span-4">
              <Button type="submit">Import</Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card title="Imported registries">
        {sets.length === 0 ? (
          <Empty>No registry imported yet.</Empty>
        ) : (
          <Table headers={["State", "Kind", "Year", "Rows", "Imported", ""]}>
            {sets.map((s) => (
              <tr key={`${s.state_code}-${s.registry_kind}-${s.registry_year}`} data-testid="registry-set">
                <td className="py-2 pr-4">{s.state_code}</td>
                <td className="py-2 pr-4">{s.registry_kind}</td>
                <td className="py-2 pr-4">{s.registry_year}</td>
                <td className="py-2 pr-4 tabular-nums">{s.rows}</td>
                <td className="py-2 pr-4">{formatInstant(s.imported_at, active.tenantTimezone)}</td>
                <td className="py-2 text-right">
                  {canWrite ? (
                    <form action={rematchRegistry}>
                      <input type="hidden" name="tenant_id" value={tenantId} />
                      <input type="hidden" name="state_code" value={s.state_code} />
                      <Button type="submit" variant="secondary">
                        Re-match {s.state_code}
                      </Button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Matched properties" description="Properties whose normalized address appears on a registry in their state. Their visits need the advance notice recorded before scheduling.">
        {matches.length === 0 ? (
          <Empty>No property matches a registry.</Empty>
        ) : (
          <Table headers={["Property", "State", "Matches"]}>
            {matches.map((m) => (
              <tr key={m.id} data-testid="registry-match">
                <td className="py-2 pr-4">
                  <Link href={`/customers/properties/${m.id}`} className="underline">
                    {m.address}
                  </Link>
                </td>
                <td className="py-2 pr-4">{m.state_code}</td>
                <td className="py-2 pr-4 tabular-nums">{m.matches}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
