import type { Metadata } from "next";
import Link from "next/link";
import { Button, Card, Field, Input, Notice } from "@/components/ui";
import { getSession } from "@/lib/auth/session";
import { acceptPortalInvitation, createPortalLogin, previewInvitation } from "./actions";

export const metadata: Metadata = { title: "Your invitation" };

/** A customer's portal invitation (spec 16 rule 1): set a password, or sign in with the invited address, and accept. */
export default async function PortalInvite({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const preview = await previewInvitation(token);
  const session = await getSession();
  if (!preview || preview.status === "disabled") {
    return (
      <Card title="This invitation is not valid" description="It may have been turned off. Ask the company to send a new one.">
        <Link href="/sign-in" className="text-sm text-emerald-800 underline">
          Sign in
        </Link>
      </Card>
    );
  }
  const title = `${preview.tenant_name}: ${preview.account_name}`;
  return (
    <Card title={title} description={`Your account online: your visits, what was applied, your invoices and cards, and requests. This invitation was sent to ${preview.email}.`}>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {session ? (
        session.email.toLowerCase() === preview.email ? (
          <form action={acceptPortalInvitation}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit">Open my account</Button>
          </form>
        ) : (
          <p className="text-sm">
            You are signed in as {session.email}. Sign out and come back to this link, or sign in as {preview.email}.
          </p>
        )
      ) : preview.has_login ? (
        <p className="text-sm">
          {preview.email} already has a login.{" "}
          <Link href={`/sign-in?next=${encodeURIComponent(`/portal/invite/${token}`)}`} className="text-emerald-800 underline">
            Sign in to accept
          </Link>
          .
        </p>
      ) : (
        <form action={createPortalLogin} className="grid max-w-sm gap-3">
          <input type="hidden" name="token" value={token} />
          <Field label="Choose a password" htmlFor="password" hint="At least 10 characters.">
            <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
          </Field>
          <Field label="Type it again" htmlFor="confirm">
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} />
          </Field>
          <div>
            <Button type="submit">Create my login</Button>
          </div>
        </form>
      )}
    </Card>
  );
}
