import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DoorLocation } from "@/components/sales/door-location";
import { KnockMap } from "@/components/sales/knock-map";
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Textarea, errorMessage } from "@/components/ui";
import { dbAs } from "@/lib/auth/session";
import { formatInstant } from "@/lib/dates";
import { OUTCOMES, OUTCOME_LABELS, type Outcome, knockStats, latestByAddress } from "@/lib/sales/territory";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { knockAction } from "../actions";

export const metadata: Metadata = { title: "Territory" };

type Knock = { id: string; address: string; normalized_address: string; outcome: string; notes: string | null; follow_up_at: Date | null; knocked_at: Date; lat: number | null; lng: number | null; rep_id: string; cleared_at: Date | null };

/** One territory at the curb (spec 17 rules 1 and 2): the knock map, what happened at each door, a new knock, a sale. */
export default async function Territory({ params, searchParams }: { params: Promise<{ territoryId: string }>; searchParams: Promise<{ note?: string; error?: string; dnk?: string }> }) {
  const { territoryId } = await params;
  const q = await searchParams;
  const { session, active } = await requireActiveTenant();
  const data = await dbAs(session, async (tx) => {
    const [t] = await tx<{ id: string; name: string; zip_codes: string[]; streets: string[] }[]>`
      select id, name, zip_codes, streets from public.territories where id = ${territoryId} and tenant_id = ${active.tenantId}`;
    if (!t) return null;
    const knocks = await tx<Knock[]>`
      select id, address, normalized_address, outcome, notes, follow_up_at, knocked_at, lat, lng, rep_id, cleared_at from public.knocks
      where territory_id = ${territoryId} order by knocked_at desc limit 500`;
    return { t, knocks };
  });
  if (!data) notFound();
  const { t, knocks } = data;
  const latest = [...latestByAddress(knocks).values()];
  const stats = knockStats(knocks.filter((k) => k.rep_id === session.userId));
  const dnk = latest.filter((k) => k.outcome === "do_not_knock" && !k.cleared_at);
  const comeBack = latest.filter((k) => k.outcome === "come_back").sort((a, b) => String(a.follow_up_at ?? "").localeCompare(String(b.follow_up_at ?? "")));
  const hidden = (
    <>
      <input type="hidden" name="tenant_id" value={active.tenantId} />
      <input type="hidden" name="territory_id" value={t.id} />
    </>
  );
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">{t.name}</h1>
        <p className="text-sm text-stone-600">
          {[t.zip_codes.join(", "), t.streets.join(", ")].filter(Boolean).join("; ")}. You: {stats.doors} doors, {stats.sold} sold
          {stats.close_rate !== null ? ` (${Math.round(stats.close_rate * 100)}% of answered doors)` : ""}.
        </p>
      </div>
      {q.note ? <Notice kind="success">{q.note}</Notice> : null}
      {errorMessage(q.error) ? <Notice kind="error">{errorMessage(q.error)}</Notice> : null}
      <Link href={`/door/${t.id}/sell`} className="rounded bg-emerald-900 px-4 py-3 text-center text-base font-semibold text-white" data-testid="door-sell">
        Sell a plan at this door
      </Link>
      <Card title="Record a knock">
        <form action={knockAction} className="grid gap-3">
          {hidden}
          {q.dnk ? <input type="hidden" name="confirm_dnk" value="true" /> : null}
          <DoorLocation />
          <Field label="Street address" htmlFor="line1">
            <Input id="line1" name="line1" required autoComplete="address-line1" />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="City" htmlFor="city">
              <Input id="city" name="city" required />
            </Field>
            <Field label="State" htmlFor="state_code">
              <Input id="state_code" name="state_code" required maxLength={2} />
            </Field>
            <Field label="ZIP" htmlFor="postal_code">
              <Input id="postal_code" name="postal_code" required maxLength={10} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What happened">
            {OUTCOMES.filter((o) => o !== "sold").map((o, i) => (
              <label key={o} className="flex items-center gap-1 rounded border border-stone-300 bg-white px-3 py-2 text-sm">
                <input type="radio" name="outcome" value={o} defaultChecked={i === 0} /> {OUTCOME_LABELS[o]}
              </label>
            ))}
          </div>
          <Field label="Come back at (for come back)" htmlFor="follow_up_at">
            <Input id="follow_up_at" name="follow_up_at" type="datetime-local" />
          </Field>
          <Field label="Notes" htmlFor="knock-notes">
            <Textarea id="knock-notes" name="notes" rows={2} />
          </Field>
          <Button type="submit">{q.dnk ? "Save anyway: they agreed to talk" : "Save knock"}</Button>
        </form>
      </Card>
      <Card title="Where you have been">
        <KnockMap knocks={knocks} />
      </Card>
      {comeBack.length ? (
        <Card title="Come back">
          <ul className="grid gap-1 text-sm">
            {comeBack.map((k) => (
              <li key={k.id}>
                {k.address}
                {k.follow_up_at ? `, ${formatInstant(k.follow_up_at, active.tenantTimezone)}` : ""}
                {k.notes ? <span className="block text-xs text-stone-600">{k.notes}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card title="Do not knock" description="These doors asked not to be knocked.">
        {dnk.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <ul className="grid gap-1 text-sm" data-testid="dnk-list">
            {dnk.map((k) => (
              <li key={k.id}>{k.address}</li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Recent knocks">
        {knocks.length === 0 ? (
          <Empty>No knocks yet.</Empty>
        ) : (
          <ul className="grid gap-1 text-sm">
            {knocks.slice(0, 30).map((k) => (
              <li key={k.id} className="flex justify-between gap-2" data-testid="knock-row">
                <span>{k.address}</span>
                <span>
                  <Badge tone={k.outcome === "sold" ? "good" : k.outcome === "do_not_knock" ? "bad" : "neutral"}>{OUTCOME_LABELS[k.outcome as Outcome] ?? k.outcome}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
