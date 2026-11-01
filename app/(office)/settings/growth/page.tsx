import type { Metadata } from "next";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Table, Textarea, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { type Step, TRIGGERS, TRIGGER_LABELS, type Trigger, nps } from "@/lib/growth/sequences";
import { formatCents } from "@/lib/money";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { createSequence, saveGrowthSettings, toggleSequence } from "./actions";

export const metadata: Metadata = { title: "Growth" };

/** Sequences, surveys and referrals (spec 17 rules 8 to 10). */
export default async function GrowthPage({ searchParams }: { searchParams: Promise<{ note?: string; error?: string }> }) {
  const q = await searchParams;
  const { session, active } = await requireActiveTenant();
  const manage = can(active.permissions, "messages.manage");
  const data = await dbAs(session, async (tx) => {
    const sequences = await tx<{ id: string; name: string; trigger: Trigger; steps: Step[]; active: boolean; enrolled: number; done: number }[]>`
      select s.id, s.name, s.trigger, s.steps, s.active,
             (select count(*)::int from public.sequence_enrollments e where e.sequence_id = s.id) as enrolled,
             (select count(*)::int from public.sequence_enrollments e where e.sequence_id = s.id and e.status = 'stopped') as done
      from public.sequences s where s.tenant_id = ${active.tenantId} order by s.active desc, s.name`;
    const [settings] = await tx<{ referral_credit_cents: string; survey_enabled: boolean }[]>`select referral_credit_cents, survey_enabled from public.growth_settings where tenant_id = ${active.tenantId}`;
    const scores = await tx<{ score: number; comment: string | null; responded_at: Date }[]>`
      select score, comment, responded_at from public.surveys where tenant_id = ${active.tenantId} and responded_at > now() - interval '90 days' order by responded_at desc`;
    const credits = await tx<{ n: number; cents: string }[]>`select count(*)::int as n, coalesce(sum(amount_cents), 0) as cents from public.referral_credits where tenant_id = ${active.tenantId}`;
    const types = await tx<{ id: string; name: string }[]>`select id, name from public.service_types where tenant_id = ${active.tenantId} and active and archived_at is null order by name`;
    return { sequences, settings, scores, credits: credits[0], types };
  });
  const score = nps(data.scores.map((s) => s.score));
  const hidden = <input type="hidden" name="tenant_id" value={active.tenantId} />;
  return (
    <>
      <h1 className="text-2xl font-semibold">Growth</h1>
      {q.note ? <Notice kind="success">{q.note}</Notice> : null}
      {errorMessage(q.error) ? <Notice kind="error">{errorMessage(q.error)}</Notice> : null}
      <div className="grid gap-6 sm:grid-cols-3">
        <Card title="Score, last 90 days">
          <p className="text-3xl font-semibold tabular-nums" data-testid="nps">
            {score === null ? "no answers" : score}
          </p>
          <p className="text-xs text-stone-600">Promoters (9 and 10) minus detractors (0 to 6), {data.scores.length} answer(s).</p>
        </Card>
        <Card title="Referrals">
          <p className="text-3xl font-semibold tabular-nums">{data.credits.n}</p>
          <p className="text-xs text-stone-600">credits given, {formatCents(Number(data.credits.cents))} in all</p>
        </Card>
        <Card title="Settings">
          <form action={saveGrowthSettings} className="grid gap-2">
            {hidden}
            <Field label="Referral credit ($)" htmlFor="referral_credit">
              <Input id="referral_credit" name="referral_credit" inputMode="decimal" defaultValue={((Number(data.settings?.referral_credit_cents ?? 2500)) / 100).toFixed(2)} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="survey_enabled" defaultChecked={data.settings?.survey_enabled ?? true} /> Survey link in visit summaries
            </label>
            {can(active.permissions, "settings.write") ? (
              <Button type="submit" variant="secondary">
                Save
              </Button>
            ) : null}
          </form>
        </Card>
      </div>
      {data.scores.some((s) => s.comment) ? (
        <Card title="What customers said">
          <ul className="grid gap-1 text-sm">
            {data.scores
              .filter((s) => s.comment)
              .slice(0, 20)
              .map((s, i) => (
                <li key={i}>
                  <Badge tone={s.score >= 9 ? "good" : s.score <= 6 ? "bad" : "neutral"}>{s.score}</Badge> {s.comment}
                </li>
              ))}
          </ul>
        </Card>
      ) : null}
      <Card title="Sequences" description="A few timed messages that stop the moment the customer acts. Consent, opt-outs and quiet hours apply to every step.">
        {data.sequences.length === 0 ? (
          <Empty>No sequences yet.</Empty>
        ) : (
          <Table headers={["Sequence", "Starts on", "Steps", "Enrolled", "Stopped by acting", ""]}>
            {data.sequences.map((s) => (
              <tr key={s.id} data-testid="sequence-row">
                <td className="py-2 pr-4 font-medium">
                  {s.name} {s.active ? null : <Badge>off</Badge>}
                </td>
                <td className="py-2 pr-4">{TRIGGER_LABELS[s.trigger]}</td>
                <td className="py-2 pr-4 text-sm">{s.steps.map((st) => `${st.channel} after ${st.delay_days}d`).join(", ")}</td>
                <td className="py-2 pr-4 tabular-nums">{s.enrolled}</td>
                <td className="py-2 pr-4 tabular-nums">{s.done}</td>
                <td className="py-2 pr-4">
                  {manage ? (
                    <form action={toggleSequence}>
                      {hidden}
                      <input type="hidden" name="sequence_id" value={s.id} />
                      <button type="submit" className="text-sm text-emerald-800 underline">
                        {s.active ? "Turn off" : "Turn on"}
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
        {manage ? (
          <form action={createSequence} className="mt-4 grid gap-3 border-t border-stone-100 pt-3 sm:grid-cols-3">
            {hidden}
            <Field label="Name" htmlFor="sq-name">
              <Input id="sq-name" name="name" required placeholder="Renewal nudge" />
            </Field>
            <Field label="Starts on" htmlFor="sq-trigger">
              <Select id="sq-trigger" name="trigger" defaultValue="renewal_due">
                {TRIGGERS.map((t) => (
                  <option key={t} value={t}>
                    {TRIGGER_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Days (open, before the end, or since cancel)" htmlFor="sq-days">
              <Input id="sq-days" name="days" type="number" min={0} max={365} placeholder="30" />
            </Field>
            <Field label="Upsell month (1 to 12)" htmlFor="sq-month">
              <Input id="sq-month" name="month" type="number" min={1} max={12} />
            </Field>
            <Field label="Upsell service" htmlFor="sq-service">
              <Select id="sq-service" name="service_type_id" defaultValue="">
                <option value="">None</option>
                {data.types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <span />
            {[1, 2, 3].map((i) => (
              <fieldset key={i} className="grid gap-2 rounded border border-stone-200 p-2 sm:col-span-3 sm:grid-cols-4">
                <legend className="text-sm font-medium">Step {i}</legend>
                <Input name={`delay_${i}`} type="number" min={0} max={365} defaultValue={i === 1 ? 0 : 7} aria-label={`Step ${i} wait (days)`} />
                <Select name={`channel_${i}`} defaultValue="email" aria-label={`Step ${i} channel`}>
                  <option value="email">Email</option>
                  <option value="sms">Text</option>
                </Select>
                <Input name={`subject_${i}`} placeholder="Subject (email)" aria-label={`Step ${i} subject`} className="sm:col-span-2" />
                <Textarea name={`body_${i}`} rows={2} placeholder={i === 1 ? "Hi {{customer_name}}, ..." : "Optional"} aria-label={`Step ${i} message`} className="sm:col-span-4" />
              </fieldset>
            ))}
            <div className="sm:col-span-3">
              <Button type="submit">Add sequence</Button>
            </div>
          </form>
        ) : null}
      </Card>
    </>
  );
}
