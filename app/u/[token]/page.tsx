import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { withAnon } from "@/lib/db";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const TOKEN = /^[0-9a-f]{40,96}$/;

async function unsubscribe(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  if (!TOKEN.test(token)) notFound();
  await withAnon((tx) => tx`select app.unsubscribe(${token})`);
  redirect(`/u/${token}?done=1`);
}

/** The unsubscribe link in campaign email (spec 11 rule 5). Opening it changes nothing, so a mail scanner that follows
 *  links cannot unsubscribe anyone; the button does. */
export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  if (!TOKEN.test(token)) notFound();
  const [view] = await withAnon((tx) => tx<{ company_name: string; channel: string }[]>`select company_name, channel from app.message_view(${token})`);
  if (!view || view.channel !== "email") notFound();
  return (
    <main className="mx-auto max-w-lg p-6">
      <div className="rounded-lg border border-stone-200 bg-white p-6 text-sm shadow-sm" data-testid="unsubscribe">
        {done ? (
          <>
            <h1 className="text-lg font-semibold">You are unsubscribed</h1>
            <p className="mt-2 text-stone-600">{view.company_name} will send you no more promotional email. Messages about your service, such as visit reminders and invoices, still arrive.</p>
          </>
        ) : (
          <form action={unsubscribe}>
            <input type="hidden" name="token" value={token} />
            <h1 className="text-lg font-semibold">Unsubscribe from {view.company_name}</h1>
            <p className="mt-2 text-stone-600">Stop promotional email from {view.company_name}. Visit reminders and invoices still arrive.</p>
            <button type="submit" className="mt-4 rounded-md bg-stone-900 px-4 py-2 text-white">
              Unsubscribe
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
