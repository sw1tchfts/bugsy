"use client";

// Specialty work at a stop (spec 15): the bed bug prep check, wildlife captures with the job's authorization, and the
// materials used. Each is a queued change, so it works offline and syncs in order with the rest of the stop.
import { useState } from "react";
import { DISPOSITIONS, materialCents } from "@/lib/specialty/materials";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import type { ChangePayload, RouteVisit } from "@/lib/tech/route-types";

type T = (k: string, v?: Record<string, string | number>) => string;
type Props = { visit: RouteVisit; t: T; onQueue: (payload: ChangePayload) => Promise<void>; disabled: boolean };

const input = "rounded border border-stone-300 px-2 py-2";
const box = "rounded-lg border border-stone-200 bg-white p-3";

function PrepCheck({ visit, t, onQueue, disabled }: Props) {
  const sp = visit.specialty!;
  const [ready, setReady] = useState<boolean>(sp.prep_check?.ready ?? true);
  const [missing, setMissing] = useState<string[]>(sp.prep_check?.missing ?? []);
  const [notes, setNotes] = useState(sp.prep_check?.notes ?? "");
  const needsWhy = !ready && missing.length === 0 && !notes.trim();
  return (
    <section className={box} data-testid="prep-check">
      <h2 className="font-semibold">{t("prep.title")}</h2>
      <p className="text-xs text-stone-600">{t("prep.intro")}</p>
      <ul className="mt-2 grid gap-1 text-sm">
        {sp.prep_checklist.map((item) => (
          <li key={item}>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                disabled={disabled || ready}
                checked={!ready && missing.includes(item)}
                onChange={(e) => setMissing((m) => (e.target.checked ? [...m, item] : m.filter((x) => x !== item)))}
                aria-label={`${t("prep.missing")}: ${item}`}
              />
              <span>{item}</span>
            </label>
          </li>
        ))}
      </ul>
      {sp.prep_check ? (
        <p className={`mt-2 text-sm ${sp.prep_check.ready ? "text-emerald-800" : "text-amber-800"}`} data-testid="prep-saved">
          {t("prep.saved", { result: t(sp.prep_check.ready ? "prep.result.ready" : "prep.result.notReady") })}
        </p>
      ) : null}
      {!disabled ? (
        <form
          className="mt-2 grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (needsWhy) return;
            void onQueue({ kind: "prep_check", ready, missing: ready ? [] : missing, notes: notes.trim() || null, at: new Date().toISOString() });
          }}
        >
          <div className="flex gap-2" role="radiogroup" aria-label={t("prep.title")}>
            {[true, false].map((v) => (
              <label key={String(v)} className={`rounded border px-3 py-2 text-sm ${ready === v ? "border-emerald-800 bg-emerald-50" : "border-stone-300"}`}>
                <input type="radio" name="prep-ready" className="sr-only" checked={ready === v} onChange={() => setReady(v)} />
                {t(v ? "prep.ready" : "prep.notReady")}
              </label>
            ))}
          </div>
          {!ready ? <p className="text-xs text-stone-600">{t("prep.missing")}</p> : null}
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("prep.notes")} aria-label={t("prep.notes")} className={input} rows={2} />
          {needsWhy ? <p className="text-xs text-amber-800">{t("sync.prepWhy")}</p> : null}
          <button type="submit" disabled={needsWhy} className="justify-self-start rounded bg-emerald-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            {t("prep.save")}
          </button>
        </form>
      ) : null}
    </section>
  );
}

