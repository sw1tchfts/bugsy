import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ARRIVAL_WINDOWS, ARRIVAL_WINDOW_LABELS } from "@/lib/dispatch/checks";
import { HONEYPOT } from "@/lib/portal/intake";
import { publicForm } from "@/lib/portal/forms";
import { submitBookingForm } from "./actions";

export const metadata: Metadata = { title: "Book a visit", robots: { index: false } };

const input = "w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm";

/** The hosted booking form (spec 16 rule 8), made to sit in an iframe on the company's own website. */
export default async function BookingForm({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ sent?: string; error?: string; ref?: string }> }) {
  const { key } = await params;
  const q = await searchParams;
  const form = await publicForm(key);
  if (!form) notFound();
  return (
    <main className="mx-auto grid max-w-lg gap-4 p-4">
      <h1 className="text-xl font-semibold">{form.name}</h1>
      <p className="text-sm text-stone-600">{form.tenant_name}</p>
      {q.sent ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm" role="status" data-testid="form-thanks">
          {form.thank_you ?? "Thank you. We will call you to confirm a day."}
        </p>
      ) : (
        <form action={submitBookingForm} className="grid gap-3">
          {q.error ? (
            <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="alert">
              {q.error}
            </p>
          ) : null}
          <input type="hidden" name="key" value={key} />
          {q.ref && /^[A-Za-z0-9]{4,16}$/.test(q.ref) ? <input type="hidden" name="ref" value={q.ref} /> : null}
          <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
            <label>
              Leave this empty <input name={HONEYPOT} tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            Your name
            <input name="name" required maxLength={200} className={input} autoComplete="name" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              Email
              <input name="email" type="email" maxLength={200} className={input} autoComplete="email" />
            </label>
            <label className="grid gap-1 text-sm">
              Phone
              <input name="phone" type="tel" maxLength={40} className={input} autoComplete="tel" />
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            Service address
            <input name="line1" required maxLength={200} className={input} autoComplete="address-line1" />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="grid gap-1 text-sm">
              City
              <input name="city" maxLength={100} className={input} autoComplete="address-level2" />
            </label>
            <label className="grid gap-1 text-sm">
              State
              <input name="state_code" maxLength={2} className={input} autoComplete="address-level1" />
            </label>
            <label className="grid gap-1 text-sm">
              ZIP
              <input name="postal_code" maxLength={10} className={input} autoComplete="postal-code" />
            </label>
          </div>
          {form.services.length ? (
            <label className="grid gap-1 text-sm">
              Service
              <select name="service_type_id" required className={input}>
                {form.services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {form.ask_preferred_date ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                Preferred day
                <input name="preferred_date" type="date" className={input} />
              </label>
              <label className="grid gap-1 text-sm">
                Time of day
                <select name="arrival_window" defaultValue="any" className={input}>
                  {ARRIVAL_WINDOWS.map((w) => (
                    <option key={w} value={w}>
                      {ARRIVAL_WINDOW_LABELS[w]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          <label className="grid gap-1 text-sm">
            What are you seeing?
            <textarea name="message" rows={3} maxLength={2000} className={input} />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="sms_consent" className="mt-1" /> Text me about this request (message and data rates may apply; reply STOP to stop).
          </label>
          <button type="submit" className="rounded-md bg-emerald-800 px-4 py-2 text-sm font-medium text-white">
            Send
          </button>
        </form>
      )}
    </main>
  );
}
