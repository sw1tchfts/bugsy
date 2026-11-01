import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { withAnon } from "@/lib/db";
import { formatBusinessDate } from "@/lib/dates";
import { answerSurvey } from "./actions";

export const metadata: Metadata = { title: "How did we do?", robots: { index: false } };

/** The post-visit survey (spec 17 rule 9): 0 to 10 and a comment, once. */
export default async function Survey({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ thanks?: string; error?: string }> }) {
  const { token } = await params;
  const q = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();
  const [s] = await withAnon((tx) => tx<{ tenant_name: string; service: string; visit_date: string | null; score: number | null; responded: boolean }[]>`select * from app.survey(${token}::uuid)`);
  if (!s) notFound();
  return (
    <main className="mx-auto grid max-w-lg gap-4 p-4">
      <h1 className="text-xl font-semibold">How did we do?</h1>
      <p className="text-sm text-stone-600">
        {s.tenant_name}: {s.service}
        {s.visit_date ? `, ${formatBusinessDate(String(s.visit_date))}` : ""}
      </p>
      {s.responded || q.thanks ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm" role="status" data-testid="survey-thanks">
          Thank you. Your answer helps us do better.
        </p>
      ) : (
        <form action={answerSurvey} className="grid gap-3">
          <input type="hidden" name="token" value={token} />
          <fieldset>
            <legend className="text-sm">How likely are you to recommend us to a friend? (0 not at all, 10 extremely)</legend>
            <div className="mt-2 flex flex-wrap gap-1">
              {Array.from({ length: 11 }, (_, i) => (
                <label key={i} className="flex h-10 w-10 cursor-pointer items-center justify-center rounded border border-stone-300 bg-white text-sm has-[:checked]:border-emerald-800 has-[:checked]:bg-emerald-50">
                  <input type="radio" name="score" value={i} required className="sr-only" aria-label={String(i)} />
                  {i}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="grid gap-1 text-sm">
            Anything to tell us?
            <textarea name="comment" rows={3} maxLength={2000} className="rounded-md border border-stone-300 px-3 py-2" />
          </label>
          {q.error ? <p className="text-sm text-red-800">Pick a number from 0 to 10.</p> : null}
          <button type="submit" className="rounded-md bg-emerald-800 px-4 py-2 text-sm font-medium text-white">
            Send
          </button>
        </form>
      )}
    </main>
  );
}