function Captures({ visit, t, onQueue, disabled }: Props) {
  const sp = visit.specialty!;
  const [form, setForm] = useState({ species: "", count: "1", disposition: "relocated", location: "", notes: "" });
  return (
    <section className={box} data-testid="captures">
      <h2 className="font-semibold">{t("captures.title")}</h2>
      <p className={`text-sm ${sp.authorized ? "text-emerald-800" : "text-red-800"}`} role={sp.authorized ? undefined : "alert"}>
        {t(sp.authorized ? "captures.authorized" : "captures.notAuthorized")}
      </p>
      {sp.captures.length ? (
        <ul className="mt-2 grid gap-1 text-sm">
          {sp.captures.map((c) => (
            <li key={c.id}>
              {c.count} x {c.species}: {t(`captures.disposition.${c.disposition}`)}
              {c.location ? ` (${c.location})` : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-stone-600">{t("captures.none")}</p>
      )}
      {!disabled ? (
        <form
          className="mt-2 grid grid-cols-2 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const count = Number(form.count);
            if (!form.species.trim() || !Number.isInteger(count) || count < 1) return;
            void onQueue({
              kind: "capture",
              species: form.species.trim(),
              count,
              disposition: form.disposition,
              location: form.location.trim() || null,
              notes: form.notes.trim() || null,
              at: new Date().toISOString(),
            }).then(() => setForm((f) => ({ ...f, species: "", count: "1", notes: "" })));
          }}
        >
          <input value={form.species} onChange={(e) => setForm({ ...form, species: e.target.value })} placeholder={t("captures.species")} aria-label={t("captures.species")} className={`${input} col-span-2`} required />
          <input value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} inputMode="numeric" aria-label={t("captures.count")} placeholder={t("captures.count")} className={input} required />
          <select value={form.disposition} onChange={(e) => setForm({ ...form, disposition: e.target.value })} aria-label={t("captures.disposition")} className={input}>
            {DISPOSITIONS.map((d) => (
              <option key={d} value={d}>
                {t(`captures.disposition.${d}`)}
              </option>
            ))}
          </select>
          <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder={t("captures.location")} aria-label={t("captures.location")} className={`${input} col-span-2`} />
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t("captures.notes")} aria-label={t("captures.notes")} className={`${input} col-span-2`} />
          <button type="submit" className="col-span-2 justify-self-start rounded bg-emerald-900 px-3 py-2 text-sm font-medium text-white">
            {t("captures.save")}
          </button>
        </form>
      ) : null}
    </section>
  );
}

function Materials({ visit, t, onQueue, disabled }: Props) {
  const sp = visit.specialty!;
  const [form, setForm] = useState({ description: "", quantity: "1", unit: "each", price: "", billable: true });
  const priceCents = form.price.trim() === "" ? 0 : parseDollarsToCents(form.price);
  return (
    <section className={box} data-testid="materials">
      <h2 className="font-semibold">{t("materials.title")}</h2>
      {sp.materials.length ? (
        <ul className="mt-2 grid gap-1 text-sm">
          {sp.materials.map((m) => (
            <li key={m.id}>
              {m.description}: {Number(m.quantity)} {m.unit}
              {m.billable ? `, ${formatCents(materialCents(m.quantity, m.unit_price_cents))}` : ` (${t("materials.notBilled")})`}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-stone-600">{t("materials.none")}</p>
      )}
      {!disabled ? (
        <form
          className="mt-2 grid grid-cols-2 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const quantity = Number(form.quantity);
            if (!form.description.trim() || !(quantity > 0) || priceCents === null) return;
            void onQueue({
              kind: "material",
              description: form.description.trim(),
              quantity: String(quantity),
              unit: form.unit.trim() || "each",
              unit_price_cents: priceCents,
              billable: form.billable,
              at: new Date().toISOString(),
            }).then(() => setForm((f) => ({ ...f, description: "", quantity: "1", price: "" })));
          }}
        >
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t("materials.description")} aria-label={t("materials.description")} className={`${input} col-span-2`} required />
          <input value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} inputMode="decimal" aria-label={t("materials.quantity")} placeholder={t("materials.quantity")} className={input} required />
          <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} aria-label={t("materials.unit")} placeholder={t("materials.unit")} className={input} />
          <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" aria-label={t("materials.price")} placeholder={t("materials.price")} className={input} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.billable} onChange={(e) => setForm({ ...form, billable: e.target.checked })} />
            {t("materials.billable")}
          </label>
          <button type="submit" disabled={priceCents === null} className="col-span-2 justify-self-start rounded bg-emerald-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            {t("materials.save")}
          </button>
        </form>
      ) : null}
    </section>
  );
}

/** The specialty sections a stop needs: prep when its type has a checklist, captures on wildlife work, materials always. */
export function SpecialtySection(props: Props) {
  const sp = props.visit.specialty;
  if (!sp) return null;
  return (
    <>
      {sp.step_label ? <p className="text-sm font-medium text-stone-700">{props.t("specialty.step", { label: sp.step_label })}</p> : null}
      {sp.prep_checklist.length ? <PrepCheck {...props} /> : null}
      {sp.wildlife || sp.captures.length ? <Captures {...props} /> : null}
      <Materials {...props} />
    </>
  );
}
