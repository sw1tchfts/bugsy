"use client";

// The devices at a commercial program stop (spec 14): what is left to check, a check per device, adding or moving a
// station by tapping the map in the same step, taking one out, and recommendations. Everything is a queued change, so
// it works offline and syncs in order like the rest of the stop.
import { useMemo, useState } from "react";
import { SiteMap } from "@/components/site-map";
import { Scanner } from "@/components/tech/scanner";
import { ACTIONS, ACTIVITY, CHECK_STATUSES, KIND_TAGS, REC_CATEGORIES, REC_PRIORITIES, ZONES, type DeviceKind, hasActivity } from "@/lib/commercial/devices";
import type { ChangePayload, RouteDevice, RouteVisit } from "@/lib/tech/route-types";

type T = (k: string, v?: Record<string, string | number>) => string;
type Props = { visit: RouteVisit; t: T; onQueue: (payload: ChangePayload) => Promise<void>; disabled: boolean };

const input = "rounded border border-stone-300 px-2 py-2";
const tag = (d: Pick<RouteDevice, "kind" | "number">) => `${KIND_TAGS[d.kind as DeviceKind] ?? "?"} ${d.number}`;
const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

function CheckForm({ device, t, onQueue, onDone }: { device: RouteDevice; t: T; onQueue: Props["onQueue"]; onDone: () => void }) {
  const [status, setStatus] = useState("checked");
  const [activity, setActivity] = useState("none");
  const [count, setCount] = useState("");
  const [bait, setBait] = useState("");
  const [pest, setPest] = useState("");
  const [actions, setActions] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const checked = status === "checked";
  const rodent = ["bait_station", "termite_station"].includes(device.kind);
  return (
    <form
      className="mt-2 grid gap-2 rounded border border-stone-200 p-2"
      data-testid={`check-form-${device.number}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!checked && !notes.trim()) return;
        void onQueue({
          kind: "device_check",
          device_id: device.id,
          status,
          activity: checked ? activity : null,
          count: checked && count !== "" ? Number(count) : null,
          bait_consumed_pct: checked && bait !== "" ? Number(bait) : null,
          pest: pest.trim() || null,
          actions,
          notes: notes.trim() || null,
          checked_at: new Date().toISOString(),
        }).then(onDone);
      }}
    >
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={tag(device)}>
        {CHECK_STATUSES.map((s) => (
          <label key={s} className={`rounded border px-3 py-2 ${status === s ? "border-emerald-800 bg-emerald-50" : "border-stone-300"}`}>
            <input type="radio" name="status" value={s} checked={status === s} onChange={() => setStatus(s)} className="sr-only" />
            {t(`devices.status.${s}`)}
          </label>
        ))}
      </div>
      {checked ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs">
            {t("devices.activity")}
            <select value={activity} onChange={(e) => setActivity(e.target.value)} className={input} data-testid="check-activity">
              {ACTIVITY.map((a) => (
                <option key={a} value={a}>
                  {t(`devices.activity.${a}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs">
            {t("devices.count")}
            <input value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={input} data-testid="check-count" />
          </label>
          {rodent ? (
            <label className="grid gap-1 text-xs">
              {t("devices.bait")}
              <select value={bait} onChange={(e) => setBait(e.target.value)} className={input}>
                <option value="">-</option>
                {[0, 25, 50, 75, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}%
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="grid gap-1 text-xs">
            {t("devices.pest")}
            <input value={pest} onChange={(e) => setPest(e.target.value)} className={input} data-testid="check-pest" />
          </label>
        </div>
      ) : null}
      <fieldset className="flex flex-wrap gap-2 text-xs">
        <legend className="mb-1">{t("devices.actions")}</legend>
        {ACTIONS.map((a) => (
          <label key={a} className="flex items-center gap-1">
            <input type="checkbox" checked={actions.includes(a)} onChange={(e) => setActions((cur) => (e.target.checked ? [...cur, a] : cur.filter((x) => x !== a)))} />
            {a.replace(/_/g, " ")}
          </label>
        ))}
      </fieldset>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder={t("devices.notes")} aria-label={t("devices.notes")} className={input} required={!checked} />
      <button type="submit" className="rounded bg-emerald-900 px-3 py-2 font-medium text-white" data-testid="check-save">
        {t("devices.save")}
      </button>
    </form>
  );
}

export function DevicesSection({ visit, t, onQueue, disabled }: Props) {
  const site = visit.site;
  const [open, setOpen] = useState<string | null>(null);
  const [mode, setMode] = useState<"check" | "move" | "remove">("check");
  const [scanning, setScanning] = useState(false);
  const [find, setFind] = useState("");
  const [notFound, setNotFound] = useState<string | null>(null);
  const [mapId, setMapId] = useState<string | null>(site?.maps[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [form, setForm] = useState({ kind: site?.kinds[0] ?? "bait_station", number: "", barcode: "", zone: "interior", location: "", reason: "" });
  const [rec, setRec] = useState({ category: "sanitation", priority: "medium", responsibility: "customer", description: "" });

  const checks = useMemo(() => new Map((visit.captured.device_checks ?? []).map((c) => [c.device_id, c])), [visit.captured.device_checks]);
  if (!site) return null;
  const inProgram = site.devices.filter((d) => d.status === "active" && site.kinds.includes(d.kind));
  const done = inProgram.filter((d) => checks.has(d.id)).length;
  const map = site.maps.find((m) => m.id === mapId) ?? null;
  const selected = site.devices.find((d) => d.id === open) ?? null;

  function locate(code: string) {
    const c = code.trim().toLowerCase();
    const d = site?.devices.find((x) => x.status === "active" && (x.barcode?.toLowerCase() === c || x.number.toLowerCase() === c));
    if (!d) {
      setNotFound(code);
      return;
    }
    setNotFound(null);
    setOpen(d.id);
    setMode("check");
    if (d.map_id) setMapId(d.map_id);
  }

  async function addDevice() {
    if (!form.number.trim() || !form.location.trim()) return;
    await onQueue({
      kind: "device_add",
      device_id: uuid(),
      number: form.number.trim(),
      barcode: form.barcode.trim() || null,
      device_kind: form.kind,
      zone: form.zone,
      location: form.location.trim(),
      map_id: pos && map ? map.id : null,
      x: pos && map ? pos.x : null,
      y: pos && map ? pos.y : null,
      at: new Date().toISOString(),
    });
    setAdding(false);
    setPos(null);
    setForm((f) => ({ ...f, number: "", barcode: "", location: "" }));
  }

  async function moveDevice(d: RouteDevice) {
    await onQueue({
      kind: "device_move",
      device_id: d.id,
      zone: form.zone,
      location: form.location.trim() || d.location,
      map_id: pos && map ? map.id : d.map_id,
      x: pos && map ? pos.x : d.x,
      y: pos && map ? pos.y : d.y,
      at: new Date().toISOString(),
    });
    setOpen(null);
    setPos(null);
  }

  const picking = adding || (mode === "move" && selected !== null);
  const visible = site.devices.filter((d) => d.status === "active");

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-3 text-sm" data-testid="devices">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">{t("devices.title")}</h2>
        <span className={done === inProgram.length ? "text-emerald-800" : "text-amber-800"} data-testid="devices-progress">
          {t("devices.progress", { done, total: inProgram.length })}
        </span>
      </div>

      {site.sightings.length ? (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2">
          <p className="font-medium">{t("devices.sightings")}</p>
          <ul className="list-disc pl-5">
            {site.sightings.map((s) => (
              <li key={s.id}>
                {s.pest}, {s.location}
                {s.notes ? `: ${s.notes}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {site.maps.length ? (
        <div className="mt-2 grid gap-1">
          {site.maps.length > 1 ? (
            <select value={mapId ?? ""} onChange={(e) => setMapId(e.target.value)} className={input} aria-label={t("devices.map")}>
              {site.maps.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          ) : null}
          {map ? (
            <SiteMap
              src={`/api/files/${map.file_id}`}
              name={map.name}
              width={map.width}
              height={map.height}
              devices={visible.filter((d) => d.map_id === map.id).map((d) => ({ ...d, hot: false }))}
              selectedId={open}
              pending={pos}
              onPick={!disabled && picking ? (x, y) => setPos({ x, y }) : undefined}
              testid="tech-site-map"
            />
          ) : null}
          {picking ? <p className="text-xs text-stone-600">{pos ? t("devices.placed") : t("devices.tapMap")}</p> : null}
        </div>
      ) : null}

      {!disabled ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => setScanning(true)} className="rounded border border-emerald-800 px-3 py-2 text-emerald-900">
            {t("devices.scan")}
          </button>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              locate(find);
            }}
          >
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={t("devices.find")} aria-label={t("devices.find")} className={`${input} w-28`} data-testid="device-find" />
          </form>
        </div>
      ) : null}
      {scanning ? (
        <Scanner
          onCode={(code) => {
            setScanning(false);
            locate(code);
          }}
          onClose={() => setScanning(false)}
          unsupportedText={t("products.scanUnsupported")}
          closeText="OK"
        />
      ) : null}
      {notFound ? <p className="mt-1 text-red-800">{t("devices.notFound", { code: notFound })}</p> : null}

      <ul className="mt-2 grid gap-1">
        {inProgram
          .slice()
          .sort((a, b) => Number(checks.has(a.id)) - Number(checks.has(b.id)))
          .map((d) => {
            const c = checks.get(d.id);
            return (
              <li key={d.id} className="rounded border border-stone-200 p-2" data-testid="device-row" data-number={d.number} data-checked={c ? "yes" : "no"}>
                <button
                  type="button"
                  className="flex w-full items-baseline justify-between gap-2 text-left"
                  onClick={() => {
                    setOpen(open === d.id ? null : d.id);
                    setMode("check");
                    setPos(null);
                    setForm((f) => ({ ...f, zone: d.zone, location: d.location }));
                    if (d.map_id) setMapId(d.map_id);
                  }}
                >
                  <span>
                    <span className="font-semibold">{tag(d)}</span> <span className="text-stone-600">{d.location}</span>
                  </span>
                  <span className={`text-xs ${c ? (hasActivity(c) ? "text-amber-800" : "text-emerald-800") : "text-stone-500"}`}>
                    {c ? `${t(`devices.status.${c.status}`)}${c.activity && c.activity !== "none" ? `, ${t(`devices.activity.${c.activity}`)}` : ""}${c.count ? `, ${c.count}` : ""}` : t("devices.toCheck")}
                  </span>
                </button>
                {d.last && !c ? <p className="text-xs text-stone-500">{t("devices.last", { result: `${t(`devices.status.${d.last.status}`)}${d.last.activity && d.last.activity !== "none" ? `, ${t(`devices.activity.${d.last.activity}`)}` : ""}` })}</p> : null}
                {open === d.id && !disabled ? (
                  <>
                    <div className="mt-1 flex gap-3 text-xs">
                      {(["check", "move", "remove"] as const).map((m) => (
                        <button key={m} type="button" onClick={() => setMode(m)} className={mode === m ? "font-semibold underline" : "underline"}>
                          {t(`devices.${m}`)}
                        </button>
                      ))}
                    </div>
                    {mode === "check" ? <CheckForm device={d} t={t} onQueue={onQueue} onDone={() => setOpen(null)} /> : null}
                    {mode === "move" ? (
                      <div className="mt-2 grid gap-2">
                        <select value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })} className={input} aria-label={t("devices.zone")}>
                          {ZONES.map((z) => (
                            <option key={z} value={z}>
                              {t(`devices.zone.${z}`)}
                            </option>
                          ))}
                        </select>
                        <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder={t("devices.location")} aria-label={t("devices.location")} className={input} />
                        <button type="button" onClick={() => void moveDevice(d)} className="rounded bg-emerald-900 px-3 py-2 font-medium text-white">
                          {t("devices.saveMove")}
                        </button>
                      </div>
                    ) : null}
                    {mode === "remove" ? (
                      <form
                        className="mt-2 grid gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!form.reason.trim()) return;
                          void onQueue({ kind: "device_remove", device_id: d.id, reason: form.reason.trim(), at: new Date().toISOString() }).then(() => setOpen(null));
                        }}
                      >
                        <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder={t("devices.removeReason")} aria-label={t("devices.removeReason")} className={input} required />
                        <button type="submit" className="rounded border border-red-700 px-3 py-2 text-red-800">
                          {t("devices.remove")}
                        </button>
                      </form>
                    ) : null}
                  </>
                ) : null}
              </li>
            );
          })}
      </ul>

      {!disabled ? (
        adding ? (
          <form
            className="mt-3 grid gap-2 rounded border border-stone-200 p-2"
            data-testid="device-add-form"
            onSubmit={(e) => {
              e.preventDefault();
              void addDevice();
            }}
          >
            <p className="font-medium">{t("devices.add")}</p>
            <div className="grid grid-cols-2 gap-2">
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={input} aria-label={t("devices.kind")}>
                {site.kinds.map((k) => (
                  <option key={k} value={k}>
                    {KIND_TAGS[k as DeviceKind] ?? k} ({k.replace(/_/g, " ")})
                  </option>
                ))}
              </select>
              <input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder={t("devices.number")} aria-label={t("devices.number")} className={input} required />
              <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder={t("devices.barcode")} aria-label={t("devices.barcode")} className={input} />
              <select value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })} className={input} aria-label={t("devices.zone")}>
                {ZONES.map((z) => (
                  <option key={z} value={z}>
                    {t(`devices.zone.${z}`)}
                  </option>
                ))}
              </select>
            </div>
            <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder={t("devices.location")} aria-label={t("devices.location")} className={input} required />
            <div className="flex gap-2">
              <button type="submit" className="rounded bg-emerald-900 px-3 py-2 font-medium text-white" data-testid="device-add-save">
                {t("devices.add")}
              </button>
              <button type="button" onClick={() => setAdding(false)} className="rounded border border-stone-300 px-3 py-2">
                {t("devices.cancel")}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => { setAdding(true); setOpen(null); setPos(null); }} className="mt-3 rounded border border-emerald-800 px-3 py-2 text-emerald-900" data-testid="device-add">
            {t("devices.add")}
          </button>
        )
      ) : null}

      <div className="mt-3 border-t border-stone-200 pt-2">
        <p className="font-medium">{t("devices.recommendations")}</p>
        {site.recommendations.length ? (
          <ul className="list-disc pl-5">
            {site.recommendations.map((r) => (
              <li key={r.id} data-testid="tech-recommendation">
                {r.description}
                {r.due_on ? ` (${r.due_on})` : ""}
              </li>
            ))}
          </ul>
        ) : null}
        {!disabled ? (
          <form
            className="mt-2 grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!rec.description.trim()) return;
              void onQueue({ kind: "recommendation", ...rec, description: rec.description.trim(), at: new Date().toISOString() });
              setRec({ ...rec, description: "" });
            }}
          >
            <div className="grid grid-cols-3 gap-2">
              <select value={rec.category} onChange={(e) => setRec({ ...rec, category: e.target.value })} className={input} aria-label={t("devices.recCategory")}>
                {REC_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select value={rec.priority} onChange={(e) => setRec({ ...rec, priority: e.target.value })} className={input} aria-label={t("devices.recPriority")}>
                {REC_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <select value={rec.responsibility} onChange={(e) => setRec({ ...rec, responsibility: e.target.value })} className={input} aria-label={t("devices.recOwner")}>
                <option value="customer">{t("devices.recOwner.customer")}</option>
                <option value="company">{t("devices.recOwner.company")}</option>
              </select>
            </div>
            <textarea value={rec.description} onChange={(e) => setRec({ ...rec, description: e.target.value })} rows={2} placeholder={t("devices.recText")} aria-label={t("devices.recText")} className={input} />
            <button type="submit" className="justify-self-start rounded border border-emerald-800 px-3 py-2 text-emerald-900" data-testid="recommendation-save">
              {t("devices.recSave")}
            </button>
          </form>
        ) : null}
      </div>
    </section>
  );
}
