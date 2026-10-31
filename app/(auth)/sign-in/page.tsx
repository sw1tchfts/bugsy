import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button, Field, Input, Notice, errorMessage } from "@/components/ui";
import { getSession } from "@/lib/auth/session";
import { sendMagicLink, signInWithPassword } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

type Search = { error?: string; next?: string; sent?: string; email?: string };

export default async function SignInPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const next = params.next && params.next.startsWith("/") ? params.next : "/";
  if (await getSession()) redirect(next);
  const error = errorMessage(params.error);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-12">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Bugsy</p>
        <h1 className="mt-1 text-2xl font-semibold">Sign in</h1>
      </div>

      {error ? <Notice kind="error">{error}</Notice> : null}
      {params.sent ? <Notice kind="success">Check {params.email} for a sign-in link.</Notice> : null}

      <form action={signInWithPassword} className="grid gap-4 rounded-md border border-stone-200 bg-white p-5">
        <input type="hidden" name="next" value={next} />
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Button type="submit">Sign in</Button>
      </form>

      <form action={sendMagicLink} className="grid gap-3 rounded-md border border-stone-200 bg-white p-5">
        <input type="hidden" name="next" value={next} />
        <p className="text-sm text-stone-700">Or get a one-time link by email. New users are set up this way after an invitation.</p>
        <Field label="Email" htmlFor="magic-email">
          <Input id="magic-email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Button type="submit" variant="secondary">
          Email me a sign-in link
        </Button>
      </form>
    </main>
  );
}
