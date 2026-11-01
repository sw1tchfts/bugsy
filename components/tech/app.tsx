"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DevicesSection } from "@/components/tech/devices";
import { Scanner } from "@/components/tech/scanner";
import { SpecialtySection } from "@/components/tech/specialty";
import { SignaturePad } from "@/components/tech/signature-pad";
import { checkLabelRate } from "@/lib/catalog/label-rates";
import { TREATMENT_AREAS } from "@/lib/catalog/service-lines";
import { gapsFor } from "@/lib/tech/gaps";
import { type Locale, gapMessage, t as translate } from "@/lib/tech/i18n";
import { withLocalChanges } from "@/lib/tech/local";
import { addDays, todayInZone } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { CLOCK_VISIT, type ChangePayload, type QueuedChange, type RoutePayload, type RouteVisit, type SyncResult } from "@/lib/tech/route-types";
import { newId, techStore } from "@/lib/tech/store";
import { dropChange, pendingCount, pushPending } from "@/lib/tech/sync";
import type { Conditions } from "@/lib/weather/provider";

type Props = { tenantId: string; userId: string; locale: Locale; today: string; timezone: string };

const UNITS = ["fl_oz", "oz", "lb", "gal", "ml", "l", "g", "kg", "each"] as const;
const CARRIER_UNITS = ["gal", "l", "fl_oz", "ml", "1000_sqft", "sqft", "acre"] as const;

function clock(iso: string | null, locale: string, timeZone: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(locale === "es" ? "es-US" : "en-US", { timeZone, hour: "numeric", minute: "2-digit" });
}

