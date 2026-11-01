import type { Metadata } from "next";
import Link from "next/link";
import { type BoardVisit, DispatchBoard } from "@/components/dispatch/board";
import { Notice, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { addDays, isIsoDate, todayInZone } from "@/lib/dates";
import { listTechnicians } from "@/lib/dispatch/db";
import { dayLabel, weekDays, weekOf } from "@/lib/dispatch/week";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

export const metadata: Metadata = { title: "Dispatch" };

type Search = { error?: string; warn?: string; week?: string; day?: string; branch?: string };

export default async function DispatchPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "dispatch.read");
  const params = await searchParams;
  const tenantId = active.tenantId;
  const canWrite = can(active.permissions, "dispatch.write");
  const today = todayInZone(active.tenantTimezone);
  const weekStart = weekOf(params.week && isIsoDate(params.week) ? params.week : today);
  const days = weekDays(weekStart);
  const selectedDay = params.day && days.includes(params.day) ? params.day : days.includes(today) ? today : days[0];
  const branch = params.branch || null;

  const { technicians, scheduled, due, branches } = await dbAs(session, async (tx) => {
    const technicians = await listTechnicians(tx, tenantId);
    const branches = await tx<{ id: string; name: string }[]>`select id, name from public.branches where tenant_id = ${tenantId} and archived_at is null order by name`;
    const select = tx`
      select v.id, v.kind, v.status, ac.name as account_name, p.normalized_address as address, p.city, st.name as service_type_name, v.due_start, v.due_end,
             v.scheduled_for, v.technician_id, v.route_position, v.arrival_window, v.interior_only, p.lat, p.lng, b.name as branch_name
      from public.visits v
        join public.accounts ac on ac.id = v.account_id
        join public.properties p on p.id = v.property_id
        join public.service_types st on st.id = v.service_type_id
        left join public.branches b on b.id = v.branch_id`;
    const scheduled = await tx<BoardVisit[]>`
      ${select}
      where v.tenant_id = ${tenantId} and v.scheduled_for between ${days[0]} and ${days[6]} and v.status in ('scheduled', 'en_route', 'in_progress', 'completed')
        and (${branch}::uuid is null or v.branch_id = ${branch})
      order by v.scheduled_for, v.route_position nulls last`;
    const due = await tx<BoardVisit[]>`
      ${select}
      where v.tenant_id = ${tenantId} and v.status = 'planned' and v.due_start <= ${days[6]}
        and (${branch}::uuid is null or v.branch_id = ${branch})
      order by v.due_end, v.due_start, v.sequence limit 200`;
    return { technicians, scheduled, due, branches };
  });

  const link = (start: string) => `/dispatch?week=${start}${branch ? `&branch=${branch}` : ""}`;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dispatch</h1>
          <p className="mt-1 text-sm text-stone-600">
            Week of {dayLabel(weekStart)}. Drag a due visit onto a technician&apos;s day; the board refuses anything that technician cannot legally do there.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={link(addDays(weekStart, -7))} className="rounded border border-stone-300 bg-white px-2 py-1 hover:bg-stone-50">
            Previous week
          </Link>
          <Link href={link(weekOf(today))} className="rounded border border-stone-300 bg-white px-2 py-1 hover:bg-stone-50">
            This week
          </Link>
          <Link href={link(addDays(weekStart, 7))} className="rounded border border-stone-300 bg-white px-2 py-1 hover:bg-stone-50">
            Next week
          </Link>
          <form method="get" className="flex items-center gap-1">
            <input type="hidden" name="week" value={weekStart} />
            <input type="hidden" name="day" value={selectedDay} />
            <label htmlFor="branch" className="text-stone-600">
              Branch
            </label>
            <select id="branch" name="branch" defaultValue={branch ?? ""} className="rounded border border-stone-300 bg-white px-2 py-1">
              <option value="">All</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded border border-stone-300 bg-white px-2 py-1 hover:bg-stone-50">
              Go
            </button>
          </form>
          <Link href={`/dispatch/routes?day=${selectedDay}${branch ? `&branch=${branch}` : ""}`} className="text-emerald-800 underline">
            Routes
          </Link>
          <Link href="/compliance/credentials" className="text-emerald-800 underline">
            Credentials
          </Link>
        </div>
      </div>
      {params.error ? <Notice kind="error">{errorMessage(params.error)}</Notice> : null}
      {params.warn ? <Notice kind="info">{params.warn}</Notice> : null}
      {technicians.length === 0 ? <Notice kind="info">No technicians yet. Give a user a role that can complete visits.</Notice> : null}
      <DispatchBoard tenantId={tenantId} canWrite={canWrite} weekStart={weekStart} days={days} today={today} selectedDay={selectedDay} technicians={technicians.map((t) => ({ user_id: t.user_id, name: t.name }))} scheduled={scheduled} due={due} />
    </>
  );
}
