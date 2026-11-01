"use server";

import { redirect } from "next/navigation";
import { type Session, dbAs, getSession } from "@/lib/auth/session";
import { withAnon } from "@/lib/db";
import { setPortalCookie } from "@/lib/portal/session";
import { createConfirmedUser } from "@/lib/supabase/admin";
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

/** Rule 1: a new person sets a password; holding the link proves the address, so the login is created confirmed. */
export async function createPortalLogin(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const preview = await previewInvitation(token);
  if (!preview || preview.status !== "invited") redirect(page(token, "This invitation is no longer valid."));
  if (preview.has_login) redirect(`/sign-in?next=${encodeURIComponent(page(token))}`);
  if (password.length < 10) redirect(page(token, "Use at least 10 characters."));
  if (password !== confirm) redirect(page(token, "The two passwords do not match."));
  const created = await createConfirmedUser(preview.email, password);
  if (!created.ok && created.reason !== "exists") redirect(page(token, "We could not create your login. Try again, or ask the company to resend the invitation."));
  if (!created.ok) redirect(`/sign-in?next=${encodeURIComponent(page(token))}`);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: preview.email, password });
  if (error || !data.user) redirect(page(token, "Your login was created; sign in to finish."));
  // The new session's cookies go out with this response; this request accepts as the user the sign-in returned.
  const email = data.user.email ?? preview.email;
  await acceptAs(token, { userId: data.user.id, email, claims: { sub: data.user.id, email, role: "authenticated" } });
}
