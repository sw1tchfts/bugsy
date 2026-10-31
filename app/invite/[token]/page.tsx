import type { Metadata } from "next";
import Link from "next/link";
import { Button, Card, Notice, errorMessage } from "@/components/ui";
import { getSession } from "@/lib/auth/session";
import { withAnon } from "@/lib/db";
import { acceptInvitation } from "./actions";

export const metadata: Metadata = { title: "Invitation" };

type Preview = { tenant_name: string; email: string; role_name: string; valid: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const session = await getSession();

  const preview = UUID.test(token)
    ? (await withAnon((tx) => tx<Preview[]>`select * from app.invitation_preview(${token}::uuid)`))[0]
    : undefined;

  return (
    <main className="mx-auto grid min-h-screen max-w-lg content-center gap-4 px-4 py-12">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Bugsy</p>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      {!preview || !preview.valid ? (
        <Card title="This invitation is no longer valid" description="Ask the company to send a new one.">
          <Link href="/" className="text-sm text-emerald-800 underline">
            Go to Bugsy
          </Link>
        </Card>
      ) : !session ? (
        <Card title={`Join ${preview.tenant_name}`} description={`You were invited as ${preview.role_name}. Sign in with ${preview.email} to accept. If you have no account yet, ask for a sign-in link on the sign-in page with that email.`}>
          <Link href={`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`}>
            <Button type="button">Sign in to accept</Button>
          </Link>
        </Card>
      ) : session.email.toLowerCase() !== preview.email ? (
        <Card title={`Join ${preview.tenant_name}`} description={`This invitation was sent to ${preview.email}, and you are signed in as ${session.email}. Sign out and sign in with the invited address.`}>
          <Link href="/sign-in" className="text-sm text-emerald-800 underline">
            Sign-in page
          </Link>
        </Card>
      ) : (
        <Card title={`Join ${preview.tenant_name}`} description={`You will become a ${preview.role_name} at ${preview.tenant_name}.`}>
          <form action={acceptInvitation}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit">Accept invitation</Button>
          </form>
        </Card>
      )}
    </main>
  );
}
