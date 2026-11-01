import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Table, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { listMembers } from "@/lib/dispatch/db";
import { todayInZone } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { holdLabel } from "@/lib/sales/db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { payRep, saveCommissionPlan, togglePlan } from "../actions";

export const metadata: Metadata = { title: "Commissions" };

const BASIS = { initial: "First visit price", first_year: "First year of visits", flat: "Flat amount" } as const;
const ROLES = ["sales_rep", "technician", "office", "dispatcher"] as const;

/** Commission plans, every seller's commissions and payouts (spec 17 rules 4 to 7). Sellers see only their own. */
export default async function CommissionsPage({ searchParams }: { searchParams: Promise<{ note?: string; error?: string }> }) {
  const q = await searchParams;
  const { session, active } = await requireActiveTenant();
  const manage = can(active.permissions, "billing.write");
  const viewAll = can(active.permissions, "billing.read");
  const today = todayInZone(active.tenantTimezone);
  const data = await dbAs(session, async (tx) => {
    const plans = await tx<{ id: string; name: string; role_keys: string[]; user_ids: string[]; basis: keyof typeof BASIS; percent: string | null; flat_cents: string | null; hold_days: number; hold_paid_invoices: number; chargeback_days: number; active: boolean }[]>`
      select id, name, role_keys, user_ids, basis, percent::text, flat_cents, hold_days, hold_paid_invoices, chargeback_days, active from public.commission_plans where tenant_id = ${active.tenantId} order by active desc, name`;
    const rows = await tx<{ id: string; user_id: string; amount_cents: string; status: string; releasable_on: string; earned_on: string; agreement_id: string; agreement_number: number; account_name: string }[]>`
      select c.id, c.user_id, c.amount_cents, c.status, c.releasable_on::text, c.earned_on::text, c.agreement_id, g.number as agreement_number, a.name as account_name
      from public.commissions c join public.agreements g on g.id = c.agreement_id join public.accounts a on a.id = g.account_id
      where c.tenant_id = ${active.tenantId} order by c.earned_on desc limit 500`;
    return { plans, rows, members: viewAll ? await listMembers(tx, active.tenantId) : [] };
  });
  const nameOf = new Map(data.members.map((m) => [m.user_id, m.name]));
  const byUser = new Map<string, { held: number; payable: number; paid: number; charged_back: number }>();
  for (const r of data.rows) {
    const t = byUser.get(r.user_id) ?? { held: 0, payable: 0, paid: 0, charged_back: 0 };
    t[r.status as keyof typeof t] += Number(r.amount_cents);
    byUser.set(r.user_id, t);
  }
  const hidden = <input type="hidden" name="tenant_id" value={active.tenantId} />;
  return (
    <>
      <h1 className="text-2xl font-semibold">Commissions</h1>
      {q.note ? <Notice kind="success">{q.note}</Notice> : null}
      {errorMessage(q.error) ? <Notice kind="error">{errorMessage(q.error)}</Notice> : null}
      <Card title={viewAll ? "By seller" : "Yours"} description="Held until the hold passes and the customer has paid; payable then; charged back if the customer cancels inside the window.">
        {byUser.size === 0 ? (
          <Empty>No commissions yet.</Empty>
        ) : (
          <Table headers={["Seller", "Held", "Payable", "Paid", "Charged back", ""]}>
            {[...byUser.entries()].map(([user, t]) => (
              <tr key={user} data-testid="commission-seller">
                <td className="py-2 pr-4">{nameOf.get(user) ?? "You"}</td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(t.held)}</td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(t.payable)}</td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(t.paid)}</td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(t.charged_back)}</td>
                <td className="py-2 pr-4">
                  {manage && t.payable > 0 ? (
                    <form action={payRep} className="flex gap-2">
                      {hidden}
                      <input type="hidden" name="user_id" value={user} />
                      <Input name="paid_on" type="date" defaultValue={today} aria-label="Paid on" className="w-36" />
                      <Button type="submit" variant="secondary">
                        Pay
                      </Button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title="Each sale">
        {data.rows.length === 0 ? (
          <Empty>No sales yet.</Empty>
        ) : (
          <Table headers={["Earned", "Seller", "Agreement", "Amount", "Status"]}>
            {data.rows.map((r) => (
              <tr key={r.id} data-testid="commission-row">
                <td className="py-2 pr-4">{r.earned_on}</td>
                <td className="py-2 pr-4">{nameOf.get(r.user_id) ?? "You"}</td>
                <td className="py-2 pr-4">
                  <Link href={`/agreements/${r.agreement_id}`} className="underline">
                    #{r.agreement_number}
                  </Link>{" "}
                  {r.account_name}
                </td>
                <td className="py-2 pr-4 tabular-nums">{formatCents(Number(r.amount_cents))}</td>
                <td className="py-2 pr-4">
                  <Badge tone={r.status === "payable" ? "good" : r.status === "charged_back" ? "bad" : r.status === "paid" ? "neutral" : "warn"}>{holdLabel(r, today)}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title="Plans" description="A plan applies to sales signed while it is on; changing plans never changes commissions already earned.">
        {data.plans.length === 0 ? (
          <Empty>No plans yet.</Empty>
        ) : (
          <ul className="grid gap-2 text-sm">
            {data.plans.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2" data-testid="commission-plan">
                <span className="font-medium">{p.name}</span> {p.active ? null : <Badge>off</Badge>}
                <span>
                  {p.basis === "flat" ? formatCents(Number(p.flat_cents)) : `${Number(p.percent)}% of ${BASIS[p.basis].toLowerCase()}`}; held {p.hold_days} days and {p.hold_paid_invoices} paid invoice(s); charged back inside {p.chargeback_days} days; for{" "}
                  {[...p.role_keys.map((r) => r.replace("_", " ")), ...p.user_ids.map((u) => nameOf.get(u) ?? "a member")].join(", ")}
                </span>
                {manage ? (
                  <form action={togglePlan}>
                    {hidden}
                    <input type="hidden" name="plan_id" value={p.id} />
                    <button type="submit" className="text-xs text-emerald-800 underline">
                      {p.active ? "Turn off" : "Turn on"}
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {manage ? (
          <form action={saveCommissionPlan} className="mt-4 grid gap-3 border-t border-stone-100 pt-3 sm:grid-cols-3">
            {hidden}
            <Field label="Name" htmlFor="cp-name">
              <Input id="cp-name" name="name" required placeholder="Door sales" />
            </Field>
            <Field label="Based on" htmlFor="cp-basis">
              <Select id="cp-basis" name="basis" defaultValue="first_year">
                {Object.entries(BASIS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Percent (or flat $ below)" htmlFor="cp-percent">
              <Input id="cp-percent" name="percent" inputMode="decimal" placeholder="10" />
            </Field>
            <Field label="Flat amount ($)" htmlFor="cp-flat">
              <Input id="cp-flat" name="flat" inputMode="decimal" />
            </Field>
            <Field label="Hold (days)" htmlFor="cp-hold">
              <Input id="cp-hold" name="hold_days" type="number" min={0} max={365} defaultValue={30} />
            </Field>
            <Field label="Paid invoices before release" htmlFor="cp-paid">
              <Input id="cp-paid" name="hold_paid_invoices" type="number" min={0} max={24} defaultValue={1} />
            </Field>
            <Field label="Charge back if cancelled within (days)" htmlFor="cp-cb">
              <Input id="cp-cb" name="chargeback_days" type="number" min={0} max={730} defaultValue={90} />
            </Field>
            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-medium text-stone-700">Covers</legend>
              <div className="mt-1 flex flex-wrap gap-3 text-sm">
                {ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-1">
                    <input type="checkbox" name="role_keys" value={r} defaultChecked={r === "sales_rep"} /> {r.replace("_", " ")}s
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="sm:col-span-3">
              <Button type="submit">Add plan</Button>
            </div>
          </form>
        ) : null}
      </Card>
    </>
  );
}
