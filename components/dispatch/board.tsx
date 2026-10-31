"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type DragEvent, useState, useTransition } from "react";
import { type BoardResult, moveTechnicianDay, reorderVisitJson, scheduleVisit, scheduleVisitJson, unscheduleVisitJson } from "@/app/(office)/dispatch/actions";
import type { MapPin } from "@/components/dispatch/map";
import { ARRIVAL_WINDOW_LABELS, type ArrivalWindow } from "@/lib/dispatch/checks";
import { dayLabel, isWeekend } from "@/lib/dispatch/week";

const DispatchMap = dynamic(() => import("@/components/dispatch/map").then((m) => m.DispatchMap), { ssr: false, loading: () => <div className="h-80 w-full animate-pulse rounded-md bg-stone-100" /> });

export type BoardVisit = {
  id: string;
  kind: string;
  status: string;
  account_name: string;
  address: string;
  city: string | null;
  service_type_name: string;
  due_start: string;
  due_end: string;
  scheduled_for: string | null;
  technician_id: string | null;
  route_position: number | null;
  arrival_window: ArrivalWindow;
  interior_only: boolean;
  lat: number | null;
  lng: number | null;
  branch_name: string | null;
};

export type BoardTechnician = { user_id: string; name: string };

export type BoardProps = {
  tenantId: string;
  canWrite: boolean;
  weekStart: string;
  days: string[];
  today: string;
  selectedDay: string;
  technicians: BoardTechnician[];
  scheduled: BoardVisit[];
  due: BoardVisit[];
};

const COLORS = ["#047857", "#1d4ed8", "#b45309", "#7e22ce", "#be123c", "#0f766e", "#4d7c0f", "#9f1239"];

function short(v: BoardVisit): string {
  return v.address.replace(/,.*$/, "");
}

