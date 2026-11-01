import type { Metadata } from "next";
import Link from "next/link";
import { Button, Card, Empty, Field, Input, Select, Table } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { jobCosts } from "@/lib/costing/db";
import { GROUPS, GROUP_LABELS, type Group, groupJobs } from "@/lib/costing/jobs";
import { todayInZone } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { Back, rangeOf } from "../helpers";

export const metadata: Metadata = { title: "Job costing" };

/** Margin per completed visit and grouped (spec 18 rule 8): price, product used, labor on site. */
export default async function JobCosting({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; group?: string }> }) {
  const q = await searchParams;
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "reports.read");
  const range = rangeOf(q, todayInZone(active.tenantTimezone), { days: 30 });
  const group: Group = (GROUPS as readonly string[]).includes(q.group ?? "") ? (q.group as Group) : "visit";
  const jobs = await dbAs(session, (tx) => jobCosts(tx, active.tenantId, range.from, range.to, active.tenantTimezone));
  const rows = groupJobs(jobs, group);
  const total = groupJobs(jobs, "service_line").reduce(
    (s, r) => ({ revenue: s.revenue + r.revenue_cents, product: s.product + r.product_cost_cents, labor: s.labor + r.labor_cents, margin: s.margin + r.margin_cents }),
    { revenue: 0, product: 0, labor: 0, margin: 0 },
  );
  const pct = (p: number | null) => (p === null ? "" : `${p.toFixed(1)}%`);
  return (
    <>
      <Back />
      <h1 className="text-2xl font-semibold">Job costing</h1>
      <p className="text-sm text-stone-600">
        Each completed visit&apos;s price less the product it used (at cost) and the labor on site (arrival to departure, for each crew member at their labor cost per hour). A management view: payroll posts the actual labor to the ledger.
      </p>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <Field label="From" htmlFor="from">
          <Input id="from" name="from" type="date" defaultValue={range.from} />
        </Field>
        <Field label="To" htmlFor="to">
          <Input id="to" name="to" type="date" defaultValue={range.to} />
        </Field>
        <Field label="By" htmlFor="group">
          <Select id="group" name="group" defaultValue={group}>
            {GROUPS.map((g) => (
              <option key={g} value={g}>
                {GROUP_LABELS[g]}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="secondary">
          Show
        </Button>
        <a href={`/api/reports/job-costing?from=${range.from}&to=${range.to}&group=${group}`} className="pb-2 text-sm text-emerald-800 underline" data-testid="report-csv">
          Download CSV
        </a>
      </form>
      <Card title={`${range.from} to ${range.to}`} description={`Revenue ${formatCents(total.revenue)}, product ${formatCents(total.product)}, labor ${formatCents(total.labor)}, margin ${formatCents(total.margin)}${total.revenue ? ` (${pct(Math.round((total.margin / total.revenue) * 1000) / 10)})` : ""}.`}>
        {rows.length === 0 ? (
          <Empty>No completed visits in this range.</Empty>
        ) : (
          <Table headers={[GROUP_LABELS[group], "Visits", "Revenue", "Product", "Labor", "Margin", "Margin %", "Hours on site", ""]}>
            {rows.map((r) => (
              <tr key={r.key} data-testid="costing-row">
                <td className="py-1 pr-4 text-sm">{group === "visit" ? <Link href={`/dispatch/visits/${r.key}`} className="underline">{r.label}</Link> : r.label}</td>
                <td className="py-1 pr-4 tabular-nums">{r.visits}</td>
                <td className="py-1 pr-4 tabular-nums">{formatCents(r.revenue_cents)}</td>
                <td className="py-1 pr-4 tabular-nums">{formatCents(r.product_cost_cents)}</td>
                <td className="py-1 pr-4 tabular-nums">{formatCents(r.labor_cents)}</td>
                <td className="py-1 pr-4 tabular-nums" data-testid="costing-margin">{formatCents(r.margin_cents)}</td>
                <td className="py-1 pr-4 tabular-nums">{pct(r.margin_pct)}</td>
                <td className="py-1 pr-4 tabular-nums">{r.on_site_hours}</td>
                <td className="py-1 pr-4 text-xs text-amber-800">{r.unpriced ? `${r.unpriced} not priced` : ""}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