/** The browser's connectivity as an external store: true on the server render, then whatever the device says. */
function subscribeToConnectivity(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Server rejections that are dictionary keys read in the technician's language; anything else is shown as sent. */
function rejectionText(t: (k: string) => string, error: string | null): string {
  return error && error.startsWith("sync.") ? t(error) : (error ?? "");
}

/** Photos are downscaled on the device (1600 px on the long edge, JPEG) so a full day of them syncs in small requests. */
async function shrinkImage(file: File, maxEdge = 1600): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return readFileAsDataUrl(file);
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function TechApp({ tenantId, userId, locale, today: serverToday, timezone }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const visitId = params.get("visit");
  // The day comes from the device clock in the tenant's time zone: a shell cached the night before must show the morning's route.
  const [today] = useState(() => todayInZone(timezone) || serverToday);
  const t = useCallback((key: string, vars?: Record<string, string | number>) => translate(locale, key, vars), [locale]);

  const [route, setRoute] = useState<RoutePayload | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [changes, setChanges] = useState<QueuedChange[]>([]);
  const online = useSyncExternalStore(subscribeToConnectivity, () => navigator.onLine, () => true);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const syncing = useRef(false);
  const syncAgain = useRef(false);

  /** Fetches and stores the day's route (and tomorrow's) without showing it; null when offline or refused. */
  const fetchRoute = useCallback(async (): Promise<RoutePayload | null> => {
    try {
      const res = await fetch(`/api/tech/route?date=${today}`, { cache: "no-store" });
      if (!res.ok) return null;
      const payload = (await res.json()) as RoutePayload;
      await techStore.saveRoute(tenantId, payload);
      // Tomorrow's stops ride along, so a phone opened the night before has the morning's route with no signal.
      const next = await fetch(`/api/tech/route?date=${addDays(today, 1)}`, { cache: "no-store" });
      if (next.ok) await techStore.saveRoute(tenantId, (await next.json()) as RoutePayload);
      return payload;
    } catch {
      // Offline or the server is unreachable: the cached route stands.
      return null;
    }
  }, [tenantId, today]);

  const refresh = useCallback(async () => {
    const payload = await fetchRoute();
    if (payload) {
      setRoute(payload);
      setFromCache(false);
    }
  }, [fetchRoute]);

  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    // A change queued while a sync runs is picked up by another pass of that sync rather than lost from the screen.
    if (syncing.current) {
      syncAgain.current = true;
      return;
    }
    syncing.current = true;
    try {
      let again = false;
      do {
        let sent = 0;
        let failed = false;
        do {
          syncAgain.current = false;
          const all = await techStore.listChanges();
          const result = await pushPending(all, async (batch) => {
            const res = await fetch("/api/tech/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ changes: batch }) });
            if (!res.ok) throw Object.assign(new Error(String(res.status)), { status: res.status });
            return ((await res.json()) as { results: SyncResult[] }).results;
          });
          // Only the changes the server answered go back, and only those still in the store: a rejection the
          // technician dismissed while the sync ran stays dismissed.
          const before = new Map(all.map((c) => [c.id, c.status]));
          const answered = result.changes.filter((c) => c.status !== before.get(c.id));
          const still = new Set((await techStore.listChanges()).map((c) => c.id));
          await techStore.putChanges(answered.filter((c) => still.has(c.id)));
          setSyncNote(result.failed ? t("app.syncError", { message: "offline" }) : null);
          sent += result.sent;
          failed = result.failed;
        } while (!failed && syncAgain.current);
        // The store holds everything, including changes queued mid-sync; the screen shows the store. A change the
        // server took stops being drawn from the queue in the same render the route that holds it arrives, so
        // nothing on the stop flickers away (and the completion gate never reads a route without it).
        const fresh = sent > 0 ? await fetchRoute() : null;
        const stored = await techStore.listChanges();
        if (fresh) {
          setRoute(fresh);
          setFromCache(false);
        }
        setChanges(stored);
        // Checked after the last await, so a change queued at any point of this pass gets another pass.
        again = !failed && syncAgain.current;
      } while (again);
    } finally {
      syncing.current = false;
    }
  }, [fetchRoute, t]);

  // The signal coming back is what drains the queue.
  useEffect(() => {
    if (online) void sync();
  }, [online, sync]);

  useEffect(() => {
    void (async () => {
      const cached = await techStore.loadRoute(tenantId, today);
      if (cached) {
        setRoute(cached);
        setFromCache(true);
      }
      setChanges(await techStore.listChanges());
      if (navigator.onLine) {
        await refresh();
        await sync();
      }
      setLoading(false);
    })();
  }, [tenantId, today, refresh, sync]);

  const queue = useCallback(
    async (visit: string, payload: ChangePayload) => {
      const change: QueuedChange = { id: newId(), visit_id: visit, created_at: new Date().toISOString(), payload, status: "pending", error: null, gaps: null };
      await techStore.putChange(change);
      setChanges((prev) => [...prev, change]);
      if (navigator.onLine) void sync();
    },
    [sync],
  );

  const discard = useCallback(async (id: string) => {
    await techStore.deleteChange(id);
    setChanges((prev) => dropChange(prev, id));
  }, []);

  const pending = pendingCount(changes);
  const showTruck = params.get("truck") === "1";
  // The clock as the phone knows it: the last clock change still waiting to sync, else the route's (spec 18 rule 6).
  const clockChanges = changes.filter((c) => c.visit_id === CLOCK_VISIT);
  const lastPending = [...clockChanges].reverse().find((c) => c.status === "pending");
  const openSince =
    lastPending && lastPending.payload.kind === "clock" ? (lastPending.payload.direction === "in" ? lastPending.payload.at : null) : (route?.clock?.open_since ?? null);
  const clockRejected = clockChanges.filter((c) => c.status === "rejected");
  // Spec 19 rule 7: the position goes to dispatch while the person works (clocked in or on the way), online only.
  const onTheWay = route?.visits.some((v) => withLocalChanges(route, v, changes).status === "en_route") ?? false;
  const sharing = Boolean(openSince) || onTheWay;
  useEffect(() => {
    if (!sharing || !("geolocation" in navigator)) return;
    let latest: GeolocationPosition | null = null;
    let sentAt = 0;
    let busy = false;
    // A ping that fails (no signal, or the clock-in has not synced yet) is tried again on the next tick; a sent one
    // waits two minutes. The timer matters: a phone standing still reports its position once.
    const send = async () => {
      if (!latest || busy || !navigator.onLine || Date.now() - sentAt < 120_000) return;
      busy = true;
      try {
        const res = await fetch("/api/tech/position", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lat: latest.coords.latitude, lng: latest.coords.longitude, accuracy: latest.coords.accuracy, at: new Date().toISOString() }),
        });
        if (res.ok) sentAt = Date.now();
      } catch {
        // dropped: a ping is not a record
      } finally {
        busy = false;
      }
    };
    const id = navigator.geolocation.watchPosition(
      (p) => {
        latest = p;
        void send();
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 30_000 },
    );
    const timer = window.setInterval(() => void send(), 15_000);
    return () => {
      navigator.geolocation.clearWatch(id);
      window.clearInterval(timer);
    };
  }, [sharing]);
  const visit = route && visitId ? route.visits.find((v) => v.id === visitId) : null;
  const effective = route && visit ? withLocalChanges(route, visit, changes) : null;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 ${online ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`} data-testid="online-state">
          {online ? t("app.online") : t("app.offline")}
        </span>
        <span className="rounded-full bg-stone-200 px-2 py-0.5" data-testid="pending-count">
          {pending ? t("app.pending", { count: pending }) : t("app.synced")}
        </span>
        {online && pending ? (
          <button type="button" onClick={() => void sync()} className="rounded border border-stone-300 bg-white px-2 py-0.5">
            {t("app.syncNow")}
          </button>
        ) : null}
        {syncNote ? <span className="text-red-800">{syncNote}</span> : null}
      </div>

      {route ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white p-2 text-sm" data-testid="clock-bar">
          <span>
            <span data-testid="clock-state">{openSince ? t("clock.since", { time: clock(openSince, locale, timezone) }) : t("clock.off")}</span>
            {sharing ? (
              <span className="block text-xs text-stone-500" data-testid="position-shared">
                {t("clock.sharing")}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={() => void queue(CLOCK_VISIT, { kind: "clock", direction: openSince ? "out" : "in", at: new Date().toISOString() })}
            className={`rounded px-3 py-1.5 font-medium text-white ${openSince ? "bg-stone-700" : "bg-emerald-800"}`}
          >
            {openSince ? t("clock.out") : t("clock.in")}
          </button>
          {clockRejected.map((c) => (
            <p key={c.id} className="w-full text-red-900" role="alert">
              {t("clock.rejected", { message: c.error ?? "" })}{" "}
              <button type="button" onClick={() => void discard(c.id)} className="rounded border border-red-300 bg-white px-2 py-0.5 text-xs">
                OK
              </button>
            </p>
          ))}
        </div>
      ) : null}

      {!route ? (
        <p className="text-sm text-stone-600">{loading ? t("route.loading") : t("route.empty")}</p>
      ) : showTruck ? (
        <TruckScreen route={route} t={t} />
      ) : effective ? (
        <StopScreen
          route={route}
          visit={effective}
          changes={changes.filter((c) => c.visit_id === effective.id)}
          userId={userId}
          locale={locale}
          timezone={timezone}
          t={t}
          onQueue={(payload) => queue(effective.id, payload)}
          onDiscard={discard}
          onBack={() => router.push("/tech")}
        />
      ) : (
        <RouteList route={route} changes={changes} fromCache={fromCache} locale={locale} t={t} onRefresh={() => void refresh()} onDiscard={discard} />
      )}
    </div>
  );
}

function RouteList({ route, changes, fromCache, locale, t, onRefresh, onDiscard }: { route: RoutePayload; changes: QueuedChange[]; fromCache: boolean; locale: Locale; t: (k: string, v?: Record<string, string | number>) => string; onRefresh: () => void; onDiscard: (id: string) => Promise<void> }) {
  // Rejections for stops that left the route (the office moved the visit) are shown here, since no stop screen will.
  const strays = changes.filter((c) => c.status === "rejected" && c.visit_id !== CLOCK_VISIT && !route.visits.some((v) => v.id === c.visit_id));
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t("route.title")}</h1>
        <div className="flex gap-2">
          <Link href="/tech?truck=1" className="rounded border border-stone-300 bg-white px-2 py-1 text-xs">
            {t("truck.link")}
          </Link>
          <button type="button" onClick={onRefresh} className="rounded border border-stone-300 bg-white px-2 py-1 text-xs">
            {t("route.refresh")}
          </button>
        </div>
      </div>
      <p className="text-xs text-stone-600">
        {t("route.date", { date: route.date })}
        {fromCache ? ` ${t("route.stale")}` : ""}
      </p>
      {strays.map((c) => (
        <div key={c.id} className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-900" role="alert" data-testid="rejected">
          <p>{t("pending.rejectedOffRoute", { message: rejectionText(t, c.error) })}</p>
          <button type="button" onClick={() => void onDiscard(c.id)} className="mt-1 rounded border border-red-300 bg-white px-2 py-0.5 text-xs">
            OK
          </button>
        </div>
      ))}
      {route.visits.length === 0 ? <p className="rounded border border-stone-200 bg-white p-3 text-sm">{t("route.empty")}</p> : null}
      {route.visits.map((raw) => {
        const v = withLocalChanges(route, raw, changes);
        return (
          <Link key={v.id} href={`/tech?visit=${v.id}`} className="block rounded-lg border border-stone-200 bg-white p-3 shadow-sm" data-testid="route-stop">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">
                  {v.route_position ? `${v.route_position}. ` : ""}
                  {v.account.name}
                </p>
                <p className="text-sm text-stone-700">{v.property.address}</p>
                <p className="text-xs text-stone-500">
                  {v.service_type.name}
                  {v.kind === "reservice" ? `, ${t("route.reservice")}` : ""}
                  {v.interior_only ? `, ${t("route.interiorOnly")}` : ""}
                </p>
              </div>
              <div className="text-right text-xs">
                <span className="rounded bg-stone-100 px-2 py-0.5">{t(`status.${v.status}`)}</span>
                {v.arrival_window !== "any" ? <p className="mt-1 text-amber-800">{t(`route.window.${v.arrival_window}`)}</p> : null}
              </div>
            </div>
            <p className="mt-2 text-sm text-emerald-800">{t("route.open")}</p>
            <span className="sr-only">{locale}</span>
          </Link>
        );
      })}
    </section>
  );
}

/** Spec 18 (MOB-08): what is on the truck, from the cached route, so it works with no signal. */
function TruckScreen({ route, t }: { route: RoutePayload; t: (k: string, v?: Record<string, string | number>) => string }) {
  const truck = route.truck ?? null;
  return (
    <section className="grid gap-2" data-testid="truck-screen">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{truck ? `${t("truck.title")}: ${truck.name}` : t("truck.title")}</h1>
        <Link href="/tech" className="rounded border border-stone-300 bg-white px-2 py-1 text-xs">
          {t("app.back")}
        </Link>
      </div>
      {!truck ? (
        <p className="rounded border border-stone-200 bg-white p-3 text-sm">{t("truck.none")}</p>
      ) : truck.items.length === 0 ? (
        <p className="rounded border border-stone-200 bg-white p-3 text-sm">{t("truck.empty")}</p>
      ) : (
        <ul className="grid gap-1">
          {truck.items.map((i) => (
            <li key={i.product_id} className="flex items-center justify-between rounded border border-stone-200 bg-white p-2 text-sm" data-testid="truck-item">
              <span>{i.product_name}</span>
              <span className={i.flag ? "font-semibold text-red-800" : ""}>
                {i.on_hand} {i.unit.replace("_", " ")}
                {i.flag ? ` (${t(i.flag === "low" ? "truck.low" : "truck.negative")})` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type StopProps = {
  route: RoutePayload;
  visit: RouteVisit;
  changes: QueuedChange[];
  userId: string;
  locale: Locale;
  timezone: string;
  t: (k: string, v?: Record<string, string | number>) => string;
  onQueue: (payload: ChangePayload) => Promise<void>;
  onDiscard: (id: string) => Promise<void>;
  onBack: () => void;
};

function StopScreen({ route, visit, changes, userId, locale, timezone, t, onQueue, onDiscard, onBack }: StopProps) {
  const [gaps, setGaps] = useState<string[] | null>(null);
  const rejected = changes.filter((c) => c.status === "rejected");
  const done = visit.status === "completed";
  const nameOf = (id: string) => visit.crew.find((c) => c.user_id === id)?.name ?? route.technician.name;

  async function complete() {
    const missing = gapsFor(visit);
    setGaps(missing);
    if (missing.length) return;
    await onQueue({ kind: "complete", at: new Date().toISOString() });
  }

  return (
    <section className="grid gap-3">
      <button type="button" onClick={onBack} className="justify-self-start text-sm text-emerald-800 underline">
        {t("app.back")}
      </button>
      <header className="rounded-lg border border-stone-200 bg-white p-3">
        <h1 className="text-lg font-semibold">{visit.account.name}</h1>
        <p className="text-sm">{visit.property.address}</p>
        <p className="text-xs text-stone-600">
          {visit.service_type.name}
          {visit.kind === "reservice" ? ` (${t("route.reservice")}${visit.reservice_reason ? `: ${visit.reservice_reason}` : ""})` : ""}
          {visit.interior_only ? `, ${t("route.interiorOnly")}` : ""}
          {visit.arrival_window !== "any" ? `, ${t(`route.window.${visit.arrival_window}`)}` : ""}
        </p>
        {visit.dispatch_notes ? (
          <p className="mt-1 text-sm">
            <span className="font-medium">{t("route.notes")}:</span> {visit.dispatch_notes}
          </p>
        ) : null}
        {visit.property.access_notes ? (
          <p className="text-sm">
            <span className="font-medium">{t("route.access")}:</span> {visit.property.access_notes}
          </p>
        ) : null}
        <p className="text-xs text-stone-500">
          {t("route.crew")}: {visit.crew.map((c) => `${c.name} (${c.role})`).join(", ") || route.technician.name}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="rounded bg-stone-100 px-2 py-0.5 text-xs" data-testid="stop-status">
            {t(`status.${visit.status}`)}
          </span>
          {visit.status === "scheduled" ? (
            <button type="button" onClick={() => void onQueue({ kind: "en_route", at: new Date().toISOString() })} className="rounded bg-emerald-900 px-3 py-2 text-sm font-medium text-white">
              {t("stop.onMyWay")}
            </button>
          ) : null}
          {visit.status === "scheduled" || visit.status === "en_route" ? (
            <button type="button" onClick={() => void onQueue({ kind: "arrive", at: new Date().toISOString() })} className="rounded bg-emerald-900 px-3 py-2 text-sm font-medium text-white">
              {t("stop.arrived")}
            </button>
          ) : null}
          {visit.captured.arrived_at ? <span className="text-xs text-stone-600">{t("stop.arrivedAt", { time: clock(visit.captured.arrived_at, locale, timezone) })}</span> : null}
          {done ? <span className="text-xs text-emerald-800">{t("stop.completed", { time: clock(visit.captured.departed_at, locale, timezone) })}</span> : null}
        </div>
      </header>

      {rejected.map((c) => (
        <div key={c.id} className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-900" role="alert" data-testid="rejected">
          <p>{t("pending.rejected", { message: rejectionText(t, c.error) })}</p>
          {c.gaps?.length ? (
            <ul className="list-disc pl-5">
              {c.gaps.map((g) => (
                <li key={g}>{gapMessage(locale, g)}</li>
              ))}
            </ul>
          ) : null}
          <button type="button" onClick={() => void onDiscard(c.id)} className="mt-1 rounded border border-red-300 bg-white px-2 py-0.5 text-xs">
            OK
          </button>
        </div>
      ))}

      <SpecialtySection visit={visit} t={t} onQueue={onQueue} disabled={done} />
      <DevicesSection visit={visit} t={t} onQueue={onQueue} disabled={done} />
      <ProductsSection route={route} visit={visit} userId={userId} t={t} onQueue={onQueue} disabled={done} nameOf={nameOf} />
      <AreasSection visit={visit} t={t} onQueue={onQueue} disabled={done} />
      <ConditionsSection visit={visit} t={t} onQueue={onQueue} disabled={done} locale={locale} timezone={timezone} />
      <NotesSection visit={visit} t={t} onQueue={onQueue} disabled={done} />
      <SummarySection visit={visit} t={t} onQueue={onQueue} disabled={done} locale={locale} />
      <PhotosSection visit={visit} t={t} onQueue={onQueue} disabled={done} />
      <SignatureSection visit={visit} t={t} onQueue={onQueue} disabled={done} locale={locale} timezone={timezone} />

      {visit.billing_mode === "per_visit" && visit.price_cents > 0 ? (
        <PaymentSection visit={visit} changes={changes} t={t} onQueue={onQueue} />
      ) : null}

      {!done ? (
        <section className="rounded-lg border border-stone-200 bg-white p-3">
          {gaps && gaps.length ? (
            <div className="mb-2 rounded border border-amber-200 bg-amber-50 p-2 text-sm" data-testid="gaps">
              <p className="font-medium">{t("stop.gaps")}</p>
              <ul className="list-disc pl-5">
                {gaps.map((g) => (
                  <li key={g}>{gapMessage(locale, g)}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <button type="button" onClick={() => void complete()} className="w-full rounded bg-emerald-900 px-3 py-3 text-base font-semibold text-white">
            {t("stop.complete")}
          </button>
        </section>
      ) : (
        <Link href={`/tech/visits/${visit.id}/summary`} className="rounded border border-stone-300 bg-white px-3 py-2 text-center text-sm">
          {t("stop.summary")}
        </Link>
      )}
    </section>
  );
}

type SectionProps = { visit: RouteVisit; t: (k: string, v?: Record<string, string | number>) => string; onQueue: (payload: ChangePayload) => Promise<void>; disabled: boolean };

function ProductsSection({ route, visit, userId, t, onQueue, disabled, nameOf }: SectionProps & { route: RoutePayload; userId: string; nameOf: (id: string) => string }) {
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [productId, setProductId] = useState("");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<string>("fl_oz");
  const [carrierAmount, setCarrierAmount] = useState("");
  const [carrierUnit, setCarrierUnit] = useState<string>("gal");
  const [site, setSite] = useState("");
  const [location, setLocation] = useState("");
  const [pests, setPests] = useState("");
  const [appliedBy, setAppliedBy] = useState(userId);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const product = route.products.find((p) => p.id === productId) ?? null;
  const check =
    product && amount && site && carrierAmount
      ? checkLabelRate(product, { site, amount: Number(amount), amountUnit: unit, per: Number(carrierAmount), perUnit: carrierUnit })
      : null;
  const outside = check ? check.status === "below_label" || check.status === "above_label" : false;

  const onCode = useCallback(
    (code: string) => {
      const match = route.products.find((p) => p.upc && p.upc === code);
      if (match) {
        setProductId(match.id);
        setUnit(match.unit);
        setScanning(false);
        setScanNote(null);
      } else {
        setScanNote(t("products.scanNoMatch"));
      }
    },
    [route.products, t],
  );

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!product || !(Number(amount) > 0) || !site) return;
    if (outside && !acknowledged) {
      setError(t("products.acknowledgeNeeded"));
      return;
    }
    await onQueue({
      kind: "product",
      product_id: product.id,
      applied_by: appliedBy,
      site_treated: site,
      location_description: location || null,
      amount,
      amount_unit: unit,
      carrier_amount: carrierAmount || null,
      carrier_unit: carrierAmount ? carrierUnit : null,
      target_pests: pests.split(",").map((p) => p.trim()).filter(Boolean),
      label_check: check ? { status: check.status, reason: check.reason } : null,
      recorded_at: new Date().toISOString(),
    });
    setOpen(false);
    setProductId("");
    setAmount("");
    setCarrierAmount("");
    setSite("");
    setLocation("");
    setPests("");
    setAcknowledged(false);
    setError(null);
  }

  const labelText = (status: string | undefined) =>
    status === "ok" ? t("products.labelOk") : status === "below_label" ? t("products.labelBelow") : status === "above_label" ? t("products.labelAbove") : t("products.labelUnknown");

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-3" data-testid="products">
      <h2 className="font-semibold">{t("products.title")}</h2>
      {visit.captured.products.length === 0 ? <p className="text-sm text-stone-500">{t("products.none")}</p> : null}
      <ul className="grid gap-1 text-sm">
        {visit.captured.products.map((p) => (
          <li key={p.id} className="rounded border border-stone-100 p-2">
            <p className="font-medium">
              {p.product_name} <span className="font-mono text-xs text-stone-500">{p.epa_reg_no}</span>
            </p>
            <p className="text-stone-700">
              {p.amount} {p.amount_unit.replace("_", " ")}
              {p.carrier_amount ? ` / ${p.carrier_amount} ${p.carrier_unit?.replace("_", " ")}` : ""}, {p.site_treated}
              {p.target_pests.length ? `, ${p.target_pests.join(", ")}` : ""}, {nameOf(p.applied_by)}
            </p>
            {p.label_check ? <p className={`text-xs ${p.label_check.status === "ok" ? "text-emerald-800" : p.label_check.status === "no_rate_on_file" ? "text-stone-500" : "text-amber-800"}`}>{labelText(p.label_check.status)}</p> : null}
          </li>
        ))}
      </ul>
      {!disabled ? (
        open ? (
          <form onSubmit={save} className="mt-2 grid gap-2 border-t border-stone-100 pt-2 text-sm">
            <label className="grid gap-1">
              <span>{t("products.product")}</span>
              <select value={productId} onChange={(e) => { setProductId(e.target.value); const p = route.products.find((x) => x.id === e.target.value); if (p) setUnit(p.unit); }} className="rounded border border-stone-300 px-2 py-2" required>
                <option value="">...</option>
                {route.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.epa_reg_no}){p.restricted_use ? ` [${t("products.restricted")}]` : ""}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => setScanning((s) => !s)} className="justify-self-start rounded border border-stone-300 px-2 py-1 text-xs">
              {t("products.scan")}
            </button>
            {scanning ? <Scanner onCode={onCode} onClose={() => setScanning(false)} unsupportedText={t("products.scanUnsupported")} closeText="OK" /> : null}
            {scanNote ? <p className="text-xs text-amber-800">{scanNote}</p> : null}
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1">
                <span>{t("products.amount")}</span>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="rounded border border-stone-300 px-2 py-2" required />
              </label>
              <label className="grid gap-1">
                <span>{t("products.unit")}</span>
                <select value={unit} onChange={(e) => setUnit(e.target.value)} className="rounded border border-stone-300 px-2 py-2">
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span>{t("products.carrier")}</span>
                <input value={carrierAmount} onChange={(e) => setCarrierAmount(e.target.value)} inputMode="decimal" className="rounded border border-stone-300 px-2 py-2" />
              </label>
              <label className="grid gap-1">
                <span>&nbsp;</span>
                <select value={carrierUnit} onChange={(e) => setCarrierUnit(e.target.value)} className="rounded border border-stone-300 px-2 py-2" aria-label="carrier unit">
                  {CARRIER_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="grid gap-1">
              <span>{t("products.site")}</span>
              <input value={site} onChange={(e) => setSite(e.target.value)} className="rounded border border-stone-300 px-2 py-2" required list="sites" />
              <datalist id="sites">
                {visit.treatment_areas.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </label>
            <label className="grid gap-1">
              <span>{t("products.location")}</span>
              <input value={location} onChange={(e) => setLocation(e.target.value)} className="rounded border border-stone-300 px-2 py-2" />
            </label>
            <label className="grid gap-1">
              <span>{t("products.pests")}</span>
              <input value={pests} onChange={(e) => setPests(e.target.value)} className="rounded border border-stone-300 px-2 py-2" required />
            </label>
            <label className="grid gap-1">
              <span>{t("products.appliedBy")}</span>
              <select value={appliedBy} onChange={(e) => setAppliedBy(e.target.value)} className="rounded border border-stone-300 px-2 py-2">
                {(visit.crew.length ? visit.crew : [{ user_id: userId, name: route.technician.name, role: "lead" as const, credential: null }]).map((c) => (
                  <option key={c.user_id} value={c.user_id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {check ? (
              <p className={`text-xs ${check.status === "ok" ? "text-emerald-800" : outside ? "text-amber-800" : "text-stone-500"}`} data-testid="label-check">
                {labelText(check.status)}
                {check.rate ? ` (${check.rate.min_rate ?? ""}${check.rate.min_rate !== null && check.rate.max_rate !== null ? " to " : ""}${check.rate.max_rate ?? ""} ${check.rate.rate_unit})` : ""}
              </p>
            ) : null}
            {outside ? (
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /> {t("products.acknowledge")}
              </label>
            ) : null}
            {error ? <p className="text-xs text-red-800">{error}</p> : null}
            <button type="submit" className="rounded bg-emerald-900 px-3 py-2 font-medium text-white">
              {t("products.save")}
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="mt-2 rounded border border-emerald-800 px-3 py-2 text-sm text-emerald-900">
            {t("products.add")}
          </button>
        )
      ) : null}
    </section>
  );
}

function AreasSection({ visit, t, onQueue, disabled }: SectionProps) {
  const [areas, setAreas] = useState<string[]>(visit.captured.areas_treated);
  const [pests, setPests] = useState(visit.captured.target_pests.join(", "));
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-3 text-sm" data-testid="areas">
      <h2 className="font-semibold">{t("areas.title")}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onQueue({ kind: "areas_pests", areas_treated: areas, target_pests: pests.split(",").map((p) => p.trim()).filter(Boolean) });
        }}
        className="grid gap-2"
      >
        <fieldset disabled={disabled}>
          <legend className="text-stone-700">{t("areas.areas")}</legend>
          <div className="flex flex-wrap gap-3">
            {TREATMENT_AREAS.map((a) => (
              <label key={a} className="flex items-center gap-1">
                <input type="checkbox" checked={areas.includes(a)} onChange={(e) => setAreas((prev) => (e.target.checked ? [...prev, a] : prev.filter((x) => x !== a)))} /> {t(`area.${a}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="grid gap-1">
          <span>{t("areas.pests")}</span>
          <input value={pests} onChange={(e) => setPests(e.target.value)} disabled={disabled} className="rounded border border-stone-300 px-2 py-2" />
        </label>
        {!disabled ? (
          <button type="submit" className="justify-self-start rounded border border-emerald-800 px-3 py-2 text-emerald-900">
            {t("areas.save")}
          </button>
        ) : null}
      </form>
    </section>
  );
}

