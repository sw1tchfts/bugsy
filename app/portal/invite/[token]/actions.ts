"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { type Session, dbAs, getSession } from "@/lib/auth/session";
import { withAnon } from "@/lib/db";
import { setPortalCookie } from "@/lib/portal/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Preview = { tenant_name: string; account_name: string; email: string; status: string; has_login: boolean };

const page = (token: string, error?: string) => `/portal/invite/${encodeURIComponent(token)}${error ? `?error=${encodeURIComponent(error)}` : ""}`;

export async function previewInvitation(token: string): Promise<Preview | null> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const [row] = await withAnon((tx) => tx<Preview[]>`select * from app.portal_invitation(${token}::uuid)`);
  return row ?? null;
}

async function acceptAs(token: string, signedIn: Session | null = null): Promise<never> {
  const session = signedIn ?? (await getSession());
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(page(token))}`);
  let id: string | null = null;
  try {
    [{ id }] = await dbAs(session, (tx) => tx<{ id: string }[]>`select app.accept_portal_invitation(${token}::uuid) as id`);
  } catch (err) {
    redirect(page(token, (err as Error).message.slice(0, 120)));
  }
  if (id) await setPortalCookie(id);
  redirect("/portal");
}

/** Rule 1: a signed-in person whose address the invitation names accepts it. */
export async function acceptPortalInvitation(formData: FormData) {
  await acceptAs(String(formData.get("token") ?? ""));
}

/**
 * Rule 1: a new person sets a password. The auth provider proves the address: it emails a confirmation link that lands
 * back here, and the database accepts only a confirmed address. Where the provider confirms on its own (the local
 * stack), the sign-up returns a session and the invitation is accepted at once; production keeps confirmation on.
 */
export async function createPortalLogin(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const preview = await previewInvitation(token);
  if (!preview || preview.status !== "invited") redirect(page(token, "This invitation is no longer valid."));
  if (preview.has_login) redirect(`/sign-in?next=${encodeURIComponent(page(token))}`);
  if (password.length < 10) redirect(page(token, "Use at least 10 characters."));
  if (password !== confirm) redirect(page(token, "The two passwords do not match."));
  const h = await headers();
  const origin = h.get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: preview.email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(page(token))}` },
  });
  if (error || !data.user) redirect(page(token, "We could not create your login. Try again, or ask the company to resend the invitation."));
  if (!data.session) redirect(`${page(token)}?sent=1`);
  if (process.env.NODE_ENV === "production" && process.env.PORTAL_ALLOW_AUTOCONFIRM !== "1") {
    // A login confirmed without an email round trip proves nothing about the address; keep confirmation on.
    await supabase.auth.signOut();
    redirect(page(token, "Email confirmation is off for this site, so the invitation cannot be accepted. Ask the company to contact support."));
  }
  // The new session's cookies go out with this response; this request accepts as the user the sign-up returned.
  const email = data.user.email ?? preview.email;
  await acceptAs(token, { userId: data.user.id, email, claims: { sub: data.user.id, email, role: "authenticated" } });
}
