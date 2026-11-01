import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Empty, Notice, Table } from "@/components/ui";
import { riskList } from "@/lib/ai/churn-db";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { Back } from "../helpers";
import { rescoreChurn } from "./actions";

export const metadata: Metadata = { title: "Churn risk" };

const TONE = { high: "bad", medium: "warn", low: "neutral" } as const;

/** Spec 21 rule 6: the plans most at risk of cancelling, each with the reasons behind its score, to call first. */
export default async function ChurnRiskPage({ searchParams }: { searchParams: Promise<{ band?: string; note?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "reports.read");
  await requirePermission(active.tenantId, "customers.read");
  const q = await searchParams;
  const band = q.band === "high" || q.band === "medium" ? q.band : "all";
  const rows = await dbAs(session, (tx) => riskList(tx, active.tenantId, band));
  return (
    <>
      <Back />
      <h1 className="text-2xl font-semibold">Churn risk</h1>
      <p className="text-sm text-stone-600">
        Each active plan&apos;s score is the sum of the signals listed with it, recomputed every day. A high score is a reason to call, not a prediction; nothing changes on the plan.
      </p>
      {q.note ? <Notice kind="success">{q.note}</Notice> : null}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link href="/reports/churn-risk" className={band === "all" ? "font-semibold" : "underline"}>
          High and medium
        </Link>
        <Link href="/reports/churn-risk?band=high" className={band === "high" ? "font-semibold" : "underline"}>
          High only
        </Link>
        {can(active.permissions, "billing.write") || can(active.permissions, "customers.write") ? (
          <form action={rescoreChurn} className="ml-auto">
            <input type="hidden" name="tenant_id" value={active.tenantId} />
            <Button type="submit" variant="secondary">
              Score again now
            </Button>
          </form>
        ) : null}
      </div>
      <Card title={`${rows.length} plan${rows.length === 1 ? "" : "s"}`}>
        {rows.length === 0 ? (
          <Empty>No plan is at medium or high risk.</Empty>
        ) : (
          <Table headers={["Customer", "Plan", "Score", "Why"]}>
            {rows.map((r) => (
              <tr key={r.agreement_id} data-testid="churn-row">
                <td className="py-2 pr-4 text-sm">
                  <Link href={`/customers/${r.account_id}`} className="underline">
                    {r.account_name}
                  </Link>
                  <span className="block text-xs text-stone-500">{r.address}</span>
                </td>
                <td className="py-2 pr-4 text-sm">
                  <Link href={`/agreements/${r.agreement_id}`} className="underline">
                    {r.service}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-sm">
                  <Badge tone={TONE[r.band]}>{`${r.score} ${r.band}`}</Badge>
                </td>
                <td className="py-2 pr-4 text-xs">
                  <ul className="grid gap-0.5">
                    {r.reasons.map((x) => (
                      <li key={x.code}>
                        {x.text} <span className="text-stone-500">(+{x.points})</span>
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