function ConditionsSection({ visit, t, onQueue, disabled, locale, timezone }: SectionProps & { locale: Locale; timezone: string }) {
  const c = visit.captured.conditions;
  const [temp, setTemp] = useState(c?.temperature_f?.toString() ?? "");
  const [wind, setWind] = useState(c?.wind_mph?.toString() ?? "");
  const [dir, setDir] = useState(c?.wind_direction ?? "");
  const [sky, setSky] = useState(c?.sky ?? "");
  const [note, setNote] = useState<string | null>(null);

  async function fillFromWeather() {
    if (visit.property.lat === null || visit.property.lng === null) {
      setNote(t("conditions.weatherFailed"));
      return;
    }
    try {
      const res = await fetch(`/api/tech/weather?lat=${visit.property.lat}&lng=${visit.property.lng}`);
      const body = (await res.json()) as { conditions: Conditions | null };
      if (!body.conditions) throw new Error("none");
      setTemp(body.conditions.temperature_f?.toString() ?? "");
      setWind(body.conditions.wind_mph?.toString() ?? "");
      setDir(body.conditions.wind_direction ?? "");
      setSky(body.conditions.sky ?? "");
      setNote(t("conditions.fromWeather", { time: clock(body.conditions.captured_at, locale, timezone) }));
      await onQueue({ kind: "conditions", conditions: body.conditions });
    } catch {
      setNote(t("conditions.weatherFailed"));
    }
  }

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-3 text-sm" data-testid="conditions">
      <h2 className="font-semibold">{t("conditions.title")}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onQueue({
            kind: "conditions",
            conditions: { temperature_f: temp ? Number(temp) : null, wind_mph: wind ? Number(wind) : null, wind_direction: dir || null, sky: sky || null, captured_at: new Date().toISOString(), source: "manual" },
          });
        }}
        className="grid grid-cols-2 gap-2"
      >
        <label className="grid gap-1">
          <span>{t("conditions.temperature")}</span>
          <input value={temp} onChange={(e) => setTemp(e.target.value)} inputMode="decimal" disabled={disabled} className="rounded border border-stone-300 px-2 py-2" />
        </label>
        <label className="grid gap-1">
          <span>{t("conditions.wind")}</span>
          <input value={wind} onChange={(e) => setWind(e.target.value)} inputMode="decimal" disabled={disabled} className="rounded border border-stone-300 px-2 py-2" />
        </label>
        <label className="grid gap-1">
          <span>{t("conditions.direction")}</span>
          <input value={dir} onChange={(e) => setDir(e.target.value)} disabled={disabled} className="rounded border border-stone-300 px-2 py-2" />
        </label>
        <label className="grid gap-1">
          <span>{t("conditions.sky")}</span>
          <input value={sky} onChange={(e) => setSky(e.target.value)} disabled={disabled} className="rounded border border-stone-300 px-2 py-2" />
        </label>
        {!disabled ? (
          <div className="col-span-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => void fillFromWeather()} className="rounded border border-stone-300 px-3 py-2">
              {t("conditions.fillFromWeather")}
            </button>
            <button type="submit" className="rounded border border-emerald-800 px-3 py-2 text-emerald-900">
              {t("conditions.save")}
            </button>
          </div>
        ) : null}
        {note ? <p className="col-span-2 text-xs text-stone-600">{note}</p> : null}
      </form>
    </section>
  );
}

