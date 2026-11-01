import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Badge, Button, Card, Empty, Field, Input, Notice, Table, Textarea, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { listMembers } from "@/lib/dispatch/db";
import { formatInstantDate } from "@/lib/dates";
import { knockStats } from "@/lib/sales/territory";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { clearDoNotKnock, saveTerritory } from "../actions";

export const metadata: Metadata = { title: "Territories" };

/** Territories, their reps and what happened at the doors (spec 17 rules 1 and 2). */
export default async function TerritoriesPage({ searchParams }: { searchParams: Promise<{ note?: string; error?: string }> }) {
  const q = await searchParams;
  const { session, active } = await requireActiveTenant();
  if (!(can(active.permissions, "customers.write") && can(active.permissions, "users.read"))) redirect("/?error=forbidden");
  const data = await dbAs(session, async (tx) => {
    const territories = await tx<{ id: string; name: string; zip_codes: string[]; streets: string[]; rep_ids: string[]; active: boolean }[]>`
      select id, name, zip_codes, streets, rep_ids, active from public.territories where tenant_id = ${active.tenantId} order by active desc, name`;
    const knocks = await tx<{ territory_id: string; normalized_address: string; outcome: string; knocked_at: Date; cleared_at: Date | null; id: string; address: string }[]>`
      select territory_id, normalized_address, outcome, knocked_at, cleared_at, id, address from public.knocks where tenant_id = ${active.tenantId}`;
    return { territories, knocks, members: await listMembers(tx, active.tenantId) };
  });
  const nameOf = new Map(data.members.map((m) => [m.user_id, m.name]));
  const hidden = <input type="hidden" name="tenant_id" value={active.tenantId} />;
  const dnk = data.knocks.filter((k) => k.outcome === "do_not_knock" && !k.cleared_at);
  return (
    <>
      <h1 className="text-2xl font-semibold">Territories</h1>
      {q.note ? <Notice kind="success">{q.note}</Notice> : null}
      {errorMessage(q.error) ? <Notice kind="error">{errorMessage(q.error)}</Notice> : null}
      <Card title="Territories" description="Reps knock only in the territories assigned to them.">
        {data.territories.length === 0 ? (
          <Empty>No territories yet.</Empty>
        ) : (
          <Table headers={["Territory", "Covers", "Reps", "Doors", "Sold", ""]}>
            {data.territories.map((t) => {
              const s = knockStats(data.knocks.filter((k) => k.territory_id === t.id));
              return (
                <tr key={t.id} data-testid="territory-row">
                  <td className="py-2 pr-4 font-medium">
                    {t.name} {t.active ? null : <Badge>off</Badge>}
                  </td>
                  <td className="py-2 pr-4 text-sm">{[t.zip_codes.join(", "), t.streets.join(", ")].filter(Boolean).join("; ")}</td>
                  <td className="py-2 pr-4 text-sm">{t.rep_ids.map((r) => nameOf.get(r) ?? "Member").join(", ") || "none"}</td>
                  <td className="py-2 pr-4 tabular-nums">{s.doors}</td>
                  <td className="py-2 pr-4 tabular-nums">{s.sold}</td>
                  <td className="py-2 pr-4">
                    <details>
                      <summary className="cursor-pointer text-sm text-emerald-800">Edit</summary>
                      <form action={saveTerritory} className="mt-2 grid gap-2">
                        {hidden}
                        <input type="hidden" name="territory_id" value={t.id} />
                        <Input name="name" defaultValue={t.name} aria-label="Name" />
                        <Textarea name="zip_codes" defaultValue={t.zip_codes.join(", ")} aria-label="ZIP codes" rows={1} />
                        <Textarea name="streets" defaultValue={t.streets.join("\n")} aria-label="Streets" rows={2} />
                        <div className="flex flex-wrap gap-3 text-sm">
                          {data.members.map((m) => (
                            <label key={m.user_id} className="flex items-center gap-1">
                              <input type="checkbox" name="rep_ids" value={m.user_id} defaultChecked={t.rep_ids.includes(m.user_id)} /> {m.name}
                            </label>
                          ))}
                        </div>
                        <Button type="submit" variant="secondary">
                          Save
                        </Button>
                      </form>
                    </details>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
        <form action={saveTerritory} className="mt-4 grid gap-3 border-t border-stone-100 pt-3 sm:grid-cols-2">
          {hidden}
          <Field label="New territory" htmlFor="t-name">
            <Input id="t-name" name="name" required placeholder="Westside, spring blitz" />
          </Field>
          <Field label="ZIP codes" htmlFor="t-zips" hint="Comma separated.">
            <Input id="t-zips" name="zip_codes" placeholder="43215, 43212" />
          </Field>
          <Field label="Streets" htmlFor="t-streets" hint="One per line; any house number on them counts.">
            <Textarea id="t-streets" name="streets" rows={2} />
          </Field>
          <fieldset>
            <legend className="text-sm font-medium text-stone-700">Reps</legend>
            <div className="mt-1 flex flex-wrap gap-3 text-sm">
              {data.members.map((m) => (
                <label key={m.user_id} className="flex items-center gap-1">
                  <input type="checkbox" name="rep_ids" value={m.user_id} /> {m.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="sm:col-span-2">
            <Button type="submit">Add territory</Button>
          </div>
        </form>
      </Card>
      <Card title="Do not knock" description="Doors that asked not to be knocked. Clear one when the household says it is fine again.">
        {dnk.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <ul className="grid gap-1 text-sm">
            {dnk.map((k) => (
              <li key={k.id} className="flex items-center gap-2">
                {k.address} <span className="text-stone-500">since {formatInstantDate(k.knocked_at, active.tenantTimezone)}</span>
                <form action={clearDoNotKnock}>
                  {hidden}
                  <input type="hidden" name="knock_id" value={k.id} />
                  <button type="submit" className="text-xs text-emerald-800 underline">
                    Clear
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
