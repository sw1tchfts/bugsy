import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Table, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { todayInZone } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { buildExport, openInPeriod, paySettings, payRates, rateOn } from "@/lib/payroll/db";
import { lastClosedPeriod } from "@/lib/payroll/periods";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { exportAction, postAction, saveRate, saveSettings } from "./actions";

export const metadata: Metadata = { title: "Payroll" };

const dollars = (c: number | string | null) => (c === null ? "" : (Number(c) / 100).toFixed(2));

/** Pay settings, rates, the payroll export and the payroll journal (spec 18 rules 9 to 13). Bugsy does not run payroll. */
export default async function Payroll({ searchParams }: { searchParams: Promise<{ note?: string; error?: string; period?: string }> }) {
  const q = await searchParams;
  const { session, active } = await requireActiveTenant();
  if (!can(active.permissions, "payroll.read")) redirect("/?error=forbidden");
  const write = can(active.permissions, "payroll.write");
  const t = active.tenantId;
  const tz = active.tenantTimezone;
  const today = todayInZone(tz);
  const data = await dbAs(session, async (tx) => {
    const settings = await paySettings(tx, t);
    const rates = await payRates(tx, t);
    const people = await tx<{ user_id: string; name: string | null; payroll_id: string | null; role: string }[]>`
      select m.user_id, m.display_name as name, m.payroll_id, r.name as role from public.memberships m join public.roles r on r.id = m.role_id where m.tenant_id = ${t} order by 2`;
    const periods = await tx<{ id: string; starts_on: string; ends_on: string; status: string; commissions_cents: string; posted_on: string | null; lines: number; pay_due: string }[]>`
      select p.id, p.starts_on::text, p.ends_on::text, p.status, p.commissions_cents, p.posted_on::text,
             (select count(*)::int from public.pay_period_lines l where l.pay_period_id = p.id) as lines,
             (select coalesce(sum(l.pay_due_cents), 0)::text from public.pay_period_lines l where l.pay_period_id = p.id) as pay_due
      from public.pay_periods p where p.tenant_id = ${t} order by p.starts_on desc limit 26`;
    const next = settings ? lastClosedPeriod(settings, today) : null;
    // Any overlap with a period already sent counts (a changed setting must not pay days twice).
    const taken = next ? periods.some((p) => p.starts_on <= next.ends_on && p.ends_on >= next.starts_on) : false;
    const preview = settings && next && !taken ? await buildExport(tx, t, settings, next, tz) : [];
    const open = next && !taken ? await openInPeriod(tx, t, next, tz) : [];
    return { settings, rates, people, periods, next, taken, preview, open };
  });
  const hidden = <input type="hidden" name="tenant_id" value={t} />;
  return (
    <>
      <h1 className="text-2xl font-semibold">Payroll</h1>
      <p className="text-sm text-stone-600">Bugsy exports hours, production pay, draws and commissions for your payroll provider, then posts the payroll back to the ledger. Overtime, taxes and paychecks are the provider&apos;s.</p>
      {q.note ? <Notice kind="success">{q.note}</Notice> : null}
      {errorMessage(q.error) ? <Notice kind="error">{errorMessage(q.error)}</Notice> : null}

      <Card title="Pay period">
        <form action={saveSettings} className="flex flex-wrap items-end gap-3">
          {hidden}
          <Field label="Every" htmlFor="period">
            <Select id="period" name="period" defaultValue={data.settings?.period ?? "biweekly"} disabled={!write}>
              <option value="weekly">Week</option>
              <option value="biweekly">Two weeks</option>
              <option value="semimonthly">Half month (1st to 15th, 16th to the end)</option>
            </Select>
          </Field>
          <Field label="A first day" htmlFor="anchor_on" hint="Weekly and two-week periods count from here; the workweek starts on its weekday.">
            <Input id="anchor_on" name="anchor_on" type="date" defaultValue={data.settings?.anchor_on ?? ""} required disabled={!write} />
          </Field>
          {write ? <Button type="submit">Save</Button> : null}
        </form>
      </Card>

      {data.next ? (
        <Card title={`Next export: ${data.next.starts_on} to ${data.next.ends_on}`} description={data.taken ? "Already exported, or overlapping a period already exported." : "What the file will carry. Correct time on the Time page before exporting."}>
          {data.open.length ? (
            <Notice kind="error">Still clocked in from this period: {data.open.map((o) => o.name).join(", ")}. Close those entries on the Time page before exporting.</Notice>
          ) : null}
          {data.taken ? null : data.preview.length === 0 ? (
            <Empty>No time, pay or commissions in this period.</Empty>
          ) : (
            <>
              <Table headers={["Person", "Pay", "Hours", "Production revenue", "Production pay", "Draw", "Pay due", "Commissions"]}>
                {data.preview.map((l) => (
                  <tr key={l.email} data-testid="payroll-preview">
                    <td className="py-2 pr-4 text-sm">
                      {l.name}
                      {l.payroll_id ? <span className="block text-xs text-stone-500">{l.payroll_id}</span> : null}
                    </td>
                    <td className="py-2 pr-4 text-sm">{l.kind ?? <Badge tone="warn">no rate</Badge>}</td>
                    <td className="py-2 pr-4 text-sm tabular-nums">{l.hours.toFixed(2)}</td>
                    <td className="py-2 pr-4 text-sm tabular-nums">{formatCents(l.production_revenue_cents)}</td>
                    <td className="py-2 pr-4 text-sm tabular-nums">{formatCents(l.production_pay_cents)}</td>
                    <td className="py-2 pr-4 text-sm tabular-nums">{l.draw_cents === null ? "" : formatCents(l.draw_cents)}</td>
                    <td className="py-2 pr-4 text-sm tabular-nums">{l.pay_due_cents === null ? "" : formatCents(l.pay_due_cents)}</td>
                    <td className="py-2 pr-4 text-sm tabular-nums">{formatCents(l.commissions_cents)}</td>
                  </tr>
                ))}
              </Table>
              {write ? (
                <form action={exportAction} className="mt-3">
                  {hidden}
                  <input type="hidden" name="starts_on" value={data.next.starts_on} />
                  <input type="hidden" name="ends_on" value={data.next.ends_on} />
                  <Button type="submit">Export this period</Button>
                </form>
              ) : null}
            </>
          )}
        </Card>
      ) : (
        <Notice kind="info">Set the pay period to export.</Notice>
      )}

      <Card title="Exported periods">
        {data.periods.length === 0 ? (
          <Empty>Nothing exported yet.</Empty>
        ) : (
          <Table headers={["Period", "People", "Pay due", "Commissions", "Status", ""]}>
            {data.periods.map((p) => (
              <tr key={p.id} data-testid="pay-period">
                <td className="py-2 pr-4 text-sm">
                  {p.starts_on} to {p.ends_on}
                </td>
                <td className="py-2 pr-4 text-sm">{p.lines}</td>
                <td className="py-2 pr-4 text-sm tabular-nums">{formatCents(Number(p.pay_due))}</td>
                <td className="py-2 pr-4 text-sm tabular-nums">{formatCents(Number(p.commissions_cents))}</td>
                <td className="py-2 pr-4 text-sm">
                  <Badge tone={p.status === "posted" ? "good" : "warn"}>{p.status === "posted" ? `posted ${p.posted_on}` : "exported"}</Badge>
                </td>
                <td className="py-2 pr-4 text-sm">
                  <Link href={`/api/payroll/${p.id}/export.csv`} className="text-emerald-800 underline" data-testid="payroll-csv">
                    Download file
                  </Link>
                  {write && p.status === "exported" ? (
                    <form action={postAction} className="mt-2 grid gap-1 sm:grid-cols-6" data-testid="post-payroll">
                      {hidden}
                      <input type="hidden" name="period_id" value={p.id} />
                      <input name="gross_wages" aria-label="Gross wages" placeholder="Gross wages" required className="rounded border border-stone-300 px-1 text-xs" />
                      <input name="employer_taxes" aria-label="Employer taxes" placeholder="Employer taxes" required className="rounded border border-stone-300 px-1 text-xs" />
                      <input name="withholdings" aria-label="Withholdings" placeholder="Withholdings" required className="rounded border border-stone-300 px-1 text-xs" />
                      <input name="net_pay" aria-label="Net pay" placeholder="Net pay" required className="rounded border border-stone-300 px-1 text-xs" />
                      <input name="commissions" aria-label="Commissions paid" defaultValue={dollars(p.commissions_cents)} required className="rounded border border-stone-300 px-1 text-xs" />
                      <button type="submit" className="rounded border border-stone-300 bg-white px-2 text-xs">
                        Post payroll
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Pay" description="The rate in effect on a period's last day is used for the whole period. Labor cost per hour feeds job costing.">
        <Table headers={["Person", "Payroll id", "Pay now", "From"]}>
          {data.people.map((p) => {
            const r = rateOn(data.rates, p.user_id, today);
            return (
              <tr key={p.user_id} data-testid="pay-rate-row">
                <td className="py-2 pr-4 text-sm">
                  {p.name ?? "Member"}
                  <span className="block text-xs text-stone-500">{p.role}</span>
                </td>
                <td className="py-2 pr-4 text-sm">{p.payroll_id ?? ""}</td>
                <td className="py-2 pr-4 text-sm">
                  {!r
                    ? "none"
                    : r.kind === "hourly"
                      ? `${formatCents(r.hourly_rate_cents ?? 0)} an hour`
                      : r.kind === "production"
                        ? `${Number(r.production_percent)}% of production${r.draw_cents ? `, ${formatCents(r.draw_cents)} draw` : ""}`
                        : `${formatCents(r.salary_cents ?? 0)} a period`}
                </td>
                <td className="py-2 pr-4 text-sm">{r?.effective_from ?? ""}</td>
              </tr>
            );
          })}
        </Table>
        {write ? (
          <form action={saveRate} className="mt-4 grid gap-3 sm:grid-cols-4" data-testid="rate-form">
            {hidden}
            <Field label="Person" htmlFor="p-user">
              <Select id="p-user" name="user_id">
                {data.people.map((p) => (
                  <option key={p.user_id} value={p.user_id}>
                    {p.name ?? "Member"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Pay" htmlFor="p-kind">
              <Select id="p-kind" name="kind" defaultValue="production">
                <option value="production">Production</option>
                <option value="hourly">Hourly</option>
                <option value="salary">Salary</option>
              </Select>
            </Field>
            <Field label="Starts" htmlFor="p-from">
              <Input id="p-from" name="effective_from" type="date" required defaultValue={today} />
            </Field>
            <Field label="Payroll id" htmlFor="p-pid">
              <Input id="p-pid" name="payroll_id" />
            </Field>
            <Field label="Production percent" htmlFor="p-pct">
              <Input id="p-pct" name="production_percent" inputMode="decimal" placeholder="22.5" />
            </Field>
            <Field label="Draw per period" htmlFor="p-draw">
              <Input id="p-draw" name="draw" inputMode="decimal" />
            </Field>
            <Field label="Hourly rate" htmlFor="p-hourly">
              <Input id="p-hourly" name="hourly_rate" inputMode="decimal" />
            </Field>
            <Field label="Salary per period" htmlFor="p-salary">
              <Input id="p-salary" name="salary" inputMode="decimal" />
            </Field>
            <Field label="Labor cost per hour" htmlFor="p-cost" hint="With taxes and benefits; defaults to the hourly rate.">
              <Input id="p-cost" name="labor_cost" inputMode="decimal" />
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="secondary">
                Save pay
              </Button>
            </div>
          </form>
        ) : null}
      </Card>
    </>
  );
}