function NotesSection({ visit, t, onQueue, disabled }: SectionProps) {
  const [kind, setKind] = useState("note");
  const [content, setContent] = useState("");
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-3 text-sm" data-testid="notes">
      <h2 className="font-semibold">{t("notes.title")}</h2>
      {visit.captured.notes.length === 0 ? <p className="text-stone-500">{t("notes.none")}</p> : null}
      <ul className="grid gap-1">
        {visit.captured.notes.filter((n) => n.kind !== "customer_summary").map((n) => (
          <li key={n.id} className="rounded border border-stone-100 p-2">
            <span className="text-xs text-stone-500">{t(`notes.kind.${n.kind}`)}</span>
            <p>{n.content}</p>
          </li>
        ))}
      </ul>
      {!disabled ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!content.trim()) return;
            void onQueue({ kind: "note", note_kind: kind, content: content.trim(), recorded_at: new Date().toISOString() });
            setContent("");
          }}
          className="mt-2 grid gap-2"
        >
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded border border-stone-300 px-2 py-2" aria-label={t("notes.title")}>
            {["note", "recommendation", "condition_found", "access"].map((k) => (
              <option key={k} value={k}>
                {t(`notes.kind.${k}`)}
              </option>
            ))}
          </select>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={2} placeholder={t("notes.placeholder")} className="rounded border border-stone-300 px-2 py-2" aria-label={t("notes.placeholder")} />
          <button type="submit" className="justify-self-start rounded border border-emerald-800 px-3 py-2 text-emerald-900">
            {t("notes.add")}
          </button>
        </form>
      ) : null}
    </section>
  );
}

