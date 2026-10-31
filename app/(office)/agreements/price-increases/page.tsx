import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Table, Textarea, errorMessage } from "@/components/ui";
import { BILLING_MODES, BILLING_MODE_LABELS } from "@/lib/agreements/cadence";
import { type IncreaseRow, increaseTargets } from "@/lib/agreements/db";
import { increasedPrice } from "@/lib/agreements/increase";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { addMonths, formatBusinessDate, formatInstant, startOfMonth, todayInZone } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { applyPriceIncrease, createPriceIncrease, deletePriceIncrease } from "../actions";

export const metadata: Metadata = { title: "Price increases" };

type Increase = IncreaseRow & { service_type_name: string | null; branch_name: string | null; agreements_changed: number | null; notes: string | null; created_at: string };
type Preview = { count: number; oldTotal: number; newTotal: number };

export default async function PriceIncreasesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "agreements.write");
  const { error } = await searchParams;
  const tenantId = active.tenantId;
  const today = todayInZone(active.tenantTimezone);

  const { increases, previews, serviceTypes, branches } = await dbAs(session, async (tx) => {
    const increases = await tx<Increase[]>`
      select i.id, i.kind, i.percent, i.amount_cents, i.rounding, i.effective_on, i.service_type_id, i.branch_id, i.billing_mode, i.applied_at, i.agreements_changed, i.notes, i.created_at,
             st.name as service_type_name, b.name as branch_name
      from public.price_increases i left join public.service_types st on st.id = i.service_type_id left join public.branches b on b.id = i.branch_id
      where i.tenant_id = ${tenantId} order by i.applied_at nulls first, i.effective_on desc`;
    const previews = new Map<string, Preview>();
    for (const inc of increases.filter((i) => !i.applied_at)) {
      const targets = await increaseTargets(tx, tenantId, inc);
      const oldTotal = targets.reduce((sum, t) => sum + Number(t.recurring_price_cents), 0);
      const newTotal = targets.reduce((sum, t) => sum + increasedPrice(Number(t.recurring_price_cents), inc), 0);
      previews.set(inc.id, { count: targets.length, oldTotal, newTotal });
    }
    const serviceTypes = await tx<{ id: string; name: string }[]>`select id, name from public.service_types where tenant_id = ${tenantId} and archived_at is null order by name`;
    const branches = await tx<{ id: string; name: string }[]>`select id, name from public.branches where tenant_id = ${tenantId} and archived_at is null order by name`;
    return { increases, previews, serviceTypes, branches };
  });

  const describe = (i: Increase) => (i.kind === "percent" ? `${Number(i.percent)}%` : `+${formatCents(Number(i.amount_cents))}`) + (i.rounding === "dollar" ? ", to the dollar" : "");
  const scope = (i: Increase) => [i.service_type_name ?? "every service type", i.branch_name ?? "every branch", i.billing_mode ? BILLING_MODE_LABELS[i.billing_mode as keyof typeof BILLING_MODE_LABELS] : "every billing mode"].join(", ");

  return (
    <>
      <div>
        <p className="text-sm text-stone-500">
          <Link href="/agreements" className="hover:underline">
            Agreements
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">Price increases</h1>
        <p className="mt-1 text-sm text-stone-600">Raise recurring prices across active agreements at once. Each agreement gets a dated change row so customers can be told (spec 11). Initial prices never change.</p>
      </div>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      <Card title="Pending" description="Saved but not applied. The preview counts the active agreements the filters match today.">
        {increases.filter((i) => !i.applied_at).length === 0 ? (
          <Empty>No pending increases.</Empty>
        ) : (
          <Table headers={["Increase", "Effective", "Applies to", "Agreements", "Recurring total", ""]}>
            {increases
              .filter((i) => !i.applied_at)
              .map((i) => {
                const p = previews.get(i.id);
                return (
                  <tr key={i.id}>
                    <td className="py-2 pr-4 font-medium">{describe(i)}</td>
                    <td className="py-2 pr-4">{formatBusinessDate(i.effective_on)}</td>
                    <td className="py-2 pr-4">{scope(i)}</td>
                    <td className="py-2 pr-4 tabular-nums">{p?.count ?? 0}</td>
                    <td className="py-2 pr-4 tabular-nums">
                      {p ? `${formatCents(p.oldTotal)} to ${formatCents(p.newTotal)} per visit cycle` : ""}
                    </td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <form action={applyPriceIncrease}>
                          <input type="hidden" name="tenant_id" value={tenantId} />
                          <input type="hidden" name="increase_id" value={i.id} />
                          <Button type="submit">Apply to {p?.count ?? 0}</Button>
                        </form>
                        <form action={deletePriceIncrease}>
                          <input type="hidden" name="tenant_id" value={tenantId} />
                          <input type="hidden" name="increase_id" value={i.id} />
                          <Button type="submit" variant="danger">
                            Discard
                          </Button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </Table>
        )}
      </Card>

      <Card title="Plan an increase">
        <form action={createPriceIncrease} className="grid gap-4 sm:grid-cols-3">
          <input type="hidden" name="tenant_id" value={tenantId} />
          <Field label="Kind" htmlFor="kind">
            <Select id="kind" name="kind" defaultValue="percent">
              <option value="percent">Percent</option>
              <option value="amount">Fixed amount</option>
            </Select>
          </Field>
          <Field label="Percent" htmlFor="percent">
            <Input id="percent" name="percent" inputMode="decimal" placeholder="5" />
          </Field>
          <Field label="Amount ($)" htmlFor="amount">
            <Input id="amount" name="amount" inputMode="decimal" placeholder="7.00" />
          </Field>
          <Field label="Effective on" htmlFor="effective_on">
            <Input id="effective_on" name="effective_on" type="date" required defaultValue={addMonths(startOfMonth(today), 1)} />
          </Field>
          <Field label="Rounding" htmlFor="rounding">
            <Select id="rounding" name="rounding" defaultValue="cent">
              <option value="cent">To the cent</option>
              <option value="dollar">To the dollar</option>
            </Select>
          </Field>
          <Field label="Service type" htmlFor="service_type_id">
            <Select id="service_type_id" name="service_type_id" defaultValue="">
              <option value="">Every service type</option>
              {serviceTypes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Branch" htmlFor="branch_id">
            <Select id="branch_id" name="branch_id" defaultValue="">
              <option value="">Every branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Billing mode" htmlFor="billing_mode">
            <Select id="billing_mode" name="billing_mode" defaultValue="">
              <option value="">Every billing mode</option>
              {BILLING_MODES.map((m) => (
                <option key={m} value={m}>
                  {BILLING_MODE_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-3">
            <Field label="Notes" htmlFor="notes">
              <Textarea id="notes" name="notes" rows={2} placeholder="Yearly increase, letters go out two weeks before." />
            </Field>
          </div>
          <div>
            <Button type="submit">Save for review</Button>
          </div>
        </form>
      </Card>

      <Card title="Applied">
        {increases.filter((i) => i.applied_at).length === 0 ? (
          <Empty>No increases applied yet.</Empty>
        ) : (
          <Table headers={["Increase", "Effective", "Applies to", "Agreements changed", "Applied"]}>
            {increases
              .filter((i) => i.applied_at)
              .map((i) => (
                <tr key={i.id}>
                  <td className="py-2 pr-4 font-medium">
                    {describe(i)} <Badge tone="good">applied</Badge>
                  </td>
                  <td className="py-2 pr-4">{formatBusinessDate(i.effective_on)}</td>
                  <td className="py-2 pr-4">{scope(i)}</td>
                  <td className="py-2 pr-4 tabular-nums">{i.agreements_changed ?? 0}</td>
                  <td className="py-2 pr-4">{i.applied_at ? formatInstant(i.applied_at, active.tenantTimezone) : ""}</td>
                </tr>
              ))}
          </Table>
        )}
      </Card>
    </>
  );
}
