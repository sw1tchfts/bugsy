import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { onboardingStatus } from "@/lib/platform/db";
import { STEPS, progress } from "@/lib/platform/onboarding";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

export const metadata: Metadata = { title: "Set up" };

/** The setup checklist (spec 13 rule 9): each step is done when the data says so, and links to where it is done. */
export default async function OnboardingPage() {
  const { active } = await requireActiveTenant();
  const { session } = await requirePermission(active.tenantId, "settings.read");
  const status = await dbAs(session, (tx) => onboardingStatus(tx, active.tenantId));
  const p = progress(status);

  return (
    <>
      <h1 className="text-2xl font-semibold">Set up {active.tenantName}</h1>
      <p className="text-sm text-stone-600" data-testid="onboarding-progress">
        {p.done} of {p.total} done.{p.next ? ` Next: ${p.next.label.toLowerCase()}.` : " Everything is in place."}
      </p>
      <div className="h-2 w-full overflow-hidden rounded bg-stone-200" role="progressbar" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.done} aria-label="Setup progress">
        <div className="h-2 bg-emerald-700" style={{ width: `${(p.done / p.total) * 100}%` }} />
      </div>
      <Card title="Checklist" description="Ticks itself as the work gets done.">
        <ol className="grid gap-2">
          {STEPS.map((s, i) => {
            const done = Boolean(status[s.key]);
            return (
              <li key={s.key} className="flex items-start gap-3 rounded border border-stone-200 p-3" data-testid={`step-${s.key}`} data-done={done ? "yes" : "no"}>
                <span className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-emerald-700 text-white" : "border border-stone-300 text-stone-600"}`} aria-hidden="true">
                  {done ? "✓" : i + 1}
                </span>
                <div className="grow">
                  <p className="font-medium">
                    {s.label} <span className="sr-only">{done ? "(done)" : "(to do)"}</span>
                  </p>
                  <p className="text-sm text-stone-600">{s.detail}</p>
                </div>
                <Link href={s.href} className="text-sm text-emerald-800 underline">
                  {done ? "Review" : "Do this"}
                </Link>
              </li>
            );
          })}
        </ol>
      </Card>
    </>
  );
}