/**
 * Spec 21 rule 3: the note for the customer. "Draft it from my notes" asks the assistant (online only) for a draft from
 * this stop's capture; the technician edits it and saves it, and only what they saved goes with the visit summary.
 */
function SummarySection({ visit, t, onQueue, disabled, locale }: SectionProps & { locale: string }) {
  const saved = [...visit.captured.notes].reverse().find((n) => n.kind === "customer_summary") ?? null;
  const [text, setText] = useState("");
  const [drafted, setDrafted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function draft() {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setNote(t("summary.offline"));
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const c = visit.captured;
      const res = await fetch("/api/tech/summary-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          visit_id: visit.id,
          language: locale === "es" ? "es" : "en",
          capture: {
            notes: c.notes.filter((n) => n.kind === "note").map((n) => n.content),
            conditions: c.notes.filter((n) => n.kind === "condition_found").map((n) => n.content),
            recommendations: c.notes.filter((n) => n.kind === "recommendation").map((n) => n.content),
            areas: c.areas_treated.map((a) => a.replace(/_/g, " ")),
            pests: c.target_pests,
            products: c.products.map((p) => p.product_name),
          },
        }),
      });
      const body = (await res.json()) as { text?: string; error?: string };
      if (body.text) {
        setText(body.text);
        setDrafted(true);
        setNote(t("summary.drafted"));
      } else setNote(body.error ?? t("summary.offline"));
    } catch {
      setNote(t("summary.offline"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-3 text-sm" data-testid="customer-summary">
      <h2 className="font-semibold">{t("summary.title")}</h2>
      {saved ? (
        <p className="mt-1 rounded border border-stone-100 p-2" data-testid="customer-summary-saved">
          {saved.content}
        </p>
      ) : null}
      {!disabled ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            void onQueue({ kind: "note", note_kind: "customer_summary", content: text.trim(), recorded_at: new Date().toISOString(), ai_drafted: drafted });
            setText("");
            setDrafted(false);
            setNote(t("summary.saved"));
          }}
          className="mt-2 grid gap-2"
        >
          <button type="button" onClick={() => void draft()} disabled={busy} className="justify-self-start rounded border border-stone-300 px-3 py-2">
            {busy ? t("summary.drafting") : t("summary.draft")}
          </button>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={t("summary.placeholder")} className="rounded border border-stone-300 px-2 py-2" aria-label={t("summary.title")} />
          <button type="submit" className="justify-self-start rounded border border-emerald-800 px-3 py-2 text-emerald-900">
            {t("summary.save")}
          </button>
        </form>
      ) : null}
      {note ? <p className="mt-1 text-xs text-stone-600" data-testid="customer-summary-note">{note}</p> : null}
    </section>
  );
}

