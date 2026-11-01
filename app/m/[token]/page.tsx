import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { withAnon } from "@/lib/db";

export const metadata: Metadata = { title: "Your message", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type View = { subject: string | null; body: string; body_html: string | null; channel: string; company_name: string; sent_at: Date; purpose: string };

/** A sent message's content, by its link (spec 11 rule 13): the summary or notice for a customer who got a text with a
 *  link, or who wants the email in a browser. Only the message and the company's name are reachable from here. */
export default async function MessagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{40,96}$/.test(token)) notFound();
  const [view] = await withAnon((tx) => tx<View[]>`select * from app.message_view(${token})`);
  if (!view) notFound();
  return (
    <main className="mx-auto max-w-2xl p-6">
      <article className="rounded-lg border border-stone-200 bg-white p-6 text-sm leading-6 shadow-sm" data-testid="message-view">
        <p className="text-xs text-stone-500">
          {view.company_name}, {new Date(view.sent_at).toLocaleDateString("en-US", { dateStyle: "medium" })}
        </p>
        {view.subject ? <h1 className="mt-1 text-lg font-semibold">{view.subject}</h1> : null}
        {view.body_html ? (
          // Rendered from the company's templates with every variable escaped when the message was written.
          <div className="message-html mt-4 space-y-3 [&_h2]:mt-4 [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc" dangerouslySetInnerHTML={{ __html: view.body_html }} />
        ) : (
          <p className="mt-4 whitespace-pre-wrap">{view.body}</p>
        )}
      </article>
    </main>
  );
}