export function DispatchBoard(props: BoardProps) {
  const { tenantId, canWrite, days, today, selectedDay, technicians, scheduled, due } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "error" | "warn" | "ok"; text: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const colorOf = (technicianId: string | null) => (technicianId ? COLORS[Math.max(0, technicians.findIndex((t) => t.user_id === technicianId)) % COLORS.length] : "#78716c");

  function report(result: BoardResult, okText: string) {
    if (!result.ok) setMessage({ kind: "error", text: result.blockers.join(" ") });
    else if (result.warnings.length) setMessage({ kind: "warn", text: `${okText} ${result.warnings.join(" ")}` });
    else setMessage({ kind: "ok", text: okText });
  }

  function onDragStart(e: DragEvent, visitId: string) {
    e.dataTransfer.setData("text/plain", visitId);
    e.dataTransfer.effectAllowed = "move";
    setDragging(visitId);
  }

  function onDrop(e: DragEvent, technicianId: string, date: string) {
    e.preventDefault();
    const visitId = e.dataTransfer.getData("text/plain") || dragging;
    setOver(null);
    setDragging(null);
    if (!visitId || !canWrite) return;
    startTransition(async () => {
      const result = await scheduleVisitJson({ tenantId, visitId, technicianId, date });
      report(result, "Scheduled.");
      router.refresh();
    });
  }

  function reorder(visitId: string, direction: "up" | "down") {
    startTransition(async () => {
      report(await reorderVisitJson({ tenantId, visitId, direction }), "Reordered.");
      router.refresh();
    });
  }

  function unschedule(visitId: string) {
    startTransition(async () => {
      report(await unscheduleVisitJson({ tenantId, visitId }), "Back on the due list.");
      router.refresh();
    });
  }

  const dayPins: MapPin[] = [
    ...scheduled
      .filter((v) => v.scheduled_for === selectedDay && v.lat !== null && v.lng !== null)
      .map((v) => ({
        id: v.id,
        lat: v.lat as number,
        lng: v.lng as number,
        label: `${v.route_position ?? ""}. ${v.account_name}`,
        detail: `${short(v)}, ${technicians.find((t) => t.user_id === v.technician_id)?.name ?? ""}`,
        color: colorOf(v.technician_id),
        href: `/dispatch/visits/${v.id}`,
      })),
    ...due
      .filter((v) => v.lat !== null && v.lng !== null)
      .map((v) => ({ id: v.id, lat: v.lat as number, lng: v.lng as number, label: v.account_name, detail: `${short(v)}, due ${v.due_start} to ${v.due_end}`, color: "#a8a29e", href: `/dispatch/visits/${v.id}` })),
  ];
  const unpinned = [...scheduled.filter((v) => v.scheduled_for === selectedDay), ...due].filter((v) => v.lat === null || v.lng === null);

  const card = (v: BoardVisit, inCell: boolean) => (
    <div
      key={v.id}
      draggable={canWrite && v.status !== "en_route" && v.status !== "in_progress"}
      onDragStart={(e) => onDragStart(e, v.id)}
      onDragEnd={() => setDragging(null)}
      className={`rounded border bg-white p-2 text-xs shadow-sm ${dragging === v.id ? "opacity-50" : ""} ${v.due_end < today && !inCell ? "border-red-300" : "border-stone-200"}`}
      style={{ borderLeftWidth: 4, borderLeftColor: colorOf(v.technician_id) }}
      data-visit={v.id}
    >
      <div className="flex items-start justify-between gap-1">
        <Link href={`/dispatch/visits/${v.id}`} className="font-medium text-stone-900 hover:underline">
          {inCell && v.route_position ? `${v.route_position}. ` : ""}
          {v.account_name}
        </Link>
        {v.arrival_window !== "any" ? <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-900">{ARRIVAL_WINDOW_LABELS[v.arrival_window]}</span> : null}
      </div>
      <div className="text-stone-600">{short(v)}</div>
      <div className="text-stone-500">
        {v.service_type_name}, {v.kind.replace("_", " ")}
        {v.interior_only ? ", interior only" : ""}
        {!inCell ? `, due ${v.due_start.slice(5)} to ${v.due_end.slice(5)}` : ""}
        {v.status !== "scheduled" && v.status !== "planned" ? `, ${v.status.replace("_", " ")}` : ""}
      </div>
      {canWrite ? (
        inCell ? (
          <div className="mt-1 flex gap-1">
            <button type="button" onClick={() => reorder(v.id, "up")} className="rounded border border-stone-200 px-1" aria-label={`Move ${v.account_name} up`} disabled={pending}>
              up
            </button>
            <button type="button" onClick={() => reorder(v.id, "down")} className="rounded border border-stone-200 px-1" aria-label={`Move ${v.account_name} down`} disabled={pending}>
              down
            </button>
            {v.status === "scheduled" ? (
              <button type="button" onClick={() => unschedule(v.id)} className="rounded border border-stone-200 px-1" aria-label={`Unassign ${v.account_name}`} disabled={pending}>
                unassign
              </button>
            ) : null}
          </div>
        ) : (
          <details className="mt-1">
            <summary className="cursor-pointer text-emerald-800">Schedule</summary>
            <ScheduleForm tenantId={tenantId} visitId={v.id} technicians={technicians} days={days} defaultDay={selectedDay} />
          </details>
        )
      ) : null}
    </div>
  );

  return (
    <div className="grid gap-4">
      {message ? (
        <p role="status" className={`rounded border px-3 py-2 text-sm ${message.kind === "error" ? "border-red-200 bg-red-50 text-red-900" : message.kind === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
          {message.text}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-md border border-stone-200 bg-stone-50 p-3">
          <h2 className="text-sm font-semibold">Due, not yet scheduled ({due.length})</h2>
          <p className="mb-2 text-xs text-stone-500">Overdue first. Drag onto a day, or open Schedule.</p>
          <div className="grid max-h-[70vh] gap-2 overflow-y-auto">{due.length ? due.map((v) => card(v, false)) : <p className="text-xs text-stone-500">Nothing due this week.</p>}</div>
        </aside>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-separate border-spacing-1 text-sm">
            <thead>
              <tr>
                <th className="w-36 text-left text-xs font-medium uppercase tracking-wide text-stone-500">Technician</th>
                {days.map((d) => (
                  <th key={d} className={`text-left text-xs font-medium uppercase tracking-wide ${d === today ? "text-emerald-800" : isWeekend(d) ? "text-stone-400" : "text-stone-500"}`}>
                    <Link href={`/dispatch?week=${days[0]}&day=${d}`} className={d === selectedDay ? "underline" : ""}>
                      {dayLabel(d)}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {technicians.map((t) => (
                <tr key={t.user_id}>
                  <th className="rounded bg-white p-2 text-left align-top font-medium" style={{ borderLeft: `4px solid ${colorOf(t.user_id)}` }}>
                    {t.name}
                  </th>
                  {days.map((d) => {
                    const key = `${t.user_id}|${d}`;
                    const stops = scheduled.filter((v) => v.technician_id === t.user_id && v.scheduled_for === d).sort((a, b) => (a.route_position ?? 99) - (b.route_position ?? 99));
                    return (
                      <td
                        key={key}
                        onDragOver={(e) => {
                          if (!canWrite) return;
                          e.preventDefault();
                          setOver(key);
                        }}
                        onDragLeave={() => setOver((o) => (o === key ? null : o))}
                        onDrop={(e) => onDrop(e, t.user_id, d)}
                        className={`min-h-16 min-w-32 rounded border p-1 align-top ${over === key ? "border-emerald-600 bg-emerald-50" : isWeekend(d) ? "border-stone-100 bg-stone-50" : "border-stone-200 bg-white"}`}
                        data-cell={key}
                      >
                        <div className="grid gap-1">{stops.map((v) => card(v, true))}</div>
                        {canWrite && stops.length ? (
                          <details className="mt-1 text-[11px] text-stone-500">
                            <summary className="cursor-pointer">Move day</summary>
                            <MoveDayForm tenantId={tenantId} technicianId={t.user_id} from={d} />
                          </details>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <section>
        <h2 className="mb-2 text-sm font-semibold">Map for {dayLabel(selectedDay)}</h2>
        <DispatchMap pins={dayPins} />
        {unpinned.length ? <p className="mt-1 text-xs text-stone-500">Needs a pin: {unpinned.map((v) => `${v.account_name} (${short(v)})`).join("; ")}</p> : null}
      </section>
    </div>
  );
}

function ScheduleForm({ tenantId, visitId, technicians, days, defaultDay }: { tenantId: string; visitId: string; technicians: BoardTechnician[]; days: string[]; defaultDay: string }) {
  return (
    <form action={scheduleVisit} className="mt-1 grid gap-1">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="visit_id" value={visitId} />
      <input type="hidden" name="return_to" value={`/dispatch?week=${days[0]}&day=${defaultDay}`} />
      <select name="technician_id" className="rounded border border-stone-300 px-1 py-0.5" aria-label="Technician" defaultValue={technicians[0]?.user_id ?? ""}>
        {technicians.map((t) => (
          <option key={t.user_id} value={t.user_id}>
            {t.name}
          </option>
        ))}
      </select>
      <input type="date" name="date" className="rounded border border-stone-300 px-1 py-0.5" aria-label="Date" defaultValue={defaultDay} />
      <button type="submit" className="rounded bg-emerald-900 px-2 py-0.5 text-white">
        Schedule
      </button>
    </form>
  );
}

function MoveDayForm({ tenantId, technicianId, from }: { tenantId: string; technicianId: string; from: string }) {
  return (
    <form action={moveTechnicianDay} className="mt-1 grid gap-1">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="technician_id" value={technicianId} />
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="return_to" value={`/dispatch?week=${from}&day=${from}`} />
      <input type="date" name="to" className="rounded border border-stone-300 px-1 py-0.5" aria-label={`Move ${from} to`} required />
      <label className="flex items-center gap-1">
        <input type="checkbox" name="append" value="true" /> append if that day has stops
      </label>
      <button type="submit" className="rounded border border-stone-300 bg-white px-2 py-0.5">
        Move whole day
      </button>
    </form>
  );
}