function PhotosSection({ visit, t, onQueue, disabled }: SectionProps) {
  const [kind, setKind] = useState("other");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError(t("photos.tooLarge"));
      return;
    }
    const dataUrl = file.size > 300 * 1024 ? await shrinkImage(file) : await readFileAsDataUrl(file);
    await onQueue({ kind: "photo", photo_kind: kind, caption: caption || null, taken_at: new Date().toISOString(), data_url: dataUrl });
    setCaption("");
    setError(null);
  }

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-3 text-sm" data-testid="photos">
      <h2 className="font-semibold">{t("photos.title")}</h2>
      {visit.captured.photos.length === 0 ? <p className="text-stone-500">{t("photos.none")}</p> : null}
      <ul className="flex flex-wrap gap-2">
        {visit.captured.photos.map((p) => (
          <li key={p.id} className="rounded border border-stone-100 p-1 text-xs">
            {p.file_id.startsWith("local:") ? <span className="block h-16 w-16 bg-stone-200" /> : <img src={`/api/files/${p.file_id}`} alt={p.caption ?? t(`photos.kind.${p.kind}`)} className="h-16 w-16 object-cover" />}
            <span>{t(`photos.kind.${p.kind}`)}</span>
          </li>
        ))}
      </ul>
      {!disabled ? (
        <div className="mt-2 grid gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded border border-stone-300 px-2 py-2" aria-label={t("photos.title")}>
            {["before", "after", "posting", "device", "other"].map((k) => (
              <option key={k} value={k}>
                {t(`photos.kind.${k}`)}
              </option>
            ))}
          </select>
          <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder={t("photos.caption")} className="rounded border border-stone-300 px-2 py-2" aria-label={t("photos.caption")} />
          <label className="rounded border border-emerald-800 px-3 py-2 text-center text-emerald-900">
            {t("photos.add")}
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} data-testid="photo-input" />
          </label>
          {error ? <p className="text-xs text-red-800">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function PaymentSection({ visit, changes, t, onQueue }: { visit: RouteVisit; changes: QueuedChange[]; t: SectionProps["t"]; onQueue: SectionProps["onQueue"] }) {
  const [method, setMethod] = useState<"cash" | "check">("cash");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const taken = changes.filter((c) => c.payload.kind === "payment" && c.status !== "rejected");
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-3 text-sm" data-testid="payment">
      <h2 className="font-semibold">{t("payment.title")}</h2>
      <p className="text-stone-600">{t("payment.perVisit", { amount: formatCents(visit.price_cents) })}</p>
      {taken.map((c) => {
        const p = c.payload as Extract<ChangePayload, { kind: "payment" }>;
        return (
          <p key={c.id} className="text-emerald-800" data-testid="payment-taken">
            {t("payment.taken", { amount: formatCents(p.amount_cents), method: t(`payment.${p.method}`) })}
            {c.status === "pending" ? ` (${t("pending.queued")})` : ""}
          </p>
        );
      })}
      {visit.status === "completed" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const cents = Math.round(Number(amount) * 100);
            if (!Number.isInteger(cents) || cents <= 0) return;
            void onQueue({ kind: "payment", method, amount_cents: cents, reference: reference.trim() || null, received_at: new Date().toISOString() });
            setAmount("");
            setReference("");
          }}
          className="mt-2 grid grid-cols-2 gap-2"
        >
          <label className="grid gap-1">
            <span>{t("payment.method")}</span>
            <select value={method} onChange={(e) => setMethod(e.target.value as "cash" | "check")} className="rounded border border-stone-300 px-2 py-2">
              <option value="cash">{t("payment.cash")}</option>
              <option value="check">{t("payment.check")}</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span>{t("payment.amount")}</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="rounded border border-stone-300 px-2 py-2" required />
          </label>
          <label className="col-span-2 grid gap-1">
            <span>{t("payment.reference")}</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} className="rounded border border-stone-300 px-2 py-2" />
          </label>
          <button type="submit" className="col-span-2 justify-self-start rounded border border-emerald-800 px-3 py-2 text-emerald-900">
            {t("payment.record")}
          </button>
        </form>
      ) : null}
    </section>
  );
}

function SignatureSection({ visit, t, onQueue, disabled, locale, timezone }: SectionProps & { locale: Locale; timezone: string }) {
  const [name, setName] = useState(visit.captured.signature?.signer_name ?? visit.account.name);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const existing = visit.captured.signature;
  const [resign, setResign] = useState(false);
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-3 text-sm" data-testid="signature">
      <h2 className="font-semibold">{t("signature.title")}</h2>
      {existing ? (
        <p className="text-emerald-800" data-testid="signature-saved">
          {t("signature.saved", { name: existing.signer_name, time: clock(existing.signed_at, locale, timezone) })}
        </p>
      ) : null}
      {!disabled && (!existing || resign) ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!dataUrl || !name.trim()) return;
            void onQueue({ kind: "signature", signer_name: name.trim(), signed_at: new Date().toISOString(), data_url: dataUrl });
            setDataUrl(null);
            setResign(false);
          }}
          className="mt-2 grid gap-2"
        >
          <SignaturePad onChange={setDataUrl} label={t("signature.draw")} />
          <label className="grid gap-1">
            <span>{t("signature.name")}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="rounded border border-stone-300 px-2 py-2" />
          </label>
          <button type="submit" disabled={!dataUrl} className="justify-self-start rounded border border-emerald-800 px-3 py-2 text-emerald-900 disabled:opacity-50">
            {t("signature.save")}
          </button>
        </form>
      ) : !disabled ? (
        <button type="button" onClick={() => setResign(true)} className="mt-2 justify-self-start rounded border border-stone-300 px-3 py-2">
          {t("signature.again")}
        </button>
      ) : null}
    </section>
  );
}
